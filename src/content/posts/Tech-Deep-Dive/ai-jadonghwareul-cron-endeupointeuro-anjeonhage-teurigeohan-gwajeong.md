---
tags:
  - Engineering
  - TechDeepDive
  - AI
  - Cron
  - Supabase
  - Backend
title: AI 자동화를 cron 엔드포인트로 안전하게 트리거한 과정
created: '2025-10-09 14:06'
modified: '2025-10-09 14:06'
---

# Intro
저는 AI로 문서를 검증하는 작업을 수동으로 돌리다가, 한 번에 너무 많은 요청을 보내 Supabase가 버거워하는 모습을 봤습니다. 그래서 cron 엔드포인트를 만들어 제한된 수의 레코드만 안전하게 처리하도록 만들었습니다.

## 핵심 아이디어 요약
- `CRON_SECRET` Bearer 토큰으로 인증된 호출만 허용합니다.
- `pending` 상태의 레코드를 최대 100개까지 조회하고, 이미 제출됐거나 첨부가 없는 건 건너뜁니다.
- 대상 레코드마다 관리자 API를 호출하고 결과를 모아 반환합니다.

## 준비와 선택
1. **배치 크기**: 환경 변수로 배치 크기를 조절하되 기본은 20개, 최대 100개로 제한했습니다.
2. **첨부 확인**: AI가 처리할 수 없는 케이스를 줄이기 위해 첨부 파일이 있는 레코드만 골랐습니다.
3. **결과 집계**: 성공/실패 여부와 상태 코드를 배열로 모아 모니터링할 수 있게 했습니다.

## 구현 여정
### Step 1: 인증과 설정
요청 헤더의 Authorization이 `Bearer ${CRON_SECRET}`인지 확인합니다. 설정이 없으면 500을, 키가 다르면 401을 반환합니다.

### Step 2: 후보 레코드 선별
`verification_status = 'pending'`인 레코드를 오래된 순으로 가져옵니다. 이미 제출된 기록이나 첨부 파일이 없는 경우는 건너뜁니다.

### Step 3: AI 처리 트리거
각 레코드마다 내부 API를 호출하고 `ok`, `status`, `body`를 기록합니다. 실패해도 루프를 멈추지 않고 계속 진행합니다.

```ts
import { NextRequest } from 'next/server';

for (const recordId of targets) {
  try {
    const response = await fetch(`${request.nextUrl.origin}/api/admin/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordId }),
    });

    const payload = await response.json().catch(() => null);
    results.push({
      recordId,
      ok: response.ok,
      status: response.status,
      body: payload,
    });
  } catch (error) {
    results.push({
      recordId,
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
```

## 겪은 이슈와 해결 과정
- **빈 작업**: 처리할 레코드가 없을 때도 cron이 성공했다고 보고하면 의미가 없어서, 메시지와 함께 0건 처리 상태를 반환했습니다.
- **네트워크 오류**: 내부 API 호출이 실패하면 예외를 잡아 메시지와 함께 `status: 0`으로 기록했습니다.
- **중복 실행**: cron이 중복 호출되어도 같은 레코드를 두 번 요청하지 않도록 제출 여부와 첨부 여부를 꼼꼼히 확인했습니다.

## 결과와 회고
지금은 cron이 5분마다 실행돼도 Supabase가 버거워하지 않고, 처리 결과를 쉽게 모니터링할 수 있습니다. AI 요청이 실패했을 때도 어떤 레코드에서 문제가 났는지 바로 확인할 수 있게 되었죠. 다음에는 결과를 테이블에 로그로 남겨 추세를 분석해볼 계획입니다.

여러분은 배치 작업을 어떻게 관리하고 계신가요? 안전장치 아이디어가 있다면 댓글로 공유해주세요.

# Reference
- https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- https://nextjs.org/docs/app/building-your-application/routing/route-handlers

# 연결문서
- [AES-256과 Prisma Middleware로 개인정보 안전하게 돌리기](/post/aes-256gwa-prisma-middlewarero-gaeinjeongbo-anjeonhage-dolligi)
- [Bearer 토큰을 Supabase 쿠키로 바꿔주는 Next.js 서버 클라이언트](/post/bearer-tokeuneul-supabase-kukiro-bakkwojuneun-next-js-seobeo-keullaieonteu)
- [Supabase RPC로 포인트 적립·차감을 안전하게 처리한 방법](/post/supabase-rpcro-pointeu-jeongnip-chagameul-anjeonhage-cheorihan-bangbeop)
