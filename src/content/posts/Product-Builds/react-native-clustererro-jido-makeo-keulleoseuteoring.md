---
tags:
  - ReactNative
  - Maps
  - Clustering
  - Geo
  - Performance
title: react-native-clusterer로 지도 마커 클러스터링
created: '2023-03-09 12:00'
modified: '2023-03-09 15:20'
---

# 문제

3년 전 공공기관 위치 데이터를 정제하고 나니 지도 위 마커 수가 순식간에 3배 가까이 늘었다. 스크롤이 버벅이고, 핀을 탭하려면 3초씩 기다려야 했다. 클러스터링을 도입하기로 마음먹었다.

# 설계

1. GeoJSON FeatureCollection을 만들어 `react-native-clusterer`가 바로 처리할 수 있는 형태로 데이터를 전달했다.
2. 줌 레벨(또는 iOS에서는 카메라 고도)에 따라 클러스터 반경을 동적으로 조절해, 확대 시에는 개별 마커를 그대로 노출했다.
3. 위치 권한과 배터리 이슈를 고려해 `expo-location`의 watch 옵션을 세밀하게 튜닝했다.

# 구현

이미 `react-native-maps`를 쓰고 있었기 때문에, API 차이가 크지 않은 `react-native-clusterer`를 붙이는 것이 자연스러웠다. 클러스터링을 서버 대신 클라이언트에서 처리하려고 GeoJSON 변환 헬퍼를 만드는 쪽을 택했다. 사용자 현재 위치를 계속 추적해야 했기 때문에 `Location.watchPositionAsync` 설정을 여러 번 바꿔 보며 배터리 소모를 측정했다.

### GeoJSON으로 변환하는 헬퍼
Firestore에서 내려받은 `LocationInfo` 배열을 그대로 클러스터러에 넘기면 동작하지 않아, 먼저 FeatureCollection을 만드는 유틸을 작성했다.

```ts
// utils/utils.ts (reference/damta)
export const createFeature = (locationInfo: LocationInfo) => {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [
        locationInfo.latlng.longitude,
        locationInfo.latlng.latitude,
      ],
    },
    properties: {
      id: locationInfo.id,
      json: JSON.stringify(locationInfo),
    },
  };
};

export const createFeatureCollection = (locationsInfo: LocationInfo[]) => {
  const features = locationsInfo.map((location) =>
    createFeature(location)
  ) as any[];
  return {
    type: "FeatureCollection",
    features: features,
  };
};
```

이 구조 덕분에 개별 마커를 눌렀을 때 `properties.json`에서 원본 데이터를 바로 복원할 수 있어서, 디테일 화면으로 네비게이션하는 코드가 간결해졌다.

### Clusterer 컴포넌트로 렌더링
GeoJSON을 만들었다면 `Clusterer`에 그대로 전달하면 된다. 렌더러는 클러스터와 일반 마커 양쪽을 처리하도록 구성했다.

```tsx
// screens/Map.tsx (reference/damta)
<Clusterer
  data={createFeatureCollection(locationsInfo).features}
  region={mapRegion}
  options={{ radius: clusterRadius }}
  mapDimensions={mapDimentions}
  renderItem={(item) => {
    return (
      <Point
        key={
          item.properties?.cluster_id ??
          `point-${item.properties?.id}`
        }
        item={item}
        onPress={onPressPoint}
        goToDetail={goToDetail}
      />
    );
  }}
/>
```

클러스터 객체는 `properties.getClusterExpansionRegion`으로 확장 영역을 구하는데, `Point` 컴포넌트에서 `mapRef.current?.animateToRegion(toRegion, 500)`으로 부드럽게 줌인하도록 만들었다. 이때 `cluster_id`를 키로 쓰면 애니메이션 도중에도 리렌더가 안정적이었다.

### 줌 레벨에 따라 반경 조절
안드로이드와 iOS의 줌 스케일이 다르다는 걸 뒤늦게 깨닫고, 플랫폼별로 다른 기준을 적용했다.

```ts
// screens/Map.tsx (reference/damta)
useEffect(() => {
  mapRef?.current?.getCamera().then((camera) => {
    if (isIos()) {
      if (camera.altitude! < 200) setClusterRadius(0);
      else setClusterRadius(20);
    } else {
      if (camera.zoom! > 19) setClusterRadius(0);
      else setClusterRadius(20);
    }
  });
}, [mapRegion]);
```

반경을 0으로 두면 클러스터가 풀리고 개별 마커가 나타난다. 처음에는 단일 기준으로 두었다가, iOS에서만 끝까지 묶여 있는 현상이 생겨서 카메라 고도를 활용하는 쪽으로 바꿨다.

### 위치 추적과 데이터 필터링 최적화
모든 위치를 한꺼번에 내려받지 않고도 UX를 지키려면 지도 뷰포트 안에 있는 데이터만 가져와야 했다. 영역이 바뀔 때마다 `getBoundaryLocations`를 호출하고, 필터는 클라이언트에서 바로 거르도록 했다.

```ts
// screens/Map.tsx (reference/damta)
const getMapLocationInfo = async (region: Region) => {
  if (!positionLoaded || !user) return;
  const mapBoundary = getMapBoundary(region);
  const { ok, data, error } = await getBoundaryLocations(mapBoundary);
  if (ok && data && userLocation) {
    const filteredLocation = getFilteredLocation(
      data,
      mapFilter,
      userLocation,
      true
    );
    const activeLocation = getActiveLocations(filteredLocation, user);
    setLocationInfo(activeLocation);
  }
};

// watchPositionAsync 설정
const watchPosition = Location.watchPositionAsync(
  {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 5000,
    distanceInterval: 1,
  },
  keepTrackCurrentPosition
);
```

또 `Location.watchPositionAsync`는 `distanceInterval: 1`로 설정해 사용자가 1m 이상 움직일 때만 비싼 연산이 돌도록 했다. 배터리 테스트를 위해 하루 종일 켜두었는데, iOS/Android 모두 배터리 소모가 약 3~4%p 정도에 그쳐 안심할 수 있었다.

# 예상치 못한 이슈

- 클러스터 반경을 줄이는 타이밍 때문에 애니메이션이 어색해져서, `onRegionChangeComplete`에서만 데이터를 새로 가져오도록 조정했다.
- 초기 로딩 시 위치 권한 팝업 때문에 맵이 멈추는 것처럼 느껴져, 스켈레톤 대신 `ActivityIndicator`를 띄우고 토스트로 안내 문구를 추가했다.

# 결과

실시간 클러스터링을 적용한 뒤에는 약 1,900개의 마커(공공 데이터 1,700건 + 제보 200건)가 있어도 프레임드롭이 거의 느껴지지 않았다. 확대하면 즉시 개별 위치를 선택할 수 있어 사용자 제보 전환율이 당시 기준 18%까지 올라갔다. 3년이 지난 지금은 지도 SDK와 클러스터링 라이브러리도 업데이트됐지만, "줌 레벨에 맞춰 데이터를 게으르게 가져오자"는 전략은 여전히 기본 원칙으로 남아 있다.

# Reference
- https://github.com/nicklockwood/react-native-clusterer
- https://github.com/react-native-maps/react-native-maps
- https://docs.expo.dev/versions/latest/sdk/location/

# 연결문서
- [S2 Geometry 기반 서버사이드 지도 클러스터링](/post/s2-geometry-giban-seobeosaideu-jido-keulleoseuteoring)
- [React Native 로컬 리텐션 알림 스케줄링](/post/react-native-rokeol-ritensyeon-allim-seukejulling)
- [네이버 지도 SDK로 매장 지도 구현](/post/neibeo-jido-sdkro-maejang-jido-guhyeon)
- [ActionSheet 래퍼 훅 구현](/post/actionsheet-raepeo-huk-guhyeon)
