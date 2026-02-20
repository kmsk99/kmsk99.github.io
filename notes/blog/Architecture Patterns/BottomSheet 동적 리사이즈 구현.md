---
tags:
  - ReactNative
  - BottomSheet
  - UI
  - UX
  - Expo
  - Mobile
title: BottomSheet 동적 리사이즈 구현
created: 2025-12-10
modified: 2026-01-07
---

# Intro

바텀시트 안에 들어가는 콘텐츠가 매번 달라지다 보니, 고정 스냅 포인트로는 사용성을 맞출 수가 없었다. `@gorhom/bottom-sheet`를 기반으로 콘텐츠 높이에 맞춰 스냅 포인트를 계산하고, iOS/Android 오버레이를 분리했다.

# 동적 스냅 포인트

콘텐츠 레이아웃 이벤트에서 높이를 측정하고, 안전 영역과 헤더 높이를 더해 비율을 계산한다. 스냅 포인트를 3단계(피크/콘텐츠 맞춤/최대)로 강제 정렬해 흔들리지 않는 UX를 만들었다. 포털과 블러 뷰를 이용해 모달 레이어와 겹치지 않도록 관리했다.

공용 컴포넌트이기 때문에 `Portal`을 적용해 어디서든 동일한 최상위 레이어로 띄우게 했다. iOS에서만 블러 오버레이가 자연스러워 `BlurView`를 조건부로 적용했고, Android에는 기본 백드롭을 활용했다. handleComponent는 공통 헤더로 교체하면서 여닫기 제스처를 상황에 따라 막는 옵션도 넣었다.

# 구현 포인트

웹 환경에서는 `ResizeObserver`로 콘텐츠 높이를 감지하고, `scrollHeight`와 `window.innerHeight`를 이용해 시트 높이를 동적으로 계산한다. `useBottomSheet` 훅에서 `updateMaxY`가 콘텐츠 로딩 후 `setMaxY`로 시트가 펼쳐질 최대 높이를 설정한다.

```tsx
useEffect(() => {
  const updateMaxY = () => {
    if (content.current) {
      const contentHeight = content.current.scrollHeight;
      const windowHeight = window.innerHeight;
      const calculatedMaxY = Math.min(
        contentHeight + HEADER_HEIGHT,
        windowHeight - BOTTOM_SHEET_MARGIN,
      );
      setMaxY(calculatedMaxY);
      setIsContentLoaded(true);
    }
  };

  if (isOpen) {
    updateMaxY();
    window.addEventListener('resize', updateMaxY);
  }

  return () => window.removeEventListener('resize', updateMaxY);
}, [isOpen]);
```

BottomSheet 컴포넌트에서는 `ResizeObserver`로 content ref를 감시해 콘텐츠가 동적으로 늘어나면 `updateSheetHeight`를 호출한다.

```tsx
// src/shared/components/BottomSheet/ui/BottomSheet.tsx (schoolmeets - 웹)
const updateSheetHeight = useCallback(() => {
  if (content.current) {
    const contentHeight = content.current.scrollHeight;
    const availableHeight = visualViewportHeight || window.innerHeight;
    const newHeight = Math.min(
      contentHeight + HEADER_HEIGHT,
      availableHeight - BOTTOM_SHEET_MARGIN,
    );
    setSheetHeight(newHeight);
  }
}, [content, visualViewportHeight]);

useEffect(() => {
  const contentRef = content.current;
  if (isOpen && contentRef) {
    updateSheetHeight();
    const resizeObserver = new ResizeObserver(updateSheetHeight);
    resizeObserver.observe(contentRef);
    return () => contentRef && resizeObserver.unobserve(contentRef);
  }
}, [content, isOpen, updateSheetHeight]);
```

React Native(`@gorhom/bottom-sheet`)에서는 `onLayout` 이벤트에서 높이를 저장하고, 변경될 때마다 스냅 포인트를 재계산한다. puffzone-app의 `ListBottomSheet`는 아이템 유무에 따라 스냅 포인트를 바꾼다.

```tsx
// src/widgets/List/ui/ListBottomSheet.tsx (puffzone-app)
const hasItems = sortedItems.length > 0;
const snapPoints = useMemo(
  () => (hasItems ? ['30%', '50%', '90%'] : ['30%', '70%']),
  [hasItems],
);

return (
  <BottomSheet
    ref={bottomSheetRef}
    enablePanDownToClose
    enableDynamicSizing={false}
    index={-1}
    snapPoints={snapPoints}
    onChange={handleSheetChanges}
  >
    <BottomSheetFlatList ... />
  </BottomSheet>
);
```

`@gorhom/bottom-sheet`를 쓰는 다른 프로젝트에서는 `contentHeight`를 `onLayout`으로 측정해 스냅 포인트를 3단계(피크/콘텐츠 맞춤/최대)로 계산한다.

```tsx
// BaseBottomSheet (React Native - contentHeight 기반 동적 스냅)
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

# 결과

콘텐츠에 따라 자연스럽게 크기가 바뀌는 하단 시트를 만들었고, 작은 목록에서는 피크가 너무 높게 잡히던 문제도 해결했다. 블러 오버레이 덕분에 iOS에서 모달과 겹칠 때 자연스러운 전환이 되면서 디자인 팀의 피드백도 줄었다. 다음에는 스냅 포인트 데이터와 애널리틱스를 연결해 사용자들이 어떤 높이를 가장 많이 쓰는지 분석해볼 생각이다.

# Reference
- https://github.com/gorhom/react-native-bottom-sheet
- https://gorhom.github.io/react-native-bottom-sheet/
- https://docs.expo.dev/versions/latest/sdk/blur-view/

# 연결문서
- [[ActionSheet 래퍼 훅 구현]]
- [[Android 더블백 종료 처리]]
