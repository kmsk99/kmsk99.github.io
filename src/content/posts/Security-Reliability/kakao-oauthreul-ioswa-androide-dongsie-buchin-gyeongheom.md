---
tags:
  - OAuth
  - Kakao
  - Supabase
  - Expo
  - Android
  - iOS
  - Auth
title: 카카오 OAuth를 iOS와 Android에 동시에 붙인 경험
created: '2024-11-27 12:00'
modified: '2024-11-27 12:00'
---

# Intro
- 카카오 로그인을 붙이는데 iOS와 Android가 서로 다른 인증 플로우를 요구해 한 번에 정리하기가 쉽지 않았습니다.
- 저는 Expo AuthSession과 Linking을 조합해 두 플랫폼을 하나의 함수에서 처리했습니다.

## 핵심 아이디어 요약
- 공통으로 사용할 리다이렉트 URI를 `AuthSession.makeRedirectUri`로 생성했습니다.
- iOS에서는 `WebBrowser.openAuthSessionAsync`로 웹 기반 인증을 진행하고, Android에서는 `Linking` 이벤트로 토큰을 추적했습니다.
- Supabase OAuth를 사용해 백엔드 세션 설정까지 한번에 마무리했습니다.

## 준비와 선택
- Expo Router를 쓰고 있어 로그인 이후 화면 전환은 `router.push('/signup/check')`로 통일했습니다.
- 딥링크 스킴은 Kakao 콘솔과 일치시키기 위해 `schoolmeets://` 형식을 사용했습니다.
- Android 타임아웃은 120초로 제한해 사용자가 앱을 벗어난 뒤 돌아오지 않는 문제를 방지했습니다.

## 구현 여정
1. **리다이렉트 URI 구성**: AuthSession이 제공하는 헬퍼로 네이티브 스킴 URI를 만들었습니다.
2. **Supabase OAuth 호출**: `supabase.auth.signInWithOAuth`에서 provider를 `kakao`로 지정하고, scope를 명시했습니다.
3. **iOS 처리**: 인증 성공 시 URL fragment 또는 query에서 access_token/refresh_token을 추출했습니다.
4. **Android 처리**: `Linking.addEventListener('url', ...)`로 앱 스킴이 돌아올 때까지 기다리고, 타임아웃 시 에러를 던졌습니다.
5. **세션 설정**: `supabase.auth.setSession`으로 받은 토큰을 저장하고, 후속 라우팅을 이어갔습니다.

```tsx
// src/features/Login/ui/KakaoLogin.tsx:18-188
const handleKakaoLogin = async () => {
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: 'schoolmeets',
    preferLocalhost: false,
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'kakao',
    options: {
      redirectTo: redirectUri,
      scopes:
        'profile_image account_email name gender birthday birthyear phone_number',
    },
  });
  if (error || !data.url) throw new Error('카카오 로그인 실패');

  if (Platform.OS === 'ios') {
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);
    if (result.type !== 'success') return;
    const params = new URLSearchParams(result.url.split('#')[1] || result.url.split('?')[1]);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (!access_token || !refresh_token) throw new Error('토큰 없음');
    await supabase.auth.setSession({ access_token, refresh_token });
    router.push('/signup/check');
    return;
  }

  const urlPromise = new Promise<string>((resolve, reject) => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      const lower = url.toLowerCase();
      const isOurScheme = lower.startsWith('schoolmeets://');
      const isOurRedirect = lower.startsWith(redirectUri.toLowerCase());
      if (!isOurScheme && !isOurRedirect) return;
      clearTimeout(timeoutId);
      subscription.remove();
      resolve(url);
    });
    const timeoutId = setTimeout(() => {
      clearTimeout(timeoutId);
      subscription.remove();
      reject(new Error('로그인 응답 시간 초과'));
    }, 120_000);
  });

  await Linking.openURL(data.url);
  const returnedUrl = await urlPromise;
  const params = new URLSearchParams(returnedUrl.split('#')[1] || returnedUrl.split('?')[1]);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) throw new Error('토큰 없음');
  await supabase.auth.setSession({ access_token, refresh_token });
  router.push('/signup/check');
};
```

## 결과와 회고
- 두 플랫폼에서 동일한 버튼을 사용하면서 인증 성공률이 높아졌고, KakaoTalk 앱이 설치돼 있어도 문제없이 동작했습니다.
- 타임아웃 처리를 넣은 덕분에 3분 이상 기다리는 QA 이슈도 해결됐습니다.
- 다음에는 에러 메시지를 사용자가 이해하기 쉬운 텍스트로 맵핑하고, Linking 이벤트를 전역 훅으로 옮길 계획입니다.
- 여러분 팀도 소셜 로그인을 붙이고 계신가요? 플랫폼별로 어떤 차이를 경험했는지 공유해 주세요.

# Reference
- https://supabase.com/docs/guides/auth/social-login/auth-kakao
- https://docs.expo.dev/guides/authentication/

# 연결문서
- [ActionSheet를 안전하게 감싸는 훅을 만든 이유](/post/actionsheetreul-anjeonhage-gamssaneun-hugeul-mandeun-iyu)
- [Expo 푸시 토큰 등록 루틴에서 배운 것](/post/expo-pusi-tokeun-deungnok-rutineseo-baeun-geot)
- [Android 더블백 종료 규칙을 직접 다듬으며 배운 것](/post/android-deobeulbaek-jongnyo-gyuchigeul-jikjeop-dadeumeumyeo-baeun-geot)
