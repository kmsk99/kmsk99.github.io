---
tags:
  - S2
  - Clustering
  - Supabase
  - Geo
  - Performance
  - EdgeFunctions
title: S2 Geometry 기반 서버사이드 지도 클러스터링
created: '2025-06-15 10:00'
modified: '2025-06-15 14:30'
---

# 배경

이전에 만들었던 위치 기반 앱에서는 클라이언트에서 `react-native-clusterer`로 마커를 클러스터링했다. 약 1,900개 정도의 마커까지는 잘 동작했지만, 데이터가 수만 건으로 늘어나면서 한계가 드러났다. 앱 시작 시 전체 데이터를 내려받아야 했고, GeoJSON 변환과 클러스터 계산이 모두 클라이언트에서 일어나니 초기 로딩이 길어졌다. 줌 레벨을 바꿀 때마다 전체 데이터를 다시 계산하는 것도 비효율적이었다.

새 프로젝트에서는 Google의 S2 Geometry 라이브러리를 도입해 서버사이드 클러스터링으로 전환했다. 핵심 아이디어는 간단하다. 지구 표면을 계층적 셀로 분할하고, 각 셀에 속하는 데이터를 미리 집계해두면 클라이언트는 현재 뷰포트에 해당하는 셀의 집계 데이터만 받으면 된다.

# S2 Geometry 개요

S2는 지구 표면을 정육면체에 투영한 뒤, 각 면을 Hilbert 곡선을 따라 재귀적으로 4분할하는 공간 인덱싱 시스템이다. 레벨 0이 가장 큰 셀(지구 면의 1/6)이고, 레벨이 올라갈수록 셀이 작아진다. 레벨 15는 약 100m × 100m, 레벨 30은 1cm² 이하다.

클러스터링에 활용하는 핵심 성질은 두 가지다.

- 계층 구조: 레벨 15 셀의 부모를 구하면 레벨 14, 13, ... 2까지 자동으로 상위 클러스터가 만들어진다.
- 64비트 정수 ID: 좌표를 하나의 정수로 변환하므로 DB 인덱싱과 범위 쿼리에 유리하다.

# 구현

## 좌표 → S2 셀 변환

`nodes2ts` 라이브러리로 위도/경도를 S2 셀 ID로 변환한다. 모든 위치 데이터는 레벨 15 셀에 매핑해서 저장하고, 상위 레벨은 이 값에서 계산한다.

```ts
import { S2CellId, S2LatLng } from 'nodes2ts';

function getS2CellIdAtLevel(lat: number, lng: number, level: number): number {
  const latLng = S2LatLng.fromDegrees(lat, lng);
  const point = latLng.toPoint();
  const cellId = S2CellId.fromPoint(point);
  const parentCell = cellId.parentL(level);
  return parentCell.id.toNumber();
}

export function getS2CellId(lat: number, lng: number): number {
  return getS2CellIdAtLevel(lat, lng, 15);
}

export function getS2CellCenter(cellId: number | string): { lat: number; lng: number } {
  const cell = new S2CellId(String(cellId));
  const latLng = cell.toLatLng();
  return { lat: latLng.latDegrees, lng: latLng.lngDegrees };
}
```

## 줌 레벨 → S2 레벨 매핑

지도 줌 레벨에 따라 적절한 S2 레벨을 선택한다. 줌이 낮으면(넓은 영역) 낮은 S2 레벨로 큰 클러스터를, 줌이 높으면 높은 S2 레벨로 작은 클러스터를 보여준다.

```ts
export function getS2LevelForZoom(zoom: number): number {
  const level = Math.floor(zoom);
  return Math.max(2, Math.min(15, level));
}
```

## 클러스터 사전 빌드

관리자 서버에서 Cron으로 매일 전체 클러스터를 재생성한다. `S2ClusterBuilder`는 모든 위치 데이터의 레벨 15 셀을 읽어서 레벨 2~15까지의 부모 셀별 집계를 계산한다.

```ts
class S2ClusterBuilder {
  private clusterAccumulator: Map<number, Map<number, {
    zones: ZoneS2Data[];
    zoneCountNormal: number;
    zoneCountStore: number;
  }>>;
  private readonly levels: number[];

  constructor() {
    this.clusterAccumulator = new Map();
    this.levels = Array.from({ length: 14 }, (_, i) => i + 2);
  }

  processZones(zones: ZoneS2Data[]): void {
    for (const level of this.levels) {
      if (!this.clusterAccumulator.has(level)) {
        this.clusterAccumulator.set(level, new Map());
      }
      const levelMap = this.clusterAccumulator.get(level)!;

      zones.forEach(zone => {
        const cellId = getParentCellId(zone.s2_level15, level);
        if (!levelMap.has(cellId)) {
          levelMap.set(cellId, { zones: [], zoneCountNormal: 0, zoneCountStore: 0 });
        }
        const cellData = levelMap.get(cellId)!;
        cellData.zones.push(zone);

        if (zone.category === 'CATEGORY_GENERAL') cellData.zoneCountNormal++;
        else if (zone.category === 'CATEGORY_SMOKING_STORE') cellData.zoneCountStore++;
      });
    }
  }

  buildClusters(kind: string): { clusters: ClusterData[]; stats: Record<number, LevelStats> } {
    const clusters: ClusterData[] = [];
    const stats: Record<number, LevelStats> = {};

    for (const level of this.levels) {
      const levelMap = this.clusterAccumulator.get(level);
      if (!levelMap) { stats[level] = { cellCount: 0, zoneCount: 0, normalCount: 0, storeCount: 0 }; continue; }

      levelMap.forEach((cellData, cellId) => {
        const s2Level15Cells = cellData.zones.map(z => z.s2_level15);
        const center = calculateAverageCenterFromS2Cells(s2Level15Cells);
        clusters.push({
          kind,
          s2_level: level,
          s2_cell_id: String(cellId),
          zone_count: cellData.zones.length,
          zone_count_normal: cellData.zoneCountNormal,
          zone_count_store: cellData.zoneCountStore,
          approx_point: `POINT(${center.lng} ${center.lat})`,
        });
      });
    }
    return { clusters, stats };
  }
}
```

재생성 로직은 커서 기반 페이지네이션으로 전체 데이터를 순회하고, 기존 클러스터를 삭제한 뒤 1,000건씩 배치 삽입한다. Vercel Cron에서 `maxDuration: 300`으로 5분 타임아웃을 설정해 실행한다.

## 클라이언트 3단계 줌 전략

클라이언트 훅 `useSmokingZones`는 줌 레벨에 따라 세 가지 모드로 동작한다.

```ts
export function useSmokingZones() {
  const [markers, setMarkers] = useState<MarkerPoint[]>([]);
  const [clusterMarkers, setClusterMarkers] = useState<S2ClusterMarkerData[]>([]);
  const requestIdRef = useRef(0);

  const fetchData = useCallback(async (bounds: MapBounds, zoom: number, zoneFilter: ZoneFilterType = 'all') => {
    const currentRequestId = ++requestIdRef.current;
    const s2Level = getS2LevelForZoom(zoom);

    if (zoom <= MARKER_ZOOM_THRESHOLD) {
      // 넓은 영역: 항상 클러스터
      const clusters = await getS2ClustersInBBox(bounds, s2Level, ['SMOKING']);
      if (currentRequestId !== requestIdRef.current) return;
      setClusterMarkers(clusters.filter(c => c.zoneCount > 0).map(toClusterData));
      setMarkers([]);
    } else if (zoom < SMOKING_ZONE_MIN_ZOOM) {
      // 중간 영역: 구역 수에 따라 분기
      const clusters = await getS2ClustersInBBox(bounds, s2Level, ['SMOKING']);
      if (currentRequestId !== requestIdRef.current) return;
      const totalCount = clusters.reduce((sum, c) => sum + c.zoneCount, 0);

      if (totalCount <= MARKER_CLUSTER_COUNT_THRESHOLD) {
        const zones = await getAllZonesInBBox({ ...bounds, kinds: ['SMOKING'] }, 5);
        if (currentRequestId !== requestIdRef.current) return;
        setMarkers(zones.filter(z => z.is_active).map(convertZoneToMarkerPoint));
        setClusterMarkers([]);
      } else {
        setClusterMarkers(clusters.filter(c => c.zoneCount > 0).map(toClusterData));
        setMarkers([]);
      }
    } else {
      // 좁은 영역: 항상 개별 마커
      const zones = await getAllZonesInBBox({ ...bounds, kinds: ['SMOKING'] }, 5);
      if (currentRequestId !== requestIdRef.current) return;
      setMarkers(zones.filter(z => z.is_active).map(convertZoneToMarkerPoint));
      setClusterMarkers([]);
    }
  }, []);

  return { markers, clusterMarkers, fetchData };
}
```

`requestIdRef`로 race condition을 방지한다. 사용자가 빠르게 지도를 이동하면 이전 요청의 결과가 도착해도 무시된다.

## Edge Function으로 BBox 쿼리

클라이언트에서 직접 `zone_s2_clusters` 테이블을 조회하지 않고, Supabase Edge Function을 경유한다. Edge Function은 인증 처리, 컴플라이언스 로깅을 함께 수행한다.

```ts
serve(async req => {
  const { west, south, east, north, p_s2_level, p_kinds, page_size, offset_n } = await req.json();

  const { data: { user } } = await supabaseClient.auth.getUser(token);

  const { data, error } = await supabaseClient.rpc('get_zone_s2_clusters_in_bbox', {
    west, south, east, north, p_s2_level,
    p_kinds: p_kinds || null,
    page_size: page_size || 1000,
    offset_n: offset_n || 0,
  });

  await logLocationUsage({
    type: 'USAGE',
    userId: user?.id ?? 'anonymous',
    purpose: 'Search_S2_Clusters',
    metadata: { bbox_aspect_ratio: (east - west) / (north - south), s2_level: p_s2_level },
  });

  return new Response(JSON.stringify(data), { headers: corsHeaders });
});
```

이 RPC는 `zone_s2_clusters` 테이블에서 `ST_MakeEnvelope`로 bbox를 만들고, `approx_point`와의 `ST_Intersects`로 해당 영역의 클러스터만 필터링한다. 반환값에는 `s2_cell_id`, `s2_level`, `zone_count`, `zone_count_normal`, `zone_count_store`, `approx_point`가 포함되어 카테고리별 카운트를 프론트엔드에서 바로 표시할 수 있다.

클라이언트의 서비스 레이어에서는 반환된 `approx_point`의 좌표를 추출하고, 좌표가 없으면 S2 셀 중심점으로 폴백한다.

```ts
return data.map((cluster: any) => {
  let lat = 0, lng = 0;
  const point = cluster.approx_point as { coordinates?: number[] } | null;
  if (point?.coordinates && point.coordinates.length >= 2) {
    [lng, lat] = point.coordinates;
  } else {
    const center = getS2CellCenter(String(cluster.s2_cell_id));
    lat = center.lat;
    lng = center.lng;
  }
  return {
    id: `cluster-${cluster.s2_level}-${cluster.s2_cell_id}`,
    lat, lng,
    zoneCount: cluster.zone_count || 0,
    zoneCountNormal: cluster.zone_count_normal || 0,
    zoneCountStore: cluster.zone_count_store || 0,
    s2Level: cluster.s2_level,
    s2CellId: String(cluster.s2_cell_id),
  };
});
```

# 클라이언트 클러스터링과의 비교

| 항목 | 이전 (클라이언트) | 현재 (S2 서버사이드) |
|------|------------------|---------------------|
| 클러스터 계산 | 앱에서 매번 실시간 계산 | 서버에서 사전 빌드, 클라이언트는 조회만 |
| 초기 로딩 | 전체 데이터 다운로드 필요 | 현재 뷰포트 데이터만 요청 |
| 데이터 규모 | ~2,000건에서 프레임드롭 발생 | 수만 건에서도 응답 시간 일정 |
| 줌 변경 | 전체 재계산 | S2 레벨만 바꿔서 재요청 |
| 필터링 | 클라이언트에서 전체 필터 | 서버 RPC에서 카테고리별 카운트 사전 집계 |
| 오프라인 | cache 옵션으로 부분 지원 | 온라인 필수 |

# 결과

S2 클러스터링 도입 후 지도 초기 로딩 시간이 체감상 절반 이하로 줄었다. 이전에는 Firestore에서 전체 위치 데이터를 받아오느라 3~5초가 걸렸는데, 이제는 현재 뷰포트의 클러스터 데이터만 가져오므로 수백 ms 수준이다. 줌을 변경해도 S2 레벨에 맞는 사전 집계 데이터를 즉시 받아오기 때문에 클라이언트 CPU 부하도 거의 없다.

다만 Cron으로 클러스터를 재생성하는 구조라 실시간 반영에는 약간의 지연이 있다. 새로 추가된 위치가 클러스터에 반영되려면 최대 하루를 기다려야 한다. 이 부분은 추후 위치 추가/삭제 시 해당 셀의 클러스터만 증분 업데이트하는 방식으로 개선할 수 있다.

# Reference

- https://s2geometry.io/
- https://www.npmjs.com/package/nodes2ts
- https://supabase.com/docs/guides/functions
- https://vercel.com/docs/cron-jobs

# 연결문서

- [react-native-clusterer로 지도 마커 클러스터링](/post/react-native-clustererro-jido-makeo-keulleoseuteoring)
- [Firebase 서버리스 위치 기반 앱 구현](/post/firebase-seobeoriseu-wichi-giban-aep-guhyeon)
- [네이버 지도 SDK로 매장 지도 구현](/post/neibeo-jido-sdkro-maejang-jido-guhyeon)
- [Vercel Cron으로 AI 자동화 트리거 구현](/post/vercel-croneuro-ai-jadonghwa-teurigeo-guhyeon)
- [PostGIS RPC로 구역 저장과 공간 조회](/post/postgis-rpcro-guyeok-jeojanggwa-gonggan-johoe)
- 위치정보법 준수를 위한 감사 로깅 아키텍처
- [S2 기반 히트맵 통계 집계와 조회](/post/s2-giban-hiteumaep-tonggye-jipgyewa-johoe)
- [PostGIS 폴리곤 병합 파이프라인 구축](/post/postgis-polligon-byeonghap-paipeurain-guchuk)
