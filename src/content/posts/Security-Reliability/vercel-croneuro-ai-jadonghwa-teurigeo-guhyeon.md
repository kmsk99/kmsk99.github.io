---
tags:
  - Supabase
  - Cron
  - AI
  - Backend
  - Security
  - RateLimit
title: Vercel Cron으로 AI 자동화 트리거 구현
created: '2025-10-15'
modified: '2025-10-31'
---

AI로 문서를 검증하는 작업을 수동으로 돌리다가, 한 번에 너무 많은 요청을 보내 Supabase가 버거워하는 모습을 봤다. cron 엔드포인트를 만들어 제한된 수의 레코드만 안전하게 처리하도록 만들었다.

## 인증과 배치 전략
- `CRON_SECRET` Bearer 토큰으로 인증된 호출만 허용한다.
- `pending` 상태의 레코드를 최대 100개까지 조회하고, 이미 제출됐거나 첨부가 없는 건 건너뛴다.
- 대상 레코드마다 관리자 API를 호출하고 결과를 모아 반환한다.

환경 변수로 배치 크기를 조절하되 기본은 20개, 최대 100개로 제한했다. AI가 처리할 수 없는 케이스를 줄이기 위해 첨부 파일이 있는 레코드만 골랐다. 성공/실패 여부와 상태 코드를 배열로 모아 모니터링할 수 있게 했다.

## 인증과 설정
요청 헤더의 Authorization이 `Bearer ${CRON_SECRET}`인지 확인한다. 설정이 없으면 500을, 키가 다르면 401을 반환한다.

## 후보 레코드 선별
`verification_status = 'pending'`인 `school_record`를 `verification_submitted_at` 오름차순으로 가져온다. `school_record_submission`에 이미 제출된 기록이 있거나, `secured_attachment`에 첨부가 없는 경우는 건너뛴다. `CRON_AI_BATCH_LIMIT` 환경변수로 배치 크기를 조절하되 기본 20, 최대 100으로 제한했다.

## AI 처리 트리거
각 레코드마다 `/api/admin/school-record`를 POST로 호출하고 `schoolRecordId`, `ok`, `status`, `body`를 기록한다. `VERCEL_AUTOMATION_BYPASS_SECRET`이 있으면 `x-vercel-protection-bypass` 헤더를 붙여 Vercel 자동화 제한을 우회한다. 실패해도 루프를 멈추지 않고 계속 진행한다.

```ts
const { data: pendingRecords } = await supabase
  .from('school_record')
  .select('id')
  .eq('verification_status', 'pending')
  .order('verification_submitted_at', { ascending: true })
  .limit(effectiveBatchLimit);

// submission, attachment 여부로 targets 필터링 후
const origin = req.nextUrl.origin;
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const fetchHeaders: HeadersInit = {
  'Content-Type': 'application/json',
  ...(bypassSecret && { 'x-vercel-protection-bypass': bypassSecret }),
};

for (const schoolRecordId of targets) {
  try {
    const response = await fetch(`${origin}/api/admin/school-record`, {
      method: 'POST',
      headers: fetchHeaders,
      body: JSON.stringify({ schoolRecordId }),
    });
    const json = await response.json().catch(() => null);
    results.push({ schoolRecordId, ok: response.ok, status: response.status, body: json });
  } catch (error) {
    results.push({
      schoolRecordId,
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
```

## 겪은 이슈와 해결
- 빈 작업: 처리할 레코드가 없을 때도 cron이 성공했다고 보고하면 의미가 없어서, 메시지와 함께 0건 처리 상태를 반환했다.
- 네트워크 오류: 내부 API 호출이 실패하면 예외를 잡아 메시지와 함께 `status: 0`으로 기록했다.
- 중복 실행: cron이 중복 호출되어도 같은 레코드를 두 번 요청하지 않도록 제출 여부와 첨부 여부를 꼼꼼히 확인했다.

지금은 cron이 5분마다 실행돼도 Supabase가 버거워하지 않고, 처리 결과를 쉽게 모니터링할 수 있다. AI 요청이 실패했을 때도 어떤 레코드에서 문제가 났는지 바로 확인할 수 있게 됐다. 다음에는 결과를 테이블에 로그로 남겨 추세를 분석해볼 계획이다.

# Reference
- https://vercel.com/docs/cron-jobs

# 연결문서
- [Nestjs + Prisma 백엔드에서 고객정보 양방향 암호화하기](/post/nestjs-prisma-baegendeueseo-gogaekjeongbo-yangbanghyang-amhohwahagi)
- [React Native에서 Next.js API를 인증된 상태로 호출하기](/post/react-nativeeseo-next-js-apireul-injeungdoen-sangtaero-hochulhagi)
