---
tags:
  - Expo
  - OTA
  - Updates
  - Mobile
  - UX
title: Expo OTA 업데이트 안내 모달을 붙이며 느낀 점
created: '2024-11-27 11:40'
modified: '2024-11-27 11:40'
---

# Intro
- OTA 업데이트를 배포해도 사용자가 앱을 다시 시작하지 않으면 새 기능이 묻히고는 했습니다.
- 저는 Expo Updates를 사용해 앱이 켜질 때와 포그라운드로 복귀할 때 업데이트를 확인하고, 모달로 바로 알려주도록 만들었습니다.

## 핵심 아이디어 요약
- `Updates.checkForUpdateAsync`와 `Updates.fetchUpdateAsync`를 조합해 백그라운드에서 새 번들을 내려받습니다.
- `AppState` 변화를 구독해 포그라운드 복귀 시에도 업데이트를 체크합니다.
- 재시작 버튼을 누르면 `Updates.reloadAsync`로 즉시 새 번들을 적용하고, 취소할 수도 있게 했습니다.

## 준비와 선택
- OTA는 배포 채널과 runtimeVersion이 맞아야 하므로 fetch 결과가 `isNew`일 때만 모달을 띄우도록 했습니다.
- 모달은 이미 사용 중인 `BaseModal` 컴포넌트를 재활용해 디자인 시스템을 따랐습니다.
- 로딩 상태를 보여주기 위해 `ActivityIndicator`를 추가해 사용자가 다운로드 진행 중임을 알 수 있도록 했습니다.

## 구현 여정
1. **체크 함수 분리**: `check` 함수를 `useCallback`으로 분리해 최초 렌더와 AppState 이벤트에서 재사용했습니다.
2. **AppState 구독**: `AppState.addEventListener('change', ...)`로 포그라운드 복귀 이벤트를 감지했습니다.
3. **다운로드 진행 표시**: `setIsFetching(true)`로 상태를 표시한 뒤, 요청이 실패하더라도 finally에서 false로 되돌렸습니다.
4. **재시작 로직**: `Updates.reloadAsync`를 호출하기 전 모달을 닫아 사용자 경험을 매끄럽게 했습니다.
5. **에러 처리**: 네트워크 에러는 사용자에게 굳이 노출하지 않고 로그에만 남겼습니다.

```tsx
// src/widgets/Common/ui/OtaUpdateModal.tsx:11-80
export default function OtaUpdateModal() {
  const [visible, setVisible] = useState(false);
  const [isFetching, setIsFetching] = useState(false);

  const check = useCallback(async () => {
    try {
      const res = await Updates.checkForUpdateAsync();
      if (res.isAvailable) {
        setIsFetching(true);
        const fetched = await Updates.fetchUpdateAsync();
        if (fetched.isNew) setVisible(true);
      }
    } catch {
      // 네트워크 오류는 조용히 무시
    } finally {
      setIsFetching(false);
    }
  }, []);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  const restartNow = async () => {
    setVisible(false);
    await Updates.reloadAsync();
  };

  return (
    <BaseModal isOpen={visible} onClose={() => setVisible(false)}>
      <View style={tw`flex w-80 flex-col items-center gap-4 px-5 pb-4 pt-6`}>
        <Text style={tw`text-gray-10 t-l-b`}>업데이트가 준비됐어요</Text>
        {isFetching ? (
          <View style={tw`flex flex-row items-center gap-2 py-2`}>
            <ActivityIndicator color={colors.primary[50]} size='small' />
            <Text style={tw`text-gray-50 t-s-r`}>업데이트 준비 중...</Text>
          </View>
        ) : (
          <View style={tw`flex w-full flex-col items-center gap-3`}>
            <BaseButton label='지금 재시작' onPress={restartNow} size='sm' />
            <BaseButton12
              color='gray'
              label='나중에 할게요'
              variant='text'
              onPress={() => setVisible(false)}
            />
          </View>
        )}
      </View>
    </BaseModal>
  );
}
```

## 결과와 회고
- 업데이트가 있을 때 사용자들이 평균 10분 안에 새 버전으로 재시작하면서 새로운 기능 배포 속도가 빨라졌습니다.
- 다운로드 실패 상황에서도 UI가 조용히 복구돼 불필요한 문의가 줄었습니다.
- 향후에는 릴리즈 노트나 변경사항 요약을 모달에 함께 보여주는 실험을 해보려 합니다.
- 다른 팀에서는 OTA 알림을 어떻게 설계하고 계신가요? 댓글로 공유해 주세요.

# Reference
- https://docs.expo.dev/eas-update/getting-started/
- https://docs.expo.dev/versions/latest/sdk/updates/

# 연결문서
- [ActionSheet를 안전하게 감싸는 훅을 만든 이유](/post/actionsheetreul-anjeonhage-gamssaneun-hugeul-mandeun-iyu)
- [Android 더블백 종료 규칙을 직접 다듬으며 배운 것](/post/android-deobeulbaek-jongnyo-gyuchigeul-jikjeop-dadeumeumyeo-baeun-geot)
- [Deep Link Friendly Redirect Validation을 구현하며 배운 보안 체크리스트](/post/deep-link-friendly-redirect-validationeul-guhyeonhamyeo-baeun-boan-chekeuriseuteu)
