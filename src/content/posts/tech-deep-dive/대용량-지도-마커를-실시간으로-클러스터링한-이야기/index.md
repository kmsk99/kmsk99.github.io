---
tags:
  - Engineering
  - TechDeepDive
  - iOS
  - ReactNative
  - UX
  - Expo
  - Firestore
  - Payment
title: 대용량 지도 마커를 실시간으로 클러스터링한 이야기
created: '2025-10-09 12:00'
modified: '2025-10-09 15:20'
slug: 대용량-지도-마커를-실시간으로-클러스터링한-이야기
---

# Intro
3년 전 공공기관 위치 데이터를 정제하고 나니 지도 위 마커 수가 순식간에 3배 가까이 늘었습니다. 스크롤이 버벅이고, 핀을 탭하려면 3초씩 기다려야 했죠. 그날 밤 저는 "이대로는 사용자들이 바로 앱을 삭제하겠다"를 되뇌며 클러스터링을 도입하기로 마음먹었습니다. 혹시 여러분도 지도 위에 수천 개는 아니더라도 수천 개에 가까운 포인트를 실시간으로 보여줘야 하는 상황인가요?

## 핵심 아이디어 요약
1. GeoJSON FeatureCollection을 만들어 `react-native-clusterer`가 바로 처리할 수 있는 형태로 데이터를 전달했습니다.
2. 줌 레벨(또는 iOS에서는 카메라 고도)에 따라 클러스터 반경을 동적으로 조절해, 확대 시에는 개별 마커를 그대로 노출했습니다.
3. 위치 권한과 배터리 이슈를 고려해 `expo-location`의 watch 옵션을 세밀하게 튜닝했습니다.

## 준비와 선택
- 이미 `react-native-maps`를 쓰고 있었기 때문에, API 차이가 크지 않은 `react-native-clusterer`를 붙이는 것이 자연스러웠습니다.
- 클러스터링을 서버 대신 클라이언트에서 처리하려고 GeoJSON 변환 헬퍼를 만드는 쪽을 택했습니다.
- 사용자 현재 위치를 계속 추적해야 했기 때문에 `Location.watchPositionAsync` 설정을 여러 번 바꿔 보며 배터리 소모를 측정했습니다.

## 구현 여정

### Step 1. GeoJSON으로 변환하는 헬퍼 만들기
Firestore에서 내려받은 `LocationInfo` 배열을 그대로 클러스터러에 넘기면 동작하지 않아, 먼저 FeatureCollection을 만드는 유틸을 작성했습니다.

```ts
// utils/utils.ts
export const createFeature = (locationInfo: LocationInfo) => ({
  type: "Feature",
  geometry: {
    type: "Point",
    coordinates: [locationInfo.latlng.longitude, locationInfo.latlng.latitude],
  },
  properties: {
    id: locationInfo.id,
    json: JSON.stringify(locationInfo),
  },
});
```

이 구조 덕분에 개별 마커를 눌렀을 때 원본 데이터를 바로 복원할 수 있어서, 디테일 화면으로 네비게이션하는 코드가 간결해졌습니다.

### Step 2. Clusterer 컴포넌트로 렌더링
GeoJSON을 만들었다면 `Clusterer`에 그대로 전달하면 됩니다. 렌더러는 클러스터와 일반 마커 양쪽을 처리하도록 구성했습니다.

```tsx
// screens/Map.tsx
<Clusterer
  data={createFeatureCollection(locationsInfo).features}
  region={mapRegion}
  options={{ radius: clusterRadius }}
  mapDimensions={mapDimentions}
  renderItem={(item) => (
    <Point
      key={item.properties?.cluster_id ?? `point-${item.properties?.id}`}
      item={item}
      onPress={onPressPoint}
      goToDetail={goToDetail}
    />
  )}
/>
```

클러스터 객체는 `properties.cluster` 값으로 구분되는데, `Point` 컴포넌트에서 확장 영역을 계산해 `animateToRegion`으로 부드럽게 줌인하도록 만들었습니다. 이때 `cluster_id`를 키로 쓰면 애니메이션 도중에도 리렌더가 안정적이었습니다.

### Step 3. 줌 레벨에 따라 반경 조절
안드로이드와 iOS의 줌 스케일이 다르다는 걸 뒤늦게 깨닫고, 플랫폼별로 다른 기준을 적용했습니다.

```ts
// screens/Map.tsx
if (isIos()) {
  if (camera.altitude! < 200) setClusterRadius(0);
  else setClusterRadius(20);
} else {
  if (camera.zoom! > 19) setClusterRadius(0);
  else setClusterRadius(20);
}
```

반경을 0으로 두면 클러스터가 풀리고 개별 마커가 나타납니다. 처음에는 단일 기준으로 두었다가, iOS에서만 끝까지 묶여 있는 현상이 생겨서 카메라 고도를 활용하는 쪽으로 바꿨습니다.

### Step 4. 위치 추적과 데이터 필터링 최적화
모든 위치를 한꺼번에 내려받지 않고도 UX를 지키려면 지도 뷰포트 안에 있는 데이터만 가져와야 했습니다. 영역이 바뀔 때마다 `getBoundaryLocations`를 호출하고, 필터는 클라이언트에서 바로 거르도록 했습니다.

```ts
const mapBoundary = getMapBoundary(region);
const { ok, data } = await getBoundaryLocations(mapBoundary);
if (ok && data) {
  const filtered = getFilteredLocation(data, mapFilter, userLocation, true);
  setLocationInfo(getActiveLocations(filtered, user));
}
```

또 `Location.watchPositionAsync`는 `distanceInterval: 1`로 설정해 사용자가 1m 이상 움직일 때만 비싼 연산이 돌도록 했습니다. 배터리 테스트를 위해 하루 종일 켜두었는데, iOS/Android 모두 배터리 소모가 약 3~4%p 정도에 그쳐 안심할 수 있었습니다.

### 예상치 못한 이슈들
- 클러스터 반경을 줄이는 타이밍 때문에 애니메이션이 어색해져서, `onRegionChangeComplete`에서만 데이터를 새로 가져오도록 조정했습니다.
- 초기 로딩 시 위치 권한 팝업 때문에 맵이 멈추는 것처럼 느껴져, 스켈레톤 대신 `ActivityIndicator`를 띄우고 토스트로 안내 문구를 추가했습니다.

## 결과와 회고
실시간 클러스터링을 적용한 뒤에는 약 1,900개의 마커(공공 데이터 1,700건 + 제보 200건)가 있어도 프레임드롭이 거의 느껴지지 않았습니다. 확대하면 즉시 개별 위치를 선택할 수 있어 사용자 제보 전환율이 당시 기준 18%까지 올라갔습니다. 3년이 지난 지금은 지도 SDK와 클러스터링 라이브러리도 업데이트됐지만, "줌 레벨에 맞춰 데이터를 게으르게 가져오자"는 전략은 여전히 기본 원칙으로 남아 있습니다. 여러분은 줌 레벨과 UX 사이에서 어떤 타협을 하고 계신가요? 의견을 들려주세요.

# Reference
- https://github.com/react-native-maps/react-native-maps
- https://docs.expo.dev/versions/latest/sdk/location/

# 연결문서
- [[React Native에서 로컬 리텐션 알림을 스케줄링하며 확인한 포인트]]
- [[네이버 지도 SDK로 모바일 매장 지도를 설계한 과정]]
- [[ActionSheet를 안전하게 감싸는 훅을 만든 이유]]
