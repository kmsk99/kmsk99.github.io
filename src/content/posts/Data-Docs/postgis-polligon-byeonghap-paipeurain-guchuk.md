---
tags:
  - PostGIS
  - Docker
  - Pipeline
  - GIS
  - Shell
title: PostGIS 폴리곤 병합 파이프라인 구축
created: '2025-12-02'
modified: '2025-12-02'
---

# 배경

지도 앱에서 금연구역을 시각화할 때, 수만 개의 개별 폴리곤을 한 화면에 모두 렌더링하면 두 가지 문제가 발생한다. 첫째, 폴리곤 수가 많아 지도 렌더링 성능이 떨어진다. 둘째, 겹치는 영역에 반투명 색상이 중첩되면서 색이 진해져 시각적으로 균일하지 않다. 이 문제를 해결하기 위해 로컬 PostGIS Docker 환경에서 겹치는 폴리곤을 하나로 병합하는 오프라인 데이터 파이프라인을 구축했다.

# 파이프라인 구조

전체 파이프라인은 6단계 셸 스크립트로 구성된다. 각 단계를 독립적으로 실행할 수 있어 중간에 실패하더라도 해당 단계부터 재시작할 수 있다.

```
Supabase (원본)
  └─ 02. pg_dump → CSV (id, EWKT)
       └─ 03. 로컬 PostGIS Import
            └─ 04. Simplify + UnaryUnion + Dump
                 └─ 05. Export → CSV (EWKT, zone_count)
                      └─ 06. Supabase Import (zone_nonsmoking_merged)
```

스크립트 실행은 `run-pipeline.sh`로 한 번에 처리하거나, `scripts/01~07`을 개별 실행할 수 있다.

# 로컬 PostGIS 환경 구성

Supabase에 직접 병합 쿼리를 실행하면 프로덕션 DB에 부하를 주므로, Docker로 로컬 PostGIS를 띄워 작업한다.

```bash
docker run --name postgis-nonsmoking \
    -e POSTGRES_PASSWORD=devpass \
    -e POSTGRES_USER=devuser \
    -e POSTGRES_DB=nonsmoking \
    -p 5433:5432 \
    -d postgis/postgis:16-3.4
```

`postgis/postgis:16-3.4` 이미지는 PostgreSQL 16에 PostGIS 3.4가 포함되어 있어 별도 확장 설치가 필요 없다. 포트를 5433으로 매핑해 로컬 PostgreSQL과 충돌을 피한다.

모든 스크립트에서 공통으로 쓰는 헬퍼 함수를 `scripts/common.sh`에 정의했다. `psql`이 로컬에 설치되어 있으면 직접 사용하고, 없으면 Docker를 통해 실행한다.

```bash
local_psql() {
    local query="$1"
    local container_name="postgis-nonsmoking"
    
    if command -v psql &> /dev/null; then
        psql "${LOCAL_DB}" -c "$query"
    else
        docker exec -i "$container_name" psql -U devuser -d nonsmoking -c "$query"
    fi
}
```

# Supabase에서 데이터 덤프

금연구역 원본 데이터를 Supabase에서 CSV로 추출한다. geometry는 EWKT(Extended Well-Known Text) 형식으로 내보내야 SRID 정보가 보존된다.

```bash
psql "$SUPABASE_DB" -c "\copy (
    SELECT id, ST_AsEWKT(geom_area) as ewkt
    FROM public.zones
    WHERE kind = 'NONSMOKING'
) TO '$OUTPUT_FILE' WITH CSV HEADER"
```

`ST_AsEWKT`는 `ST_AsText`와 달리 `SRID=4326;MULTIPOLYGON((...))` 형태로 좌표계 정보를 함께 저장한다. 나중에 Import할 때 `ST_GeomFromEWKT`로 그대로 복원할 수 있다.

Supabase Pooler 연결 문자열(`postgres.[PROJECT_REF]@pooler.supabase.com`)은 Docker 컨테이너 내부에서 접근이 안 될 수 있으므로, 로컬에 `psql`을 설치하는 것이 가장 안정적이다.

# 로컬 PostGIS에 Import

CSV를 로컬 PostGIS로 가져온 뒤 EWKT를 geometry로 변환한다.

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

DROP TABLE IF EXISTS zones_nonsmoking;
CREATE TABLE zones_nonsmoking (
    id uuid,
    ewkt text
);
```

Docker 컨테이너로 CSV를 복사한 후 `\copy`로 Import한다.

```bash
docker cp "$INPUT_FILE" "$CONTAINER_NAME:/tmp/zones_nonsmoking.csv"
docker exec -i "$CONTAINER_NAME" psql -U devuser -d nonsmoking \
    -c "\copy zones_nonsmoking(id, ewkt) FROM '/tmp/zones_nonsmoking.csv' CSV HEADER"
```

이후 EWKT를 geometry 컬럼으로 변환하고, 공간 인덱스를 생성한다.

```sql
ALTER TABLE zones_nonsmoking ADD COLUMN geom_area geometry;

UPDATE zones_nonsmoking
SET geom_area = ST_GeomFromEWKT(ewkt);

ALTER TABLE zones_nonsmoking DROP COLUMN ewkt;

CREATE INDEX zones_nonsmoking_geom_gix
    ON zones_nonsmoking USING GIST (geom_area);

ANALYZE zones_nonsmoking;
```

`GIST` 인덱스는 이후 병합 단계에서 `ST_Intersects` 연산의 성능에 직접적인 영향을 준다.

# 폴리곤 병합

병합은 두 단계로 나뉜다. Simplify로 꼭짓점 수를 줄이고, UnaryUnion으로 겹치는 폴리곤을 하나로 합친다.

## Simplify

```sql
CREATE TABLE zones_nonsmoking_simple AS
SELECT
    id,
    ST_SimplifyPreserveTopology(geom_area, 0.00001) AS geom_area
FROM zones_nonsmoking
WHERE geom_area IS NOT NULL
  AND ST_IsValid(geom_area);

CREATE INDEX zones_nonsmoking_simple_geom_gix
    ON zones_nonsmoking_simple USING GIST (geom_area);
```

`ST_SimplifyPreserveTopology`는 Douglas-Peucker 알고리즘으로 꼭짓점을 줄이되, 폴리곤이 스스로 교차하거나 인접 폴리곤과의 위상 관계가 깨지지 않도록 보장한다. tolerance `0.00001`은 WGS84에서 약 1.1m에 해당하며, 금연구역 시각화에서는 이 정도 정밀도면 충분하다. `ST_Simplify`를 쓰면 위상 관계가 깨질 수 있어 `PreserveTopology` 버전을 사용했다.

## UnaryUnion + Dump

```sql
CREATE TABLE zone_nonsmoking_merged_local AS
WITH collected AS (
    SELECT ST_Collect(geom_area) AS geom
    FROM zones_nonsmoking_simple
),
merged AS (
    SELECT ST_UnaryUnion(geom) AS geom
    FROM collected
),
dumped AS (
    SELECT (ST_Dump(geom)).geom AS geom
    FROM merged
)
SELECT
    ROW_NUMBER() OVER() AS id,
    CASE 
        WHEN ST_GeometryType(geom) = 'ST_Polygon' THEN ST_Multi(geom)
        ELSE geom
    END AS geom_area,
    0 AS zone_count
FROM dumped
WHERE geom IS NOT NULL;
```

이 쿼리의 각 CTE가 하는 역할:

1. `ST_Collect`: 모든 폴리곤을 하나의 GeometryCollection으로 모은다. 아직 병합은 아니고, 단순히 하나의 객체로 묶는 것이다.
2. `ST_UnaryUnion`: Collection 내의 모든 geometry를 한 번에 union한다. 쌍별 `ST_Union`을 반복하는 것보다 최적화되어 있다. 겹치는 영역은 하나로 합쳐지고, 떨어진 영역은 MULTIPOLYGON의 각 파트로 남는다.
3. `ST_Dump`: 결과 MULTIPOLYGON을 개별 Polygon 행으로 분리한다. 지도에서 개별 영역별로 스타일링하거나 클릭 이벤트를 처리할 때 필요하다.

`ST_Multi`로 POLYGON을 MULTIPOLYGON으로 통일하는 이유는 Supabase 원본 테이블의 `geom_area` 컬럼 타입이 `geometry(MultiPolygon, 4326)`이기 때문이다.

## zone_count 계산

각 병합 폴리곤이 원본에서 몇 개의 금연구역을 포함하는지 계산한다. 앱에서 "이 영역에 12개 금연구역이 포함되어 있습니다"와 같은 정보를 표시할 때 쓰인다.

```sql
UPDATE zone_nonsmoking_merged_local m
SET zone_count = (
    SELECT COUNT(*)
    FROM zones_nonsmoking_simple z
    WHERE ST_Intersects(z.geom_area, m.geom_area)
        AND z.geom_area && m.geom_area
);
```

`z.geom_area && m.geom_area`는 GiST 인덱스의 바운딩 박스 필터를 먼저 적용해, `ST_Intersects`의 정밀 계산 대상을 줄인다. 데이터 양에 따라 이 단계가 수 분에서 수십 분 걸릴 수 있다.

# Export와 Supabase Import

병합 결과를 CSV로 내보낸 뒤 Supabase로 올린다.

```bash
docker exec -i "$CONTAINER_NAME" psql -U devuser -d nonsmoking -c "\copy (
    SELECT ST_AsEWKT(geom_area) AS ewkt, zone_count
    FROM zone_nonsmoking_merged_local
    WHERE geom_area IS NOT NULL
) TO '$TEMP_FILE' WITH CSV HEADER"
```

Supabase 측에서는 임시 테이블을 거쳐 최종 테이블로 이동한다.

```sql
TRUNCATE TABLE public.zone_nonsmoking_merged;

INSERT INTO public.zone_nonsmoking_merged (geom_area, zone_count)
SELECT
    CASE 
        WHEN ST_GeometryType(ST_GeomFromEWKT(ewkt)) = 'ST_Polygon' 
        THEN ST_Multi(ST_GeomFromEWKT(ewkt))
        ELSE ST_GeomFromEWKT(ewkt)
    END AS geom_area,
    COALESCE(zone_count, 0) AS zone_count
FROM zone_nonsmoking_merged_import
WHERE ewkt IS NOT NULL;
```

앱에서는 `zone_nonsmoking_merged` 테이블만 조회하면 된다. 원본 `zones` 테이블의 NONSMOKING 데이터와 별개로 관리되므로 원본을 수정할 필요가 없다.

# 클라이언트에서 병합 데이터 조회

관리 패널에서는 기존 `get_zones_in_bbox` RPC와 동일한 패턴으로 병합된 금연구역을 조회한다.

```ts
export const getZonesNonsmokingMergedInBBox = async (
  input: GetZonesNonsmokingMergedInBBoxInput,
): Promise<ZoneNonsmokingMerged[]> => {
  const supabase = getSupabase();

  const { data, error } = await supabase.rpc(
    'get_zones_nonsmoking_merged_in_bbox',
    {
      west: input.west,
      south: input.south,
      east: input.east,
      north: input.north,
      page_size: input.pageSize || 1000,
      offset_n: input.offsetN || 0,
    },
  );

  if (error) throw error;
  return data;
};
```

병합 전에는 금연구역이 겹칠 때마다 색이 진해져서 시각적으로 고르지 않았는데, 병합 후에는 균일한 색상으로 영역이 표시된다.

# 결과

파이프라인 실행 한 번으로 수만 건의 개별 금연구역 폴리곤이 수천 건의 병합 폴리곤으로 줄어들었다. 주요 효과:

- 지도 렌더링 대상 폴리곤 수가 크게 감소해 클라이언트 성능이 개선됐다
- 겹치는 영역의 색상 중첩 문제가 해결됐다
- Docker로 격리된 환경에서 작업하므로 프로덕션 DB에 부하가 없다
- 각 단계가 독립적이어서 데이터가 바뀌면 특정 단계만 재실행할 수 있다
- 병합 폴리곤별 `zone_count`를 제공해 원본 정보 손실을 보완한다

# Reference

- https://postgis.net/docs/ST_UnaryUnion.html
- https://postgis.net/docs/ST_SimplifyPreserveTopology.html
- https://postgis.net/docs/ST_Dump.html
- https://hub.docker.com/r/postgis/postgis

# 연결문서

- [PostGIS RPC로 구역 저장과 공간 조회](/post/postgis-rpcro-guyeok-jeojanggwa-gonggan-johoe)
- [공공데이터 위치 정보 전처리](/post/gonggongdeiteo-wichi-jeongbo-jeoncheori)
- [S2 Geometry 기반 서버사이드 지도 클러스터링](/post/s2-geometry-giban-seobeosaideu-jido-keulleoseuteoring)
