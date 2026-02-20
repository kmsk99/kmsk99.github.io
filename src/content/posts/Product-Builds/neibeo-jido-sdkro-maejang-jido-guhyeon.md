---
tags:
  - ReactNative
  - NaverMap
  - Maps
  - UX
  - Mobile
title: 네이버 지도 SDK로 매장 지도 구현
created: '2025-11-27 10:40'
modified: '2025-11-27 10:40'
---

# 문제

위치 기반 혜택 지도를 만들다 보니, 지도 초기화 타이밍과 현재 위치 이동이 서로 꼬여 UX가 흔들렸다. React Native에서 네이버 지도 SDK를 써서 클러스터링, 현재 위치 자동 이동, 경계 계산을 전부 커스텀했다.

# 설계

- 위치 권한과 현재 위치를 비동기로 가져올 때 자동 이동을 한 번만 허용하는 레퍼런스를 두었다.
- 카메라 이벤트를 이용해 현재 Bounds를 계산하고, 화면에 보이는 매장만 필터링했다.
- 줌 레벨에 따라 커스텀 클러스터 이미지를 토글해 성능과 가독성을 동시에 챙겼다.

# 구현

국내 사용성을 고려해 `@mj-studio/react-native-naver-map`을 선택했고, Expo 환경에서도 호환이 괜찮았다. `expo-location`으로 GPS를 가져오되, 테스트 편의를 위해 실패 시 토스트만 띄우고 루틴은 계속 돌게 두었다. React `forwardRef`를 이용해 외부 컴포넌트가 지도 이동 함수를 직접 호출할 수 있게 만들었다.

### 현재 위치 관리
`useRef`를 이용해 자동 이동 억제 플래그와 실행 여부를 분리했고, 위치 가져오기가 실패하면 권한 가용성과 함께 UI에 알렸다.

### 카메라 이벤트 처리
`onCameraChanged`, `onCameraIdle` 이벤트에서 새로운 Bounds를 계산하고, 현재 중심과의 거리를 측정해 상태를 업데이트했다.

### 클러스터 전략
줌 레벨이 11 이하이면서 화면 내 마커가 20개 이상일 때만 클러스터링을 활성화했다.

### 안전한 초기화
지도 초기화 시점에 권한 여부와 현재 위치를 다시 확인하고, 자동 이동이 비활성화된 경우 기본 좌표로 이동하게 했다.

### 가시 영역 필터링
`useMemo`로 계산 비용을 줄이고, Bounds 안에 있는 매장만 보여 줘서 성능과 UX를 맞췄다.

```tsx
const visibleStores = useMemo(() => {
  if (!stores.length) return [];
  const visible = stores.filter(store => {
    if (!store.latitude || !store.longitude) return false;
    if (currentBounds.sw.lat > store.latitude) return false;
    if (currentBounds.ne.lat < store.latitude) return false;
    if (currentBounds.sw.lng > store.longitude) return false;
    if (currentBounds.ne.lng < store.longitude) return false;
    return true;
  });
  return visible;
}, [stores, currentBounds]);

// 줌 11 이하, 미선택 매장 20개 이상일 때만 클러스터링
<NaverMapView
  ref={mapRef}
  clusters={[
    {
      markers:
        zoom <= 11 && unselectedStores.length >= 20
          ? unselectedStores.map(store => ({
              identifier: store.id,
              latitude: store.latitude!,
              longitude: store.longitude!,
              image:
                store.brand?.category === '음식'
                  ? food
                  : store.brand?.category === '운동'
                    ? gym
                    : store.brand?.category === '여행'
                      ? travel
                      : store.brand?.category === '교육'
                        ? education
                        : ect,
              width: 24,
              height: 24,
            }))
          : [],
      screenDistance: 50,
      maxZoom: 11,
    },
  ]}
  onCameraChanged={handleCameraChanged}
  onCameraIdle={handleCameraIdle}
  onInitialized={() => {
    const isSuppressed =
      suppressAutoMoveRef.current || disableAutoMoveToCurrent;
    const initLat = isSuppressed
      ? 37.481556
      : currentPosition?.latitude || 37.481556;
    const initLng = isSuppressed
      ? 126.882583
      : currentPosition?.longitude || 126.882583;
    handleCameraIdle({ latitude: initLat, longitude: initLng, zoom: 15 });
  }}
>
  {currentPosition && (
    <NaverMapMarkerOverlay
      latitude={currentPosition.latitude}
      longitude={currentPosition.longitude}
      image={currentLocationIcon}
    />
  )}
  <StoreMarkerList
    selectedStore={selectedStore}
    setSelectedStore={setSelectedStore}
    unselectedStores={unselectedStores}
    zoom={zoom}
  />
</NaverMapView>
```

# 결과

초기 렌더링 때 지도가 튀는 현상이 사라졌고, 매장 리스트가 더 빠르게 로드돼 사용자가 "빠르다"는 피드백을 줬다. 위치 권한을 거절해도 지도는 기본 위치로 뜨기 때문에 공백 화면이 없고, 권한 허용 시 즉시 현재 위치로 이동한다. 다음엔 네이버 지도 SDK의 실시간 클러스터 옵션을 조정해 대도시에서도 프레임 드랍을 줄이는 실험을 할 예정이다.

# Reference
- https://navermaps.github.io/android-map-sdk/guide-ko/
- https://docs.expo.dev/versions/latest/sdk/location/

# 연결문서
- [react-native-clusterer로 지도 마커 클러스터링](/post/react-native-clustererro-jido-makeo-keulleoseuteoring)
- [KeyboardStickyView 포커스 버그 수정](/post/keyboardstickyview-pokeoseu-beogeu-sujeong)
- [React Native 파일 업로드 유틸 구현](/post/react-native-pail-eomnodeu-yutil-guhyeon)
