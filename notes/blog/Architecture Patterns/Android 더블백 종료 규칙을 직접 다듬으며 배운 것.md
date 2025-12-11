---
tags:
  - Android
  - Expo
  - Navigation
  - BackHandler
  - UX
  - Mobile
title: Android 더블백 종료 규칙을 직접 다듬으며 배운 것
created: 2024-11-27 12:40
modified: 2024-11-27 12:40
---

# Intro
- Android에서 뒤로가기를 눌렀을 때 앱이 곧장 종료되는 문제가 있어, 홈 탭인지 여부를 확인해 제어해야 했습니다.
- 저는 Expo Router와 BackHandler를 이용해 더블백(exit) 패턴을 구현하고 안내 토스트를 띄웠습니다.

## 핵심 아이디어 요약
- 루트 경로인지 확인하는 헬퍼를 전달받아 더블백 동작 여부를 결정했습니다.
- `router.canGoBack()`으로 히스토리가 있으면 기본 뒤로 이동을 허용했습니다.
- 루트가 아니면 첫 번째 뒤로에서 홈으로 replace하고, 루트면 안내 메시지를 보여준 뒤 1.5초 안에 한 번 더 눌러야 종료하도록 했습니다.

## 준비와 선택
- Expo Router가 제공하는 `useRouter`를 활용해 네비게이션 상태를 체크했습니다.
- 토스트는 이미 사용 중인 `infoMessage` 컴포넌트를 재사용했습니다.
- 타이밍을 쉽게 제어하기 위해 `useRef`로 마지막 백버튼 시간을 저장했습니다.

## 구현 여정
1. **조건부 활성화**: Android에서만 작동하도록 `Platform.OS`를 체크했습니다.
2. **루트 판별**: 외부에서 전달된 `isAtFeedRoot` 함수를 사용해 현재 경로가 홈인지 확인했습니다.
3. **홈이 아닐 때 처리**: 첫 번째 뒤로는 홈으로 `router.replace('/')`하고, 1.5초 내 다시 누르면 앱을 종료했습니다.
4. **홈일 때 처리**: 안내 메시지를 띄우고, 1.5초 내 다시 누르면 `BackHandler.exitApp()`을 호출했습니다.
5. **정리 작업**: 언마운트 시 이벤트 리스너를 제거했습니다.

```ts
// src/shared/hooks/root.ts:130-167
export function useAndroidDoubleBackExit({
  isAtFeedRoot,
  pathname,
}: AndroidDoubleBackExitOptions) {
  const router = useRouter();
  const lastBackPressRef = useRef(0);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onBackPress = () => {
      const canGoBack = router?.canGoBack ? router.canGoBack() : false;
      if (canGoBack) return false;

      if (!isAtFeedRoot(pathname)) {
        const now = Date.now();
        if (now - lastBackPressRef.current < 1500) {
          BackHandler.exitApp();
          return true;
        }
        lastBackPressRef.current = now;
        router.replace('/');
        return true;
      }

      const now = Date.now();
      if (now - lastBackPressRef.current < 1500) {
        BackHandler.exitApp();
        return true;
      }
      lastBackPressRef.current = now;
      infoMessage('뒤로가기를 한 번 더 누르시면 종료됩니다');
      return true;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [router, pathname, isAtFeedRoot]);
}
```

## 결과와 회고
- 홈 탭에서는 두 번 눌러야 앱이 종료되고, 다른 스택에서는 홈으로 안전하게 돌아오면서 사용자 이탈이 줄었습니다.
- QA가 “이제 뒤로가기가 자연스럽다”라고 피드백을 주었고, 토스트 메시지도 한글로 통일했습니다.
- 다음에는 툴바에서 뒤로 버튼을 눌렀을 때도 동일한 로직을 적용할 계획입니다.
- 여러분 팀은 Android 백버튼을 어떻게 제어하고 있나요? 좋은 패턴이 있다면 공유해주세요.

# Reference
- https://reactnative.dev/docs/backhandler
- https://expo.github.io/router/docs

# 연결문서
- [[ActionSheet를 안전하게 감싸는 훅을 만든 이유]]
- [[Deep Link Friendly Redirect Validation을 구현하며 배운 보안 체크리스트]]
- [[React Native에서 로컬 리텐션 알림을 스케줄링하며 확인한 포인트]]
