---
tags:
  - PostGIS
  - Supabase
  - RPC
  - Geo
  - SQL
title: PostGIS RPC로 구역 저장과 공간 조회
created: '2025-05-20 10:00'
modified: '2025-05-20 16:00'
---

# 배경

위치 기반 앱에서 "이 지도 영역 안에 있는 구역을 보여줘"라는 요청을 처리하려면 공간 쿼리가 필요하다. Supabase의 일반 `select`로는 geometry 교차 판정이나 거리 계산을 할 수 없다. PostgreSQL에 PostGIS 확장을 활성화하고, RPC(Remote Procedure Call) 함수를 만들어 서버에서 공간 연산을 처리하도록 했다.

# 구역 저장 RPC

## 포인트 구역 추가

위도/경도로 포인트 구역을 추가하는 RPC다. 좌표를 `geometry(Point, 4326)`으로 변환하고, 그 점을 중심으로 반경 5m의 작은 폴리곤을 함께 생성해 `geom_area`에 저장한다.

```sql
CREATE FUNCTION add_zone_point(
  p_kind text, p_lng double precision, p_lat double precision,
  p_name text, p_address text DEFAULT NULL,
  p_point_radius_m integer DEFAULT 5,
  p_s2_level15 bigint DEFAULT NULL,
  p_country_code text DEFAULT NULL
) RETURNS uuid
LANGUAGE sql AS $$
  WITH c AS (
    SELECT ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) AS center
  ), g AS (
    SELECT
      ST_Multi(
        (ST_Buffer(center::geography, GREATEST(p_point_radius_m, 1), 16))::geometry
      ) AS area,
      center
    FROM c
  )
  INSERT INTO zones(kind, name, address, country_code, geom_area, display_point, s2_level15)
  SELECT
    p_kind, p_name, p_address,
    COALESCE(
      NULLIF(p_country_code, ''),
      safe_nearest_country_code_by_point(lng := p_lng, lat := p_lat)
    ),
    g.area, g.center, p_s2_level15
  FROM g
  RETURNING id;
$$;
```

핵심 PostGIS 함수들:
- `ST_MakePoint(lng, lat)`: 경도/위도로 Point 생성
- `ST_SetSRID(..., 4326)`: WGS84 좌표계 지정
- `ST_Buffer(center::geography, radius, segments)`: 포인트를 중심으로 원형 폴리곤 생성. `geography`로 캐스팅해야 미터 단위가 적용된다
- `ST_Multi(...)`: MULTIPOLYGON으로 통일 (테이블 스키마 일관성)

`country_code`가 없으면 `safe_nearest_country_code_by_point` RPC로 좌표 기반 국가 코드를 자동 결정한다.

## 원형 구역 추가

명시적 반경이 있는 구역은 `add_zone_circle`로 추가한다. 차이점은 `ST_Buffer`의 segments 파라미터다.

```sql
-- add_zone_circle에서 달라지는 부분
SELECT ST_Multi(
  (ST_Buffer(center::geography, GREATEST(p_radius_m, 1), 4))::geometry
) AS area
```

segments를 4로 설정하면 정사각형에 가까운 폴리곤이 되고, 16으로 설정하면 원에 가까워진다. 포인트 구역은 시각적 표현이 중요하지 않아 16으로, 실제 구역 경계를 나타내는 원형 구역은 4로 설정해 저장 효율을 높였다.

## GeoJSON 폴리곤 추가

관리자가 지도에서 직접 그린 폴리곤은 GeoJSON으로 들어온다.

```sql
CREATE FUNCTION add_zone_polygon_geojson(
  p_kind text, p_geojson jsonb, p_name text
) RETURNS uuid
LANGUAGE sql AS $$
  WITH src AS (
    SELECT ST_SetSRID(ST_GeomFromGeoJSON(p_geojson::text), 4326) AS g
  ), valid AS (
    SELECT CASE WHEN ST_IsValid(g) THEN g ELSE ST_MakeValid(g) END AS g
    FROM src
  ), uni AS (
    SELECT CASE
      WHEN GeometryType(g) = 'MULTIPOLYGON' THEN g
      WHEN GeometryType(g) = 'POLYGON' THEN ST_Multi(g)
      ELSE ST_Multi(ST_CollectionExtract(g, 3))
    END AS mp
    FROM valid
  ), enriched AS (
    SELECT mp, ST_PointOnSurface(mp) AS dp FROM uni
  )
  INSERT INTO zones(kind, name, geom_area, display_point)
  SELECT p_kind, p_name, e.mp, e.dp
  FROM enriched e
  RETURNING id;
$$;
```

이 RPC는 입력 데이터의 무결성을 단계별로 보장한다.

1. `ST_GeomFromGeoJSON`: GeoJSON → geometry 변환
2. `ST_IsValid` / `ST_MakeValid`: 유효하지 않은 geometry(자기 교차 등) 자동 수정
3. `GeometryType` 분기: POLYGON이면 MULTIPOLYGON으로 변환, GEOMETRYCOLLECTION이면 폴리곤만 추출
4. `ST_PointOnSurface`: 폴리곤 내부에 있는 대표 포인트 계산 (지도에서 마커를 표시할 위치)

`ST_Centroid`가 아닌 `ST_PointOnSurface`를 쓰는 이유는, 초승달 같은 오목한 폴리곤에서 중심점이 폴리곤 바깥에 떨어질 수 있기 때문이다.

## 벌크 삽입

개별 RPC를 반복 호출하면 네트워크 왕복이 많아진다. JSONB 배열을 받아 한 트랜잭션에서 처리하는 벌크 버전을 만들었다.

```sql
CREATE FUNCTION add_zone_point_bulk(p_items jsonb) RETURNS uuid[]
LANGUAGE plpgsql AS $$
DECLARE
  v_ids uuid[] := '{}';
  v_rec record;
  v_id uuid;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_items must be a JSON array';
  END IF;

  FOR v_rec IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_id := add_zone_point(
      p_kind := v_rec.value->>'kind',
      p_lng := (v_rec.value->>'lng')::double precision,
      p_lat := (v_rec.value->>'lat')::double precision,
      p_name := v_rec.value->>'name',
      p_s2_level15 := CASE WHEN v_rec.value ? 's2_level15'
        THEN (v_rec.value->>'s2_level15')::bigint ELSE NULL END
    );
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  RETURN v_ids;
END;
$$;
```

`jsonb_array_elements`로 배열을 순회하고, `->>` 연산자로 텍스트 추출 후 타입 캐스팅한다. 내부적으로 개별 RPC를 호출하므로 PostGIS 로직의 중복이 없다.

## 클라이언트 호출

클라이언트에서는 `supabase.rpc()`로 호출한다. S2 셀 ID는 클라이언트에서 미리 계산해 전달한다.

```ts
export const addZonePoint = async (input: AddZonePointInput) => {
  const s2CellId = getS2CellId(input.lat, input.lng);

  const { data, error } = await supabase.rpc('add_zone_point', {
    p_kind: input.kind,
    p_lng: input.lng,
    p_lat: input.lat,
    p_name: input.name,
    p_address: input.address ?? undefined,
    p_point_radius_m: input.pointRadiusM ?? 5,
    p_s2_level15: s2CellId,
    p_user_id: input.userId ?? undefined,
    p_is_active: input.active ?? true,
  });

  return data;
};
```

벌크 삽입은 JSON 배열을 그대로 전달한다.

```ts
const items = inputs.map(input => ({
  kind: input.kind,
  lng: input.lng,
  lat: input.lat,
  name: input.name,
  s2_level15: getS2CellId(input.lat, input.lng),
}));

const { data } = await supabase.rpc('add_zone_point_bulk', {
  p_items: items as unknown as Json,
});
```

# 공간 조회 RPC

## BBox 내 구역 조회

지도에서 현재 보이는 영역(bbox)의 구역을 조회하는 RPC다.

```sql
CREATE FUNCTION get_zones_in_bbox(
  west double precision, south double precision,
  east double precision, north double precision,
  page_size integer DEFAULT 1000, offset_n integer DEFAULT 0,
  kinds text[] DEFAULT NULL
) RETURNS TABLE(id uuid, kind text, name text, display_point geometry, geom_area geometry, ...)
LANGUAGE sql STABLE AS $$
  WITH env AS (
    SELECT ST_MakeEnvelope(west, south, east, north, 4326) AS box
  )
  SELECT z.*
  FROM zones z, env
  WHERE (kinds IS NULL OR z.kind = ANY(kinds))
    AND z.is_active = true
    AND ST_Intersects(z.geom_area, env.box)
  ORDER BY COALESCE(z.data_date::timestamp, z.created_at) DESC
  LIMIT LEAST(page_size, 1000) OFFSET offset_n;
$$;
```

`ST_MakeEnvelope(west, south, east, north, 4326)`으로 사각형 geometry를 만들고, `ST_Intersects`로 이 사각형과 겹치는 구역을 찾는다. `geom_area` 컬럼에 GiST 인덱스가 걸려 있으므로 전체 스캔 없이 빠르게 조회된다. `LEAST(page_size, 1000)`으로 한 번에 1000건을 초과하는 요청을 방지한다.

클라이언트에서는 자동 페이지네이션으로 전체 데이터를 가져올 수 있다.

```ts
export const getAllZonesInBBox = async (
  input: Omit<GetZonesInBBoxInput, 'pageSize' | 'offsetN'>,
  maxPages: number = 20,
): Promise<Zones[]> => {
  const allZones: Zones[] = [];
  const pageSize = 1000;

  for (let page = 0; page < maxPages; page++) {
    const zones = await getZonesInBBox({
      ...input,
      pageSize,
      offsetN: page * pageSize,
    });

    if (zones.length === 0) break;
    allZones.push(...zones);
    if (zones.length < pageSize) break;
  }

  return allZones;
};
```

## 근처 구역 조회

현재 위치에서 반경 N미터 이내의 구역을 거리순으로 조회한다.

```sql
CREATE FUNCTION get_zones_nearby(
  lng double precision, lat double precision,
  meters integer DEFAULT 300,
  page_size integer DEFAULT 1000, offset_n integer DEFAULT 0,
  kinds text[] DEFAULT NULL
) RETURNS TABLE(id uuid, kind text, name text, dist_m double precision, ...)
LANGUAGE sql STABLE AS $$
  WITH p AS (
    SELECT ST_SetSRID(ST_MakePoint(lng, lat), 4326) AS pt
  )
  SELECT z.*, ST_Distance(z.geom_area::geography, p.pt::geography) AS dist_m
  FROM zones z, p
  WHERE (kinds IS NULL OR z.kind = ANY(kinds))
    AND z.is_active = true
    AND ST_DWithin(z.geom_area::geography, p.pt::geography, meters)
  ORDER BY dist_m
  LIMIT LEAST(page_size, 1000) OFFSET offset_n;
$$;
```

`ST_DWithin`은 두 geometry 간 거리가 지정 범위 이내인지 판정한다. `::geography`로 캐스팅하면 미터 단위로 정확한 거리 계산이 된다. `ST_Distance`로 실제 거리도 반환해 "300m 이내" 같은 UI 표시에 사용한다.

## 겹치는 구역 판정

특정 구역과 영역이 겹치는 다른 구역을 찾는 RPC다. 중복 등록 방지나 관리자 검수에 사용한다.

```sql
CREATE FUNCTION get_overlapping_zones(
  p_zone_id uuid, p_kind text DEFAULT NULL,
  include_self boolean DEFAULT false
) RETURNS TABLE(id uuid, kind text, name text, geom_area geometry, ...)
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT geom_area FROM zones WHERE id = p_zone_id
  )
  SELECT z.*
  FROM zones z JOIN base b ON TRUE
  WHERE (include_self = true OR z.id <> p_zone_id)
    AND (p_kind IS NULL OR z.kind = p_kind)
    AND z.is_active = true
    AND ST_Intersects(z.geom_area, b.geom_area)
  ORDER BY COALESCE(z.data_date::timestamp, z.created_at) DESC;
$$;
```

## 중복 구역 체크

구역 등록 전에 동일한 이름이나 좌표에 이미 구역이 있는지 확인한다. Haversine 공식으로 클라이언트 측에서도 거리를 계산한다.

```ts
function haversineDistanceMeters(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const R = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

## 키워드 검색

이름이나 주소로 구역을 검색하는 RPC도 있다. PostgreSQL의 `ts_rank`를 활용한 관련도 정렬을 지원한다.

```ts
const { data: zones } = await supabase.rpc('search_smoking_zones', {
  p_query: keyword,
  p_sort: 'relevance',
  p_limit: pageSize,
  p_offset: (pageNum - 1) * pageSize,
});
```

# 행정구역 경계 저장

공공데이터에서 가져온 행정구역 경계는 WKT(Well-Known Text) 형식이다. GeoJSON과 유사한 패턴으로 처리하되, `ST_GeomFromText`로 파싱한다.

```sql
CREATE FUNCTION add_region_boundary_polygon_wkt(
  p_region_code text, p_region_name text, p_full_name text,
  p_level text, p_sido_code text, p_base_date date, p_wkt text
) RETURNS uuid
LANGUAGE sql AS $$
  WITH src AS (
    SELECT ST_SetSRID(ST_GeomFromText(p_wkt), 4326) AS g
  ), valid AS (
    SELECT CASE WHEN ST_IsValid(g) THEN g ELSE ST_MakeValid(g) END AS g
    FROM src
  ), uni AS (
    SELECT CASE
      WHEN GeometryType(g) = 'MULTIPOLYGON' THEN g
      WHEN GeometryType(g) = 'POLYGON' THEN ST_Multi(g)
      ELSE ST_Multi(ST_CollectionExtract(g, 3))
    END AS mp
    FROM valid
  )
  INSERT INTO region_boundaries(region_code, region_name, full_name, level, sido_code, base_date, geom_area)
  SELECT p_region_code, p_region_name, p_full_name, p_level, p_sido_code, p_base_date, mp
  FROM uni
  RETURNING id;
$$;
```

# 결과

PostGIS RPC로 공간 데이터를 처리하면서 얻은 이점:
- 클라이언트에서 geometry 연산을 할 필요가 없다. 좌표와 이름만 보내면 서버에서 폴리곤 생성, 유효성 검증, 국가 코드 결정까지 한 번에 처리한다
- SQL 레벨의 UPSERT로 중복 데이터를 깔끔하게 처리할 수 있다
- 벌크 RPC로 수천 건의 구역을 한 트랜잭션에서 삽입할 수 있어 마이그레이션이나 일괄 업로드가 빠르다
- `ST_MakeValid`로 입력 데이터의 geometry 오류를 자동 수정하므로 데이터 품질이 보장된다

# Reference

- https://postgis.net/docs/reference.html
- https://supabase.com/docs/guides/database/functions
- https://postgis.net/docs/ST_Buffer.html
- https://postgis.net/docs/ST_PointOnSurface.html

# 연결문서

- [S2 Geometry 기반 서버사이드 지도 클러스터링](/post/s2-geometry-giban-seobeosaideu-jido-keulleoseuteoring)
- [공공데이터 위치 정보 전처리](/post/gonggongdeiteo-wichi-jeongbo-jeoncheori)
- [Firebase 서버리스 위치 기반 앱 구현](/post/firebase-seobeoriseu-wichi-giban-aep-guhyeon)
- [PostGIS 폴리곤 병합 파이프라인 구축](/post/postgis-polligon-byeonghap-paipeurain-guchuk)
- [S2 기반 히트맵 통계 집계와 조회](/post/s2-giban-hiteumaep-tonggye-jipgyewa-johoe)
- [Naver와 Google 지오코딩 API 통합](/post/naverwa-google-jiokoding-api-tonghap)
