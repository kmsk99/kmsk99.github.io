---
tags:
  - NextJS
  - Supabase
  - Auth
  - ReactNative
  - Bearer
  - SSR
title: React Native에서 Next.js API를 인증된 상태로 호출하기
created: '2025-06-17'
modified: '2025-07-08'
---

React Native(Expo) 앱이 Next.js API 라우트와 Server Actions를 호출할 때 인증이 통과되지 않는 문제가 있다. 웹에서는 Supabase SSR 클라이언트가 쿠키에서 auth를 읽어오지만, 모바일 앱은 쿠키를 보내지 않는다. 대신 `Authorization: Bearer <token>` 헤더로 토큰을 넘긴다. `@supabase/ssr`의 `createServerClient`는 기본적으로 쿠키만 읽기 때문에, 헤더에 토큰이 있어도 요청이 비인증으로 처리된다.

## 해결 방향

Supabase SSR 쿠키 설정의 `getAll()` 메서드를 오버라이드해서, Authorization 헤더에 Bearer 토큰이 있으면 Supabase가 기대하는 auth 쿠키 형식으로 가상 쿠키를 만들어 목록에 넣는다. 그러면 `createServerClient`가 그 쿠키를 그대로 사용해 인증을 수행한다.

구현 위치는 두 곳이다.

1. server.ts — Server Components와 Server Actions
2. middleware.ts — API 라우트 미들웨어 (`/api/` 경로만)

## server.ts (Server Components / Server Actions)

`next/headers`의 `cookies()`와 `headers()`를 사용해 요청 시점의 쿠키와 헤더를 읽는다. `getAll()` 안에서 Authorization 헤더를 확인하고, Bearer 토큰이 있으면 `sb-{projectRef}-auth-token` 형태의 가상 쿠키를 만들어 기존 쿠키 목록에 push한다. `setAll()`에서는 Authorization 헤더로 만든 auth 쿠키를 다시 설정하지 않도록 막아서, 헤더 기반 인증이 이중으로 적용되는 것을 방지한다.

```ts
import { cookies, headers } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export async function createClient() {
  const cookieStore = await cookies();
  const headersList = await headers();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          const cookieList = cookieStore.getAll();
          const authHeader = headersList.get('authorization');
          if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.replace('Bearer ', '');
            const projectRef =
              process.env.NEXT_PUBLIC_SUPABASE_URL?.split('.')[0]?.split('//')[1];
            const authTokenCookie = {
              name: `sb-${projectRef}-auth-token`,
              value: JSON.stringify({
                access_token: token,
                refresh_token: null,
                expires_at: null,
                token_type: 'bearer',
                user: null,
              }),
            };
            cookieList.push(authTokenCookie);
          }
          return cookieList;
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              if (name.includes('auth-token') && headersList.get('authorization')) {
                return;
              }
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Component에서 호출 시 무시
          }
        },
      },
    },
  );
}
```

## middleware.ts (API 라우트)

API 경로(`/api/`)에 대해서만 Bearer 토큰을 쿠키로 변환한다. `request.cookies.getAll()`로 쿠키 목록을 가져온 뒤, Authorization 헤더가 있으면 같은 방식으로 가상 auth 쿠키를 추가한다. `setAll`에서는 `supabaseResponse.cookies.set`으로 응답 쿠키를 설정한다.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          const cookies = request.cookies.getAll();
          if (request.nextUrl.pathname.startsWith('/api/')) {
            const authHeader = request.headers.get('authorization');
            if (authHeader && authHeader.startsWith('Bearer ')) {
              const token = authHeader.replace('Bearer ', '');
              const projectRef =
                process.env.NEXT_PUBLIC_SUPABASE_URL?.split('.')[0]?.split('//')[1];
              const authTokenCookie = {
                name: `sb-${projectRef}-auth-token`,
                value: JSON.stringify({
                  access_token: token,
                  refresh_token: null,
                  expires_at: null,
                  token_type: 'bearer',
                  user: null,
                }),
              };
              cookies.push(authTokenCookie);
            }
          }
          return cookies;
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user && !request.nextUrl.pathname.startsWith('/login') && !request.nextUrl.pathname.startsWith('/auth')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return supabaseResponse;
}
```

## 다른 접근: Edge Function 기반

모바일 앱에서는 Supabase Edge Functions를 쓰고, Bearer 토큰을 global headers로 직접 넘기는 방식도 있다. Next.js API를 거치지 않고 Edge Function이 헤더에서 토큰을 읽어 인증하는 방식이다. Next.js + API 라우트/Server Actions 조합이 아니라 Edge Function 중심 아키텍처일 때 고려할 수 있는 패턴이다.

## 정리

- 웹: Supabase SSR이 쿠키에서 auth를 읽음.
- 모바일: Bearer 토큰을 Authorization 헤더로 보냄.
- `getAll()` 오버라이드로 헤더 토큰을 가상 auth 쿠키로 변환하면, `createServerClient`가 그대로 인증을 처리한다.
- server.ts와 middleware.ts 두 곳에서 같은 전략을 적용하면 Server Components, Server Actions, API 라우트 모두에서 React Native 앱의 Bearer 토큰이 인증에 사용된다.

# Reference
- https://supabase.com/docs/guides/auth/server-side/nextjs

# 연결문서
- [Next.js App Router + Firebase Auth 관리자 인증](/post/next-js-app-router-firebase-auth-gwallija-injeung)
- [React Native 파일 업로드 유틸 구현](/post/react-native-pail-eomnodeu-yutil-guhyeon)
- [Supabase + 카카오 OAuth 모바일 연동](/post/supabase-kakao-oauth-mobail-yeondong)
- [useProfileWithRetry - 네트워크 불안정 대응 훅](/post/useprofilewithretry-neteuwokeu-buranjeong-daeeung-huk)
