---
tags:
  - OAuth
  - Kakao
  - Supabase
  - Expo
  - Android
  - iOS
  - Auth
title: Supabase + 카카오 OAuth 모바일 연동
created: 2025-03-31
modified: 2025-10-01
---

카카오 로그인을 붙이는데 iOS와 Android가 서로 다른 인증 플로우를 요구해 한 번에 정리하기가 쉽지 않았다. Expo AuthSession과 Linking을 조합해 두 플랫폼을 하나의 함수에서 처리했다.

## 플랫폼별 인증 플로우
- 공통으로 사용할 리다이렉트 URI를 `AuthSession.makeRedirectUri`로 생성했다.
- iOS에서는 `WebBrowser.openAuthSessionAsync`로 웹 기반 인증을 진행하고, Android에서는 `Linking` 이벤트로 토큰을 추적했다.
- Supabase OAuth를 사용해 백엔드 세션 설정까지 한번에 마무리했다.

Expo Router를 쓰고 있어 로그인 이후 화면 전환은 `router.push('/signup/check')`로 통일했다. 딥링크 스킴은 Kakao 콘솔과 일치시키기 위해 앱 전용 스킴 형식을 사용했다. Android 타임아웃은 120초로 제한해 사용자가 앱을 벗어난 뒤 돌아오지 않는 문제를 방지했다.

## 리다이렉트 URI 구성
AuthSession이 제공하는 헬퍼로 네이티브 스킴 URI를 만들었다.

## Supabase OAuth 호출
`supabase.auth.signInWithOAuth`에서 provider를 `kakao`로 지정하고, scope를 명시했다.

## iOS 처리
인증 성공 시 URL fragment 또는 query에서 access_token/refresh_token을 추출했다.

## Android 처리
`Linking.addEventListener('url', ...)`로 앱 스킴이 돌아올 때까지 기다리고, 타임아웃 시 에러를 던졌다.

## 세션 설정
`supabase.auth.setSession`으로 받은 토큰을 저장하고, 후속 라우팅을 이어갔다. iOS는 `WebBrowser.openAuthSessionAsync`로 팝업 인증을 진행하고, Android는 `Linking.addEventListener('url', ...)`로 앱 스킴이 돌아올 때까지 120초 타임아웃으로 대기했다.

```tsx
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
    const result = await WebBrowser.openAuthSessionAsync(
      data.url,
      redirectUri,
      { preferEphemeralSession: false, showInRecents: false },
    );
    if (result.type === 'success') {
      const urlParts = result.url.split('#')[1] || result.url.split('?')[1];
      const params = new URLSearchParams(urlParts);
      const access_token = params.get('access_token') ?? undefined;
      const refresh_token = params.get('refresh_token') ?? undefined;
      if (access_token && refresh_token) {
        await supabase.auth.setSession({ access_token, refresh_token });
        router.push('/signup/check');
      }
    }
    return;
  }

  // Android: Linking으로 딥링크 수신
  const urlPromise = new Promise<string>((resolve, reject) => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      const lowerUrl = url.toLowerCase();
      const isOurScheme = lowerUrl.startsWith('schoolmeets://');
      const isOurRedirect = lowerUrl.startsWith(redirectUri.toLowerCase());
      if (!isOurScheme && !isOurRedirect) return;
      clearTimeout(timeoutId);
      subscription.remove();
      resolve(url);
    });
    const timeoutId = setTimeout(() => {
      subscription.remove();
      reject(new Error('로그인 응답 시간 초과'));
    }, 120_000);
  });

  await Linking.openURL(data.url);
  const returnedUrl = await urlPromise;
  const urlParts = returnedUrl.split('#')[1] || returnedUrl.split('?')[1];
  const params = new URLSearchParams(urlParts);
  const access_token = params.get('access_token') ?? undefined;
  const refresh_token = params.get('refresh_token') ?? undefined;
  if (access_token && refresh_token) {
    await supabase.auth.setSession({ access_token, refresh_token });
    router.push('/signup/check');
  }
};
```

두 플랫폼에서 동일한 버튼을 사용하면서 인증 성공률이 높아졌고, KakaoTalk 앱이 설치돼 있어도 문제없이 동작했다. 타임아웃 처리를 넣은 덕분에 3분 이상 기다리는 QA 이슈도 해결됐다. 다음에는 에러 메시지를 사용자가 이해하기 쉬운 텍스트로 맵핑하고, Linking 이벤트를 전역 훅으로 옮길 계획이다.

# Reference
- https://docs.expo.dev/versions/latest/sdk/auth-session/
- https://supabase.com/docs/guides/auth/social-login

# 연결문서
- [[ActionSheet 래퍼 훅 구현]]
- [[Expo 푸시 토큰 등록 흐름 정리]]
- [[Android 더블백 종료 처리]]
