---
tags:
  - NextJS
  - Proxy
  - API
  - Security
  - CORS
title: 공공데이터 API 프록시 구현
created: 2025-03-12
modified: 2025-09-16
---

교육부 공공데이터 API를 직접 호출했다가, 브라우저에서 CORS와 인증 키 노출 문제를 동시에 맞닥뜨렸다. Next.js 서버 라우트에 프록시를 만들어 키를 감추고 에러 처리를 한 곳에서 담당하게 했다.

## 프록시 설계
- 서비스 키는 `.env`에 두고, 요청에 `serviceKey`가 오지 않으면 서버에서 인코딩해 붙인다.
- `apiUrl`을 쿼리로 지정하면 다른 엔드포인트도 재사용할 수 있도록 디코딩 후 전달한다.
- 실패하면 업스트림 상태 코드와 응답 일부를 그대로 전달해 디버깅을 돕는다.

클라이언트가 키를 직접 줄 수도 있으니, 쿼리 파라미터 > 환경 변수 순으로 우선순위를 정했다. 공공데이터 API가 일부 User-Agent를 막아서, 일반 브라우저 UA를 헤더에 넣었다. 요청 URL과 응답 일부를 콘솔에 남겨 장애 상황을 빠르게 파악할 수 있게 했다.

## 파라미터 구성
요청에서 `serviceKey`와 `apiUrl`을 받아 처리한다. 환경변수의 키는 URL 인코딩이 필요해서 `encodeURIComponent`로 감쌌다.

## 프록시 호출
`fetch`로 업스트림 API를 호출하고, 응답 텍스트를 그대로 받아둔다. `apiUrl`은 쿼리로 전달 시 `decodeURIComponent`로 디코딩해 사용한다. 클라이언트가 전달한 모든 파라미터를 `apiUrl`·`serviceKey` 제외하고 passthrough로 전달한다. 성공하면 `{ success: true, data: text, url }` 형태로 JSON을 반환한다.

```ts
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const incomingServiceKey = searchParams.get('serviceKey');
  const envServiceKey = process.env.UNIVERSITY_DATA_API_KEY || '';
  const finalServiceKey = incomingServiceKey ?? (envServiceKey ? encodeURIComponent(envServiceKey) : '');

  const rawApiBaseFromQuery = searchParams.get('apiUrl') || '';
  const apiBase = rawApiBaseFromQuery ? decodeURIComponent(rawApiBaseFromQuery) : (process.env.UNIVERSITY_DATA_API_URL || '');

  if (!apiBase) {
    return NextResponse.json(
      { success: false, message: '환경변수 UNIVERSITY_DATA_API_URL 이 설정되지 않았습니다.' },
      { status: 400 },
    );
  }

  const passthrough = new URLSearchParams(searchParams);
  passthrough.delete('apiUrl');
  if (finalServiceKey) passthrough.set('serviceKey', finalServiceKey);
  const queryString = passthrough.toString();
  const url = queryString ? `${apiBase}?${queryString}` : apiBase;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  const text = await response.text();

  if (!response.ok) {
    return NextResponse.json(
      { success: false, status: response.status, message: '업스트림 API 호출 실패', body: text.substring(0, 500), url },
      { status: response.status },
    );
  }
  return NextResponse.json({ success: true, data: text, url });
}
```

## 에러 처리
응답이 200이 아니면 `{ status, message, body }`를 담아 같은 상태 코드로 클라이언트에 전달한다. 네트워크 장애는 500으로 묶어 에러 메시지를 보여준다.

## 겪은 이슈와 해결
- 인증 키 유무: 환경 변수도, 쿼리도 키가 없으면 명확한 에러 메시지를 반환해 개발자가 바로 조치할 수 있게 했다.
- URL 인코딩: 이미 인코딩된 `apiUrl`을 다시 인코딩하면 400이 나와서, `decodeURIComponent` 후 사용했다.
- 응답 크기: 응답이 너무 길어 로그가 폭주하길래 앞부분만 잘라 출력하도록 제한했다.

이제 클라이언트는 `/api/university`만 호출하면 되고, 서비스 키가 브라우저에 노출되지 않는다. 다른 학사 통계 API도 같은 프록시로 쉽게 확장할 수 있었다. 다음에는 응답을 XML→JSON으로 변환해 클라이언트 코드를 더 단순하게 만들 생각이다.

# Reference
- https://www.data.go.kr/
- https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API

# 연결문서
- [[NICE 본인인증 API 서버 구현]]
- [[React Native에서 Next.js API를 인증된 상태로 호출하기]]
- [[비동기 체인 플래그로 긴 API 호출 처리하기]]
