---
tags:
  - Engineering
  - TechDeepDive
  - AI
  - OCR
  - NextJS
  - Performance
  - Frontend
title: Chain Flag로 긴 호출 시간을 견디는 법
created: '2025-10-10 10:55'
modified: '2025-10-10 10:55'
---

# Intro
- AI 문서 인증 체인을 만들면서 가장 먼저 부딪힌 벽은 “요청 타임아웃”이었습니다.
- OCR은 파일 크기에 따라 수 초씩 걸리고, LLM 호출은 네트워크 지연이 잦았습니다.
- 저는 이 긴 작업을 클라이언트 요청 하나에 억지로 묶기보다, `chain`이라는 내부 플래그를 두고 스텝마다 책임을 넘기는 전략을 택했습니다.

## 핵심 아이디어 요약
- 최초 요청은 오케스트레이터가 받고, 실 작업은 백그라운드에서 체인을 따라 진행합니다.
- 각 단계는 다음 단계로 넘길지 여부를 `chain` 플래그로 결정해 자연스럽게 중간 탈출이 가능하도록 했습니다.
- 상태 업데이트는 공통 테이블에 기록해 클라이언트는 폴링이나 SSE로 결과만 조회하면 됩니다.

## 준비와 선택
1. **비동기 kick-off**: Next.js API Route에서 `fetch`를 호출할 때 `await`를 생략해 새 요청을 트리거하되, 실패 로그는 `catch`에서 남기도록 했습니다.
2. **단계별 상태 테이블**: `school_record_submission` 같은 엔티티에 `process_status`, `process_error`를 두어 어느 구간에서 멈췄는지 추적했습니다.
3. **중간 중단 설계**: 체인 중 하나라도 조건을 만족하지 못하면 이후 단계는 호출하지 않고, 상태를 `hold`로 두어 사람이 검토할 수 있게 했습니다.

## 구현 여정
- Step 1: 오케스트레이터는 요청 본문에서 식별자를 받고 바로 `NextResponse.json({ success: true })`를 반환합니다. 백엔드 로그에선 `fetch(... chain: true)` 형태로 다음 스텝을 호출합니다.
- Step 2: `ocr-scan` 단계는 모든 첨부파일을 처리한 뒤 submission을 만들고, `chain`이 true라면 AI 추출을 호출합니다. 실패 시에는 `recordProcessError`로 에러 요약을 저장합니다.
- Step 3: AI 추출과 비교 단계에서도 같은 패턴을 유지했습니다. `chain`을 false로 넣으면 해당 단계만 실행하고 종료할 수 있어 재처리에 유용합니다.
- Step 4: 마지막 자동 승인 단계는 confidence가 낮거나 정책을 만족하지 못하면 그냥 종료합니다. 체인은 여기서 끝나고, UI는 폴링으로 결과를 알아서 반영합니다.

## 겪은 이슈와 해결 과정
- 체인 호출이 실패해도 상위 요청은 이미 성공을 반환했기 때문에, 로그만으로는 파악이 어렵습니다. 저는 submission 테이블에 `process_status` 변경을 web dashboard에서 직접 볼 수 있게 만들었습니다.
- `fetch` 호출을 기다리지 않다 보니, Node.js 런타임이 요청 종료와 동시에 프로세스를 닫아버리는 문제가 있었습니다. 이를 막기 위해 가벼운 헬스체크 응답을 반환하기 전에 `fetch`를 큐에 넣고, Promise가 시작되도록 `void fetch(...)`가 아닌 `fetch(...).catch(...)` 형식으로 작성했습니다.
- 한동안 체인 전체의 SLA를 계산하기 힘들었습니다. 결국 간단한 측정기로 각 단계 시작·종료 시각을 로깅하고, 합산 시간을 대시보드에 시각화했습니다.

## 결과와 회고
- 지금은 사용자가 버튼을 누르면 즉시 응답을 받고, 백엔드 체인은 뒤에서 천천히 일을 마칩니다.
- 재처리가 필요할 때는 체인을 끊고 특정 단계만 수동 호출할 수 있어, 운영팀도 긴장하지 않습니다.
- 혹시 여러분도 비슷한 체인이 있다면, 실패 시 재시도보다 먼저 “상태를 어떻게 보여줄까?”를 고민해보길 추천합니다. 더 나은 경험이 있다면 꼭 알려주세요.

# Reference
- https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- https://developer.mozilla.org/docs/Web/API/fetch#parameters
- https://12factor.net/processes

# 연결문서
- [CLOVA OCR API와 PDF 페이지 분할로 학력 증빙 자동화](/post/clova-ocr-apiwa-pdf-peiji-bunhallo-hangnyeok-jeungbing-jadonghwa)
- [Next.js Fluid Computing으로 서버 리듬을 조율한 이야기](/post/next-js-fluid-computingeuro-seobeo-rideumeul-joyulhan-iyagi)
- [NextJs와 도커 사용시 핫리로드 불가 문제](/post/nextjswa-dokeo-sayongsi-hatrirodeu-bulga-munje)
