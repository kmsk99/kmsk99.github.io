---
tags:
  - NextJS
  - AI
  - OCR
  - Workflow
  - Performance
  - Backend
title: 비동기 체인 플래그로 긴 API 호출 처리하기
created: '2025-09-11'
modified: '2025-10-16'
---

# Intro

AI 문서 인증 체인을 만들면서 가장 먼저 부딪힌 벽은 "요청 타임아웃"이었다. OCR은 파일 크기에 따라 수 초씩 걸리고, LLM 호출은 네트워크 지연이 잦았다. 긴 작업을 클라이언트 요청 하나에 억지로 묶기보다, `chain`이라는 내부 플래그를 두고 스텝마다 책임을 넘기는 전략을 택했다.

# 체인 플래그 전략

최초 요청은 오케스트레이터가 받고, 실 작업은 백그라운드에서 체인을 따라 진행한다. 각 단계는 다음 단계로 넘길지 여부를 `chain` 플래그로 결정해 자연스럽게 중간 탈출이 가능하다. 상태 업데이트는 공통 테이블에 기록해 클라이언트는 폴링이나 SSE로 결과만 조회하면 된다.

# 비동기 kick-off와 상태 추적

Next.js API Route에서 `fetch`를 호출할 때 `await`를 생략해 새 요청을 트리거하되, 실패 로그는 `catch`에서 남기도록 했다. `school_record_submission` 같은 엔티티에 `process_status`, `process_error`를 두어 어느 구간에서 멈췄는지 추적했다. 체인 중 하나라도 조건을 만족하지 못하면 이후 단계는 호출하지 않고, 상태를 `hold`로 두어 사람이 검토할 수 있게 했다.

# 구현 흐름

오케스트레이터는 요청 본문에서 식별자를 받고 바로 `NextResponse.json({ success: true })`를 반환한다. 백엔드 로그에선 `fetch(... chain: true)` 형태로 다음 스텝을 호출한다.

```ts
export async function POST(req: NextRequest) {
  const { schoolRecordId }: OrchestrateRequest = await req.json();
  const body = JSON.stringify({ schoolRecordId, chain: true });

  const fetchPromise = fetch(`${origin}/api/admin/school-record/ocr-scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ... },
    body,
  }).catch(err => console.error('orchestrator kick-off failed:', err));

  const delayPromise = new Promise(resolve => setTimeout(resolve, 1000));
  // 최소 1초 대기하여 fire-and-forget fetch kick-off를 보장
  await Promise.race([fetchPromise, delayPromise]);

  return NextResponse.json({
    success: true,
    message: 'AI 학교인증 체인 시작됨 (비동기)',
    schoolRecordId,
  });
}
```

`ocr-scan` 단계는 모든 첨부파일을 처리한 뒤 submission을 만들고, `chain`이 true라면 AI 추출을 호출한다.

```ts
const result = await runOcrScan({ schoolRecordId, pageLimit: 2 });
if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });

if (chain) {
  const body = JSON.stringify({ schoolRecordId, version: result.version, chain: true });
  const fetchPromise = fetch(`${origin}/api/admin/school-record/ai-extract`, {
    method: 'POST',
    headers: fetchHeaders,
    body,
  }).catch(err => console.error('chain ai-extract failed:', err));

  const delayPromise = new Promise(resolve => setTimeout(resolve, 1000));
  await Promise.race([fetchPromise, delayPromise]);
}

return NextResponse.json({ success: true, message: 'OCR 스캔이 완료되었습니다.' });
```

`chain`을 false로 넣으면 해당 단계만 실행하고 종료할 수 있어 재처리에 유용하다. 마지막 자동 승인 단계는 confidence가 낮거나 정책을 만족하지 못하면 그냥 종료한다. 체인은 여기서 끝나고, UI는 폴링으로 결과를 알아서 반영한다.

# 겪은 이슈와 해결

체인 호출이 실패해도 상위 요청은 이미 성공을 반환했기 때문에, 로그만으로는 파악이 어려웠다. submission 테이블에 `process_status` 변경을 web dashboard에서 직접 볼 수 있게 만들었다. `fetch` 호출을 기다리지 않다 보니, Node.js 런타임이 요청 종료와 동시에 프로세스를 닫아버리는 문제가 있었다. 이를 막기 위해 가벼운 헬스체크 응답을 반환하기 전에 `fetch`를 큐에 넣고, Promise가 시작되도록 `void fetch(...)`가 아닌 `fetch(...).catch(...)` 형식으로 작성했다. 한동안 체인 전체의 SLA를 계산하기 힘들었다. 결국 간단한 측정기로 각 단계 시작·종료 시각을 로깅하고, 합산 시간을 대시보드에 시각화했다.

# 결과

지금은 사용자가 버튼을 누르면 즉시 응답을 받고, 백엔드 체인은 뒤에서 천천히 일을 마친다. 재처리가 필요할 때는 체인을 끊고 특정 단계만 수동 호출할 수 있어, 운영팀도 긴장하지 않는다.

# Reference
- https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- https://developer.mozilla.org/docs/Web/API/fetch#parameters
- https://12factor.net/processes

# 연결문서
- [CLOVA OCR API와 PDF 페이지 분할로 학력 증빙 자동화](/post/clova-ocr-apiwa-pdf-peiji-bunhallo-hangnyeok-jeungbing-jadonghwa)
- [Next.js Fluid Computing과 maxDuration 적용](/post/next-js-fluid-computinggwa-maxduration-jeongnyong)
- [NextJs와 도커 사용시 핫리로드 불가 문제](/post/nextjswa-dokeo-sayongsi-hatrirodeu-bulga-munje)
