---
tags:
  - ReactNative
  - Keyboard
  - UI
  - Expo
  - Mobile
title: KeyboardStickyView 버그를 잡으면서 적어둔 노트
created: '2024-11-27 11:20'
modified: '2024-11-27 11:20'
---

# Intro
- 입력창이 키보드를 따라 올라가는 Sticky 뷰가 간헐적으로 원래 위치로 돌아오지 않는 버그가 있었습니다.
- 저는 `react-native-keyboard-controller`의 `KeyboardStickyView`를 래핑해 플랫폼별 이벤트 차이를 흡수했습니다.

## 핵심 아이디어 요약
- 키보드가 숨길 때 `enabled`를 잠깐 false로 바꿔 레이아웃 계산을 초기화합니다.
- 안전 영역 하단을 기본 offset으로 써서 iPhone의 홈 인디케이터 영역도 자연스럽게 덮습니다.
- 안드로이드에서 `keyboardWillHide` 이벤트가 없을 수 있으므로 `keyboardDidHide`만으로도 동작하게 했습니다.

## 준비와 선택
- Expo 환경이라 네이티브 코드를 수정하기 어려웠고, 라이브러리 수정 대신 래퍼 컴포넌트를 만드는 전략을 택했습니다.
- 안전 영역은 `react-native-safe-area-context`로 가져와서 장치별 차이를 흡수했습니다.
- 타이머를 사용해야 해서 컴포넌트가 언마운트될 때 타이머를 정리하도록 주의했습니다.

## 구현 여정
1. **상태 토글 전략**: 키보드가 숨길 때 `enabled`를 false로 바꾼 뒤 60ms 후 true로 돌려 레이아웃 캐시를 리셋했습니다.
2. **이벤트 구독**: iOS에서는 `keyboardWillHide`와 `keyboardDidHide`를 모두 구독하고, 안드로이드는 동일한 핸들러를 공유했습니다.
3. **Offset 기본값**: 인자로 offset이 없으면 `{ closed: -insets.bottom, opened: 0 }`을 자동 적용했습니다.
4. **클린업**: 언마운트 시 이벤트 리스너와 타이머를 전부 정리해 메모리 릭을 방지했습니다.
5. **재사용성 확보**: props로 전달되는 스타일과 children을 그대로 통과시켜 기존 코드 교체가 쉬웠습니다.

```tsx
// src/shared/components/Keyboard/ui/FixedKeyboardStickyView.tsx:18-60
export default function FixedKeyboardStickyView({
  children,
  style,
  offset,
}: FixedKeyboardStickyViewProps) {
  const insets = useSafeAreaInsets();
  const [enabled, setEnabled] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleHide = () => {
      setEnabled(false);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setEnabled(true), 60);
    };

    const subs = [
      Keyboard.addListener('keyboardWillHide', handleHide),
      Keyboard.addListener('keyboardDidHide', handleHide),
    ];

    if (Platform.OS === 'android') {
      // Android에서는 will 이벤트가 없어도 did 이벤트만으로 복원됨
    }

    return () => {
      subs.forEach(s => s.remove());
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const computedOffset = offset ?? {
    closed: -insets.bottom,
    opened: 0,
  };

  return (
    <KeyboardStickyView enabled={enabled} offset={computedOffset} style={style}>
      {children}
    </KeyboardStickyView>
  );
}
```

## 결과와 회고
- 입력창이 더 이상 화면 중간에 떠 있지 않고, 키보드 숨김 후에도 안정적으로 제자리로 돌아옵니다.
- Android 테스트 기기에서도 동일한 코드를 공유하면서 추가 조건문이 거의 필요 없어졌습니다.
- 이후 버전에서 타이머 지연 시간을 기기 성능에 따라 조절하거나 애니메이션 옵션을 노출할 계획입니다.
- 여러분은 키보드 연동 시 어떤 버그를 가장 많이 만나시나요? 함께 얘기해봐요.

# Reference
- https://github.com/kirillzyusko/react-native-keyboard-controller
- https://reactnative.dev/docs/keyboard

# 연결문서
- [ActionSheet를 안전하게 감싸는 훅을 만든 이유](/post/actionsheetreul-anjeonhage-gamssaneun-hugeul-mandeun-iyu)
- [Expo 푸시 토큰 등록 루틴에서 배운 것](/post/expo-pusi-tokeun-deungnok-rutineseo-baeun-geot)
- [React Native에서 로컬 리텐션 알림을 스케줄링하며 확인한 포인트](/post/react-nativeeseo-rokeol-ritensyeon-allimeul-seukejullinghamyeo-hwakginhan-pointeu)
