---
tags:
  - Engineering
  - TechDeepDive
  - iOS
  - Android
  - Expo
  - ReactNative
  - Frontend
  - Mobile
title: ActionSheet를 안전하게 감싸는 훅을 만든 이유
created: 2024-11-27 12:20
modified: 2024-11-27 12:20
uploaded: "false"
---

# Intro
- iPhone에서 ActionSheet가 홈 인디케이터와 겹치고, Android에서는 취소 버튼이 없을 때 닫히지 않는 문제가 있었습니다.
- 저는 Expo ActionSheet를 감싸는 커스텀 훅을 만들어 안전 영역과 플랫폼별 닫기 패턴을 맞췄습니다.

## 핵심 아이디어 요약
- Safe Area 값을 가져와 컨테이너 하단 패딩을 자동으로 추가했습니다.
- iOS에서 취소 버튼이 없을 경우 자동으로 '취소' 옵션을 붙였습니다.
- Android에서는 취소 버튼 없이도 외부 터치/백버튼으로 닫히도록 `cancelButtonIndex`를 -1로 지정했습니다.

## 준비와 선택
- 이미 `@expo/react-native-action-sheet`를 사용하고 있었기 때문에 머티리얼 디자인을 위한 별도 라이브러리를 추가하지 않았습니다.
- 훅을 통해 `showActionSheetWithOptions`만 감싸 기존 코드 변경을 최소화했습니다.
- 타입 안정성을 위해 ActionSheetOptions를 그대로 받아 전달했습니다.

## 구현 여정
1. **Safe Area 적용**: `useSafeAreaInsets`로 bottom inset을 받은 뒤 컨테이너 스타일에 병합했습니다.
2. **취소 버튼 주입**: iOS에서 기본 옵션 배열에 취소 버튼이 없으면 '취소'를 자동으로 추가했습니다.
3. **Cancel Button Index 조정**: 플랫폼마다 다른 기본값을 설정해 닫기 동작이 일관되게 했습니다.
4. **콜백 래핑**: index가 undefined일 때를 대비해 0 이상일 때만 콜백에 넘겼습니다.
5. **메모이제이션**: `useMemo`로 래핑된 함수를 재사용해 렌더링마다 새로운 함수를 생성하지 않게 했습니다.

```ts
// src/shared/components/ActionSheet/useSafeActionSheet.ts:9-60
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

## 결과와 회고
- iPhone에서 액션시트가 더 이상 홈 인디케이터를 가리지 않고, Android에서도 취소 동작이 자연스러워졌습니다.
- 새 훅을 적용한 이후 기존 코드 변경이 한 줄이라 유지보수가 쉬웠습니다.
- 다음에는 접근성(VoiceOver/토크백) 테스트를 추가해 읽기 순서를 개선할 계획입니다.
- 여러분은 액션시트를 어떻게 커스터마이즈하고 계신가요? 팁이 있다면 댓글로 나눠주세요.

# Reference
- https://github.com/expo/react-native-action-sheet
- https://reactnative.dev/docs/safeareaview

# 연결문서
- [[Android 더블백 종료 규칙을 직접 다듬으며 배운 것]]
- [[Deep Link Friendly Redirect Validation을 구현하며 배운 보안 체크리스트]]
- [[KeyboardStickyView 버그를 잡으면서 적어둔 노트]]
