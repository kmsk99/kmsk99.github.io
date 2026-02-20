---
tags:
  - ReactNative
  - Keyboard
  - UI
  - Expo
  - Mobile
title: KeyboardStickyView 포커스 버그 수정
created: '2025-07-18'
modified: '2025-07-22'
---

# Intro

입력창이 키보드를 따라 올라가는 Sticky 뷰가 간헐적으로 원래 위치로 돌아오지 않는 버그가 있었다. `react-native-keyboard-controller`의 `KeyboardStickyView`를 래핑해 플랫폼별 이벤트 차이를 흡수했다.

# 래퍼 전략

키보드가 숨길 때 `enabled`를 잠깐 false로 바꿔 레이아웃 계산을 초기화한다. 안전 영역 하단을 기본 offset으로 써서 iPhone의 홈 인디케이터 영역도 자연스럽게 덮는다. 안드로이드에서 `keyboardWillHide` 이벤트가 없을 수 있으므로 `keyboardDidHide`만으로도 동작하게 했다.

Expo 환경이라 네이티브 코드를 수정하기 어려웠고, 라이브러리 수정 대신 래퍼 컴포넌트를 만드는 전략을 택했다. 안전 영역은 `react-native-safe-area-context`로 가져와서 장치별 차이를 흡수했다. 타이머를 사용해야 해서 컴포넌트가 언마운트될 때 타이머를 정리하도록 주의했다.

# 구현 포인트

키보드가 숨길 때 컴포넌트를 완전히 언마운트했다가 100ms 후 다시 마운트해 위치를 강제로 초기화했다. 프로젝트의 `FixedKeyboardStickyView`는 iOS에서 멀티라인 TextInput 높이 변화 후 키보드가 닫힐 때 위치가 복원되지 않는 문제를 이 방식으로 해결했다. 언마운트 시 children을 일반 View로 렌더링해 레이아웃 시프트를 방지한다. 인자로 offset이 없으면 `{ closed: -insets.bottom, opened: 0 }`을 자동 적용했다.

```tsx
export default function FixedKeyboardStickyView({
  children,
  style,
  offset,
}: FixedKeyboardStickyViewProps) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(true);
  const [remountKey, setRemountKey] = useState(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleHide = () => {
      if (Platform.OS === 'ios') {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        setMounted(false);
        hideTimerRef.current = setTimeout(() => {
          setMounted(true);
          setRemountKey(prev => prev + 1);
        }, 100);
      }
    };

    const subs = [
      Keyboard.addListener('keyboardWillHide', handleHide),
      Keyboard.addListener('keyboardDidHide', handleHide),
    ];

    return () => {
      subs.forEach(s => s.remove());
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const computedOffset = offset ?? { closed: -insets.bottom, opened: 0 };

  if (!mounted) {
    return (
      <View style={[style, { position: 'absolute', bottom: -computedOffset.closed, left: 0, right: 0 }]}>
        {children}
      </View>
    );
  }

  return (
    <KeyboardStickyView key={remountKey} offset={computedOffset} style={style}>
      {children}
    </KeyboardStickyView>
  );
}
```

# 결과

입력창이 더 이상 화면 중간에 떠 있지 않고, 키보드 숨김 후에도 안정적으로 제자리로 돌아온다. Android 테스트 기기에서도 동일한 코드를 공유하면서 추가 조건문이 거의 필요 없어졌다. 이후 버전에서 타이머 지연 시간을 기기 성능에 따라 조절하거나 애니메이션 옵션을 노출할 계획이다.

# Reference
- https://github.com/kirillzyusko/react-native-keyboard-controller
- https://reactnative.dev/docs/keyboard

# 연결문서
- [ActionSheet 래퍼 훅 구현](/post/actionsheet-raepeo-huk-guhyeon)
- [Expo 푸시 토큰 등록 흐름 정리](/post/expo-pusi-tokeun-deungnok-heureum-jeongni)
- [React Native 로컬 리텐션 알림 스케줄링](/post/react-native-rokeol-ritensyeon-allim-seukejulling)
