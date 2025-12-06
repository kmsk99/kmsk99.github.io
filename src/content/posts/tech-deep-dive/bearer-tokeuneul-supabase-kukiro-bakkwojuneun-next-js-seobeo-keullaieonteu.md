---
tags:
  - Engineering
  - TechDeepDive
  - Supabase
  - NextJS
  - ReactNative
  - ServerActions
  - Backend
  - Frontend
title: Bearer 토큰을 Supabase 쿠키로 바꿔주는 Next.js 서버 클라이언트
created: '2025-10-09 14:06'
modified: '2025-10-09 14:06'
slug: bearer-tokeuneul-supabase-kukiro-bakkwojuneun-next-js-seobeo-keullaieonteu
---

# Intro
저는 React Native 클라이언트가 보낸 Bearer 토큰으로 Next.js Server Actions를 호출했는데, Supabase가 “세션이 없습니다”라고 답하는 상황을 겪었습니다. 헤더에 토큰이 있는데도 쿠키가 없다고 여긴 거죠. 그래서 서버 측 클라이언트 팩토리를 커스터마이즈해 Authorization 헤더를 Supabase가 이해하는 쿠키 형식으로 변환했습니다.

## 핵심 아이디어 요약
- `next/headers`에서 쿠키와 헤더를 동시에 읽어 Bearer 토큰을 감지합니다.
- 토큰이 있으면 Supabase가 기대하는 `sb-<project-ref>-auth-token` 쿠키 JSON을 만들어 쿠키 목록에 추가합니다.
- 서버에서 쿠키를 설정할 때는 Authorization 헤더에서 파생된 쿠키를 다시 쓰지 않도록 예외 처리를 넣었습니다.

## 준비와 선택
1. **프로젝트 Ref 추출**: Supabase 프로젝트 URL에서 첫 번째 도메인을 분리해 쿠키 이름에 붙였습니다.
2. **세션 JSON**: Supabase가 요구하는 구조(`access_token`, `refresh_token`, `expires_at`, `token_type`, `user`)를 그대로 채웠습니다. 리프레시 토큰은 사용하지 않아 null로 둡니다.
3. **쿠키 세터 가드**: 서버 컴포넌트에서 `cookies().set`을 호출하면 Next.js가 에러를 던질 수 있어 try/catch로 예외를 막았습니다.

## 구현 여정
### Step 1: 헤더와 쿠키 읽기
`cookies()`와 `headers()`를 await해서 가져옵니다. Authorization 헤더가 `Bearer ...`로 시작하면 토큰을 추출합니다.

### Step 2: Supabase 쿠키 생성
`sb-${projectRef}-auth-token` 이름으로 JSON 문자열을 만든 뒤, 기존 쿠키 배열에 push합니다. 이렇게 하면 Supabase Server Client가 해당 쿠키를 사용해 인증을 수행합니다.

```ts
export async function createServerSupabase() {
  // 요청 쿠키와 헤더를 동시에 읽어올 수 있는 Next.js 유틸리티입니다.
  const cookieStore = await cookies();
  const headersList = await headers();

  const authHeader = headersList.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL!
      .split('.')[0]
      .split('//')[1];

    cookieStore.set({
      name: `sb-${projectRef}-auth-token`,
      value: JSON.stringify({
        access_token: token,
        refresh_token: null,
        expires_at: null,
        token_type: 'bearer',
        user: null,
      }),
      httpOnly: true,
      sameSite: 'lax',
    });
  }

  // Supabase SSR 클라이언트를 생성하면서 위에서 만든 쿠키 목록을 그대로 넘겨줍니다.
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: cookieStore },
  );
}

이 함수 하나만으로 React Native와 같은 외부 클라이언트가 보낸 Bearer 토큰을 SSR 환경에서도 그대로 활용할 수 있습니다. 쿠키 이름과 JSON 구조만 Supabase가 기대하는 형식으로 맞춰 주면 나머지는 `createServerClient`가 자동으로 처리합니다.
```

### Step 3: 쿠키 쓰기 필터링
`setAll` 구현에서는 Authorization 헤더로 생성한 쿠키가 다시 세팅되지 않도록 조건문을 넣었습니다. 그렇지 않으면 헤더 기반 인증이 두 번 적용되면서 이상한 동작이 나올 수 있습니다.

## 겪은 이슈와 해결 과정
- **프로젝트 Ref 파싱**: URL 구조가 예상과 다르면 쿠키 이름이 잘못 나왔습니다. `split('//')[1]` → `split('.')[0]` 순서로 분리해 안정성을 높였습니다.
- **서버 컴포넌트에서 setAll**: Server Component에서 `createClient`를 쓰면 `setAll`이 호출되지 않는다는 경고가 떠서 try/catch로 감싸 조용히 무시했습니다.
- **권한 부족**: Authorization 헤더가 없을 때는 기존 쿠키 목록만 전달해 기존 SSR 동작을 유지했습니다.

## 결과와 회고
이제는 React Native 앱이 Bearer 토큰만 들고 있어도 Next.js 경유로 Supabase 권한이 정확히 적용됩니다. 서버 액션에서 별도 토큰 파싱을 하지 않아도 되고, 공통 로직이 하나로 묶여서 유지보수가 쉬워졌습니다. 다음에는 사용자 단위로 로깅을 남겨 누가 어떤 경로에서 인증이 실패했는지 더 세밀하게 추적할 예정입니다.

여러분은 SSR 환경에서 Supabase 인증을 어떻게 다루고 계신가요? 다른 방법을 쓰고 계시면 꼭 알려주세요. 다양한 패턴을 비교하면 더 안정적인 구성을 찾을 수 있을 겁니다.

# Reference
- https://supabase.com/docs/guides/auth/server-side/nextjs
- https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Authorization

# 연결문서
- [[Firestore 장바구니 동기화에서 배운 방어적 패턴]]
- [[네트워크 흔들릴 때도 프로필 세션을 지키는 useProfileWithRetry 만들기]]
- [[카카오 OAuth를 iOS와 Android에 동시에 붙인 경험]]
