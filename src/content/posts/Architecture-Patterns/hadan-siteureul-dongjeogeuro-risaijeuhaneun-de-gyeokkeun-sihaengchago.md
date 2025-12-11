---
tags:
  - ReactNative
  - BottomSheet
  - UI
  - UX
  - Expo
  - Mobile
title: 하단 시트를 동적으로 리사이즈하는 데 겪은 시행착오
created: '2024-11-27 11:00'
modified: '2024-11-27 11:00'
---

# Intro
- 바텀시트 안에 들어가는 콘텐츠가 매번 달라지다 보니, 고정 스냅 포인트로는 사용성을 맞출 수가 없었어요.
- 저는 `@gorhom/bottom-sheet`를 기반으로 콘텐츠 높이에 맞춰 스냅 포인트를 계산하고, iOS/Android 오버레이를 분리했습니다.

## 핵심 아이디어 요약
- 콘텐츠 레이아웃 이벤트에서 높이를 측정하고, 안전 영역과 헤더 높이를 더해 비율을 계산합니다.
- 스냅 포인트를 3단계(피크/콘텐츠 맞춤/최대)로 강제 정렬해 흔들리지 않는 UX를 만들었습니다.
- 포털과 블러 뷰를 이용해 모달 레이어와 겹치지 않도록 관리했습니다.

## 준비와 선택
- 공용 컴포넌트이기 때문에 `Portal`을 적용해 어디서든 동일한 최상위 레이어로 띄우게 했습니다.
- iOS에서만 블러 오버레이가 자연스러워 `BlurView`를 조건부로 적용했고, Android에는 기본 백드롭을 활용했습니다.
- handleComponent는 공통 헤더로 교체하면서 여닫기 제스처를 상황에 따라 막는 옵션도 넣었습니다.

## 구현 여정
1. **콘텐츠 높이 측정**: `onLayout` 이벤트에서 높이를 저장하고, 변경될 때마다 스냅 포인트를 재계산했습니다.
2. **스냅 포인트 산식**: 최소 피크, 최대 92%를 기준으로 콘텐트 비율에 맞춰 반올림한 값을 사용했습니다.
3. **대형 콘텐츠 판별**: 높이가 70%를 넘으면 최초 위치를 최상단에 맞춰 긴 스크롤에서 헤더가 바로 드러나게 했습니다.
4. **블러 백드롭**: iOS에선 `BlurView`에 반투명 배경을 추가하고, Android에서는 `BottomSheetBackdrop`을 그대로 사용했습니다.
5. **제스처 제어**: `freeze` 옵션이 true면 pan 제스처를 막아 모달처럼 사용할 수 있게 했습니다.

```tsx
// src/shared/components/BottomSheet/ui/BaseBottomSheet.tsx:36-255
export default function BaseBottomSheet({
  isOpen,
  onClose,
  children,
  noPadding = false,
  disableOverlayClick = false,
  blurOverlay = false,
  freeze = false,
  portalName,
}: BaseBottomSheetProps) {
  const bottomSheetRef = useRef<BottomSheetCore>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const screenHeight = useMemo(() => Dimensions.get('window').height, []);
  const insets = useSafeAreaInsets();
  const generatePortalName = useSetAtom(generatePortalNameAtom);
  const finalPortalName = useMemo(
    () => portalName || generatePortalName(),
    [portalName, generatePortalName],
  );

  const snapPoints = useMemo(() => {
    if (contentHeight === 0) return ['33%', '60%', '92%'];
    const headerAndPaddingPx = 72;
    const totalNeededHeight = contentHeight + headerAndPaddingPx + insets.bottom;
    const rawFitPercent = (totalNeededHeight / screenHeight) * 100;
    const maxPercent = 92;
    const minPeekPercent = 25;
    const defaultPeekPercent = 33;

    const clamp = (value: number, min: number, max: number) =>
      Math.min(Math.max(value, min), max);
    const roundTo5 = (value: number) => Math.round(value / 5) * 5;

    const fitPercent = clamp(roundTo5(rawFitPercent), minPeekPercent, maxPercent);
    let points: number[];

    if (fitPercent <= 40) {
      const peek = Math.min(defaultPeekPercent, Math.max(minPeekPercent, fitPercent - 10));
      const mid = fitPercent;
      const top = clamp(roundTo5(fitPercent + 20), mid + 5, maxPercent);
      points = [peek, mid, top];
    } else if (fitPercent <= 70) {
      points = [defaultPeekPercent, fitPercent, maxPercent];
    } else {
      const mid = roundTo5((defaultPeekPercent + fitPercent) / 2);
      points = [
        defaultPeekPercent,
        clamp(mid, defaultPeekPercent + 5, fitPercent - 5),
        fitPercent,
      ];
    }

    const uniqueSorted = Array.from(new Set(points)).sort((a, b) => a - b);
    return uniqueSorted.slice(0, 3).map(v => `${v}%`) as [string, string, string];
  }, [contentHeight, insets.bottom, screenHeight]);

  const renderBackdrop = useCallback(
    (props: any) => {
      if (!isOpen) return null;
      if (blurOverlay) {
        return (
          <BlurView
            intensity={20}
            style={[props.style, { backgroundColor: 'rgba(0, 0, 0, 0.5)' }]}
            onTouchStart={disableOverlayClick ? undefined : onClose}
          />
        );
      }
      return (
        <BottomSheetBackdrop
          {...props}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          opacity={0.6}
          style={[props.style, { backgroundColor: 'rgba(0, 0, 0, 0.5)' }]}
          onPress={disableOverlayClick ? undefined : onClose}
        />
      );
    },
    [blurOverlay, disableOverlayClick, isOpen, onClose],
  );

  return (
    <Portal hostName='root' name={finalPortalName}>
      <BottomSheetCore
        ref={bottomSheetRef}
        backdropComponent={renderBackdrop}
        backgroundStyle={{
          backgroundColor: colors.white,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
        }}
        enableContentPanningGesture={!freeze}
        enableHandlePanningGesture={!freeze}
        enablePanDownToClose={!freeze}
        handleComponent={BottomSheetHeader}
        index={-1}
        snapPoints={snapPoints}
        onChange={index => index === -1 && onClose()}
      >
        <BottomSheetView style={[tw`flex-1`, { paddingBottom: insets.bottom + 16 }]}>
          <View style={tw`${clsx('flex-1', !noPadding && 'px-4')}`} onLayout={event => {
            setContentHeight(event.nativeEvent.layout.height);
          }}>
            {children}
          </View>
        </BottomSheetView>
      </BottomSheetCore>
    </Portal>
  );
}
```

## 결과와 회고
- 콘텐츠에 따라 자연스럽게 크기가 바뀌는 하단 시트를 만들었고, 작은 목록에서는 피크가 너무 높게 잡히던 문제도 해결했습니다.
- 블러 오버레이 덕분에 iOS에서 모달과 겹칠 때 자연스러운 전환이 되면서 디자인 팀의 피드백도 줄었습니다.
- 다음에는 스냅 포인트 데이터와 애널리틱스를 연결해 사용자들이 어떤 높이를 가장 많이 쓰는지 분석해볼 생각입니다.
- 여러분은 바텀시트를 얼마나 커스터마이즈하고 계신가요? 다른 아이디어가 있다면 댓글로 공유해주세요.

# Reference
- https://gorhom.github.io/react-native-bottom-sheet/
- https://docs.expo.dev/versions/latest/sdk/blur-view/

# 연결문서
- [ActionSheet를 안전하게 감싸는 훅을 만든 이유](/post/actionsheetreul-anjeonhage-gamssaneun-hugeul-mandeun-iyu)
- React 에서 인앱브라우저에서 외부브라우저 띄우기
- [Android 더블백 종료 규칙을 직접 다듬으며 배운 것](/post/android-deobeulbaek-jongnyo-gyuchigeul-jikjeop-dadeumeumyeo-baeun-geot)
