---
tags:
  - Engineering
  - TechDeepDive
  - Maps
  - UX
  - ReactNative
  - Expo
  - Performance
  - Payment
title: 네이버 지도 SDK로 모바일 매장 지도를 설계한 과정
created: 2024-11-27 10:40
modified: 2024-11-27 10:40
uploaded: "false"
---

# Intro
- 위치 기반 혜택 지도를 만들다 보니, 지도 초기화 타이밍과 현재 위치 이동이 서로 꼬여 UX가 흔들렸습니다.
- 저는 React Native에서 네이버 지도 SDK를 써서 클러스터링, 현재 위치 자동 이동, 경계 계산을 전부 커스텀했습니다.

## 핵심 아이디어 요약
- 위치 권한과 현재 위치를 비동기로 가져올 때 자동 이동을 한 번만 허용하는 레퍼런스를 두었습니다.
- 카메라 이벤트를 이용해 현재 Bounds를 계산하고, 화면에 보이는 매장만 필터링했습니다.
- 줌 레벨에 따라 커스텀 클러스터 이미지를 토글해 성능과 가독성을 동시에 챙겼습니다.

## 준비와 선택
- 국내 사용성을 고려해 `@mj-studio/react-native-naver-map`을 선택했고, Expo 환경에서도 호환이 괜찮았습니다.
- `expo-location`으로 GPS를 가져오되, 테스트 편의를 위해 실패 시 토스트만 띄우고 루틴은 계속 돌게 두었습니다.
- React `forwardRef`를 이용해 외부 컴포넌트가 지도 이동 함수를 직접 호출할 수 있게 만들었습니다.

## 구현 여정
1. **현재 위치 관리**: `useRef`를 이용해 자동 이동 억제 플래그와 실행 여부를 분리했고, 위치 가져오기가 실패하면 권한 가용성과 함께 UI에 알렸습니다.
2. **카메라 이벤트 처리**: `onCameraChanged`, `onCameraIdle` 이벤트에서 새로운 Bounds를 계산하고, 현재 중심과의 거리를 측정해 상태를 업데이트했습니다.
3. **클러스터 전략**: 줌 레벨이 11 이하이면서 화면 내 마커가 20개 이상일 때만 클러스터링을 활성화했습니다.
4. **안전한 초기화**: 지도 초기화 시점에 권한 여부와 현재 위치를 다시 확인하고, 자동 이동이 비활성화된 경우 기본 좌표로 이동하게 했습니다.
5. **가시 영역 필터링**: `useMemo`로 계산 비용을 줄이고, Bounds 안에 있는 매장만 보여 줘서 성능과 UX를 맞췄습니다.

```tsx
// src/widgets/Map/ui/BenefitMap.tsx:78-395
const BenefitMap = forwardRef<BenefitMapRef, BenefitMapProps>((props, ref) => {
  const mapRef = useRef<NaverMapViewRef>(null);
  const suppressAutoMoveRef = useRef(false);
  const hasAutoMovedToCurrentRef = useRef(false);
  const [currentPosition, setCurrentPosition] = useState<Coordinates | null>(null);
  const [mapRegion, setMapRegion] = useState<Region>({
    latitude: 37.481556,
    longitude: 126.882583,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });
  const [zoom, setZoom] = useState(15);

  const getCurrentLocation = useCallback(async () => {
    try {
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
        distanceInterval: 10,
      });
      const { latitude, longitude } = location.coords;
      setCurrentPosition({ latitude, longitude });
      props.onLocationAvailabilityChange?.(true);
      return { latitude, longitude };
    } catch (err) {
      props.onLocationAvailabilityChange?.(false);
      return null;
    }
  }, [props.onLocationAvailabilityChange]);

  const tryAutoMoveToCurrentLocationOnce = useCallback(() => {
    if (!currentPosition || !mapRef.current) return;
    if (props.disableAutoMoveToCurrent) return;
    if (suppressAutoMoveRef.current) return;
    if (hasAutoMovedToCurrentRef.current) return;
    mapRef.current.animateCameraTo(currentPosition);
    hasAutoMovedToCurrentRef.current = true;
  }, [currentPosition, props.disableAutoMoveToCurrent]);

  const handleCameraIdle = useCallback((camera: Camera & { region?: Region }) => {
    const zoomValue = camera.zoom || 15;
    setZoom(zoomValue);
    if (camera.region) {
      const region = camera.region;
      props.setLatLngBounds({
        sw: { lat: region.latitude, lng: region.longitude },
        ne: {
          lat: region.latitude + region.latitudeDelta,
          lng: region.longitude + region.longitudeDelta,
        },
      });
      return;
    }
    const latitudeDelta = 180 / Math.pow(2, zoomValue - 1);
    const longitudeDelta = 360 / Math.pow(2, zoomValue - 1);
    props.setLatLngBounds({
      sw: {
        lat: camera.latitude - latitudeDelta / 2,
        lng: camera.longitude - longitudeDelta / 2,
      },
      ne: {
        lat: camera.latitude + latitudeDelta / 2,
        lng: camera.longitude + longitudeDelta / 2,
      },
    });
  }, [props]);

  return (
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
                  image: getClusterIcon(store.brand?.category),
                  width: 24,
                  height: 24,
                }))
              : [],
          screenDistance: 50,
          maxZoom: 11,
        },
      ]}
      onCameraIdle={handleCameraIdle}
      onInitialized={() => {
        handleCameraIdle({
          latitude: currentPosition?.latitude ?? 37.481556,
          longitude: currentPosition?.longitude ?? 126.882583,
          zoom: 15,
        });
      }}
    >
      {currentPosition && (
        <NaverMapMarkerOverlay
          latitude={currentPosition.latitude}
          longitude={currentPosition.longitude}
          image={currentLocationIcon}
        />
      )}
      <StoreMarkerList ... />
    </NaverMapView>
  );
});
```

## 결과와 회고
- 초기 렌더링 때 지도가 튀는 현상이 사라졌고, 매장 리스트가 더 빠르게 로드돼 사용자가 “빠르다”는 피드백을 주었습니다.
- 위치 권한을 거절해도 지도는 기본 위치로 뜨기 때문에 공백 화면이 없고, 권한 허용 시 즉시 현재 위치로 이동합니다.
- 다음엔 네이버 지도 SDK의 실시간 클러스터 옵션을 조정해 대도시에서도 프레임 드랍을 줄이는 실험을 할 예정입니다.
- 여러분은 모바일 지도에서 어떤 UX를 가장 중점적으로 다루시나요? 의견을 들려주세요.

# Reference
- https://docs.expo.dev/versions/latest/sdk/location/

# 연결문서
- [[대용량 지도 마커를 실시간으로 클러스터링한 이야기]]
- [[KeyboardStickyView 버그를 잡으면서 적어둔 노트]]
- [[React Native 파일 업로드 파이프라인을 정리한 기록]]
