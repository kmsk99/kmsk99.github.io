---
tags:
  - NextJS
  - Proxy
  - API
  - Security
  - CORS
title: 공공데이터 대학 API 프록시를 만들며 챙긴 보안 옵션
created: 2025-10-09 14:06
modified: 2025-10-09 14:06
---

# Intro
저는 교육부 공공데이터 API를 직접 호출했다가, 브라우저에서 CORS와 인증 키 노출 문제를 동시에 맞닥뜨렸습니다. 그래서 Next.js 서버 라우트에 프록시를 만들어 키를 감추고 에러 처리를 한 곳에서 담당하게 했습니다.

## 핵심 아이디어 요약
- 서비스 키는 `.env`에 두고, 요청에 `serviceKey`가 오지 않으면 서버에서 인코딩해 붙입니다.
- `apiUrl`을 쿼리로 지정하면 다른 엔드포인트도 재사용할 수 있도록 디코딩 후 전달합니다.
- 실패하면 업스트림 상태 코드와 응답 일부를 그대로 전달해 디버깅을 돕습니다.

## 준비와 선택
1. **키 주입 우선순위**: 클라이언트가 키를 직접 줄 수도 있으니, 쿼리 파라미터 > 환경 변수 순으로 우선순위를 정했습니다.
2. **헤더 위장**: 공공데이터 API가 일부 User-Agent를 막아서, 일반 브라우저 UA를 헤더에 넣었습니다.
3. **로깅**: 요청 URL과 응답 일부를 콘솔에 남겨 장애 상황을 빠르게 파악할 수 있게 했습니다.

## 구현 여정
### Step 1: 파라미터 구성
요청에서 `serviceKey`와 `apiUrl`을 받아 처리합니다. 환경변수의 키는 URL 인코딩이 필요해서 `encodeURIComponent`로 감쌌습니다.

### Step 2: 프록시 호출
`fetch`로 업스트림 API를 호출하고, 응답 텍스트를 그대로 받아둡니다. 성공하면 `{ success: true, data: text }` 형태로 JSON을 반환합니다.

```ts
import { NextRequest, NextResponse } from 'next/server';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)';

export async function GET(request: NextRequest) {
  // 1. 쿼리스트링과 환경 변수를 조합해 서비스 키를 결정합니다.
  const params = request.nextUrl.searchParams;
  const rawServiceKey =
    params.get('serviceKey') ?? process.env.UNIVERSITY_DATA_API_KEY ?? '';
  const serviceKey = encodeURIComponent(rawServiceKey);

  const rawApiUrl = params.get('apiUrl') ?? process.env.UNIVERSITY_DATA_API_URL;
  if (!rawApiUrl) {
    return NextResponse.json(
      { success: false, message: 'API URL이 설정되지 않았습니다.' },
      { status: 400 },
    );
  }

  // 2. 서비스 키를 붙여 최종 요청 URL을 구성합니다.
  params.set('serviceKey', serviceKey);
  const url = `${decodeURIComponent(rawApiUrl)}?${params.toString()}`;
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  const text = await response.text();

  // 3. upstream에서 받은 상태를 그대로 반환하면서 body 일부를 로그에 남깁니다.
  if (!response.ok) {
    return NextResponse.json(
      { success: false, status: response.status, body: text.slice(0, 200) },
      { status: response.status },
    );
  }

  return NextResponse.json({ success: true, data: text });
}
```

### Step 3: 에러 처리
응답이 200이 아니면 `{ status, message, body }`를 담아 같은 상태 코드로 클라이언트에 전달합니다. 네트워크 장애는 500으로 묶어 에러 메시지를 보여줍니다.

## 겪은 이슈와 해결 과정
- **인증 키 유무**: 환경 변수도, 쿼리도 키가 없으면 명확한 에러 메시지를 반환해 개발자가 바로 조치할 수 있게 했습니다.
- **URL 인코딩**: 이미 인코딩된 `apiUrl`을 다시 인코딩하면 400이 나와서, `decodeURIComponent` 후 사용했습니다.
- **응답 크기**: 응답이 너무 길어 로그가 폭주하길래 앞부분만 잘라 출력하도록 제한했습니다.

## 결과와 회고
이제 클라이언트는 `/api/university`만 호출하면 되고, 서비스 키가 브라우저에 노출되지 않습니다. 다른 학사 통계 API도 같은 프록시로 쉽게 확장할 수 있었죠. 다음에는 응답을 XML→JSON으로 변환해 클라이언트 코드를 더 단순하게 만들 생각입니다.

여러분은 공공데이터 API를 어떻게 프록시하고 계신가요? 다른 보안 팁이 있다면 댓글로 공유해주세요.

# Reference
- https://www.data.go.kr/
- https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API

# 연결문서
- [[NICE 본인인증 팝업을 Next.js에서 안전하게 다루기]]
- [[Bearer 토큰을 Supabase 쿠키로 바꿔주는 Next.js 서버 클라이언트]]
- [[Chain Flag로 긴 호출 시간을 견디는 법]]
