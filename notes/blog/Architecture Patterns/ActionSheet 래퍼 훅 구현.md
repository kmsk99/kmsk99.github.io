---
tags:
  - ReactNative
  - Expo
  - Mobile
  - UI
  - Hooks
  - ActionSheet
title: ActionSheet 래퍼 훅 구현
created: 2025-11-27 12:20
modified: 2025-11-27 12:20
---

# Intro

iPhone에서 ActionSheet가 홈 인디케이터와 겹치고, Android에서는 취소 버튼이 없을 때 닫히지 않는 문제가 있었다. Expo ActionSheet를 감싸는 커스텀 훅을 만들어 안전 영역과 플랫폼별 닫기 패턴을 맞췄다.

# 훅 설계

Safe Area 값을 가져와 컨테이너 하단 패딩을 자동으로 추가했다. iOS에서 취소 버튼이 없을 경우 자동으로 '취소' 옵션을 붙였다. Android에서는 취소 버튼 없이도 외부 터치/백버튼으로 닫히도록 `cancelButtonIndex`를 -1로 지정했다.

이미 `@expo/react-native-action-sheet`를 사용하고 있었기 때문에 머티리얼 디자인을 위한 별도 라이브러리를 추가하지 않았다. 훅을 통해 `showActionSheetWithOptions`만 감싸 기존 코드 변경을 최소화했다. 타입 안정성을 위해 ActionSheetOptions를 그대로 받아 전달했다.

# 구현 포인트

`useSafeAreaInsets`로 bottom inset을 받은 뒤 컨테이너 스타일에 병합했다. iOS에서 기본 옵션 배열에 취소 버튼이 없으면 '취소'를 자동으로 추가했다. 플랫폼마다 다른 기본값을 설정해 닫기 동작이 일관되게 했다. index가 undefined일 때를 대비해 0 이상일 때만 콜백에 넘겼다. `useMemo`로 래핑된 함수를 재사용해 렌더링마다 새로운 함수를 생성하지 않게 했다.

```ts
export function useSafeActionSheet() {
  const { showActionSheetWithOptions } = useActionSheet();
  const insets = useSafeAreaInsets();

  const safeShowActionSheetWithOptions = useMemo(() => {
    return (
      options: ActionSheetOptions,
      callback: (i?: number) => void | Promise<void>,
    ) => {
      const containerStyle: ViewStyle = {
        paddingBottom: insets.bottom,
        ...(options.containerStyle ?? {}),
      };

      const baseOptions = options.options ?? [];
      let nextOptions = baseOptions;
      let nextCancelButtonIndex = options.cancelButtonIndex;

      if (
        Platform.OS === 'ios' &&
        (typeof nextCancelButtonIndex === 'undefined' || nextCancelButtonIndex < 0)
      ) {
        nextOptions = [...baseOptions, '취소'];
        nextCancelButtonIndex = baseOptions.length;
      }

      const normalizedOptions: ActionSheetOptions = {
        ...options,
        options: nextOptions,
        cancelButtonIndex:
          Platform.OS === 'ios'
            ? nextCancelButtonIndex
            : typeof options.cancelButtonIndex === 'undefined'
              ? -1
              : options.cancelButtonIndex,
        containerStyle,
      };

      showActionSheetWithOptions(normalizedOptions, index => {
        const normalizedIndex =
          typeof index === 'number' && index >= 0 ? index : undefined;
        return callback(normalizedIndex);
      });
    };
  }, [insets.bottom, showActionSheetWithOptions]);

  return {
    showActionSheetWithOptions: safeShowActionSheetWithOptions,
  };
}
```

# 결과

iPhone에서 액션시트가 더 이상 홈 인디케이터를 가리지 않고, Android에서도 취소 동작이 자연스러워졌다. 새 훅을 적용한 이후 기존 코드 변경이 한 줄이라 유지보수가 쉬웠다. 다음에는 접근성(VoiceOver/토크백) 테스트를 추가해 읽기 순서를 개선할 계획이다.

# Reference
- https://github.com/expo/react-native-action-sheet
- https://reactnative.dev/docs/safeareaview

# 연결문서
- [[Android 더블백 종료 처리]]
- [[KeyboardStickyView 포커스 버그 수정]]
