---
tags:
  - Engineering
  - TechDeepDive
  - NextJS
  - Caching
  - AWS
  - OCR
  - PDF
  - AI
title: Next.js Fluid Computing으로 서버 리듬을 조율한 이야기
created: 2025-10-10 10:50
modified: 2025-10-10 10:50
uploaded: "false"
---

# Intro
- 저는 최근까지 Next.js에서 Edge, Node.js, 클라이언트를 적절히 분리하는 일을 감으로만 해왔습니다.
- 문서 인증 파이프라인을 붙이면서 서버 리소스가 확 튀는 걸 보고, Next.js가 말하는 Fluid Computing 개념을 제대로 정리해야겠다고 마음먹었습니다.
- 결국 요청의 성격에 따라 런타임을 유연하게 바꾸는 전략을 정립해, CPU를 태우는 작업과 즉시 응답이 필요한 화면을 공존시켰습니다.

## 핵심 아이디어 요약
- Fluid Computing은 에지와 서버, 클라이언트를 상황에 맞춰 섞어 쓰는 Next.js 접근법이라고 이해했습니다.
- 라우트마다 `runtime`과 `dynamic`을 선언해 어느 쪽 리소스를 쓸지 명확히 적었습니다.
- 서버 전용 유틸은 Node.js 전용 라우트로 밀어 넣고, 화면은 가능하면 스트리밍이나 CSR로 가볍게 돌렸습니다.

## 준비와 선택
1. **Node.js 런타임 고정 구간**: AWS KMS, `pdf-lib` 같은 네이티브 의존성이 있는 API는 `export const runtime = 'nodejs';`로 명시해 Edge 배포에서 자연스럽게 제외했습니다.
2. **동적 데이터 우선 라우트**: 사용자 프로필, 혜택 페이지 같이 자주 변하는 데이터는 `export const dynamic = 'force-dynamic';`으로 선언해 ISR로 잘못 묶이는 일을 막았습니다.
3. **정적 경량 자원**: 이미지 에셋이나 공지 페이지는 기본 정적 빌드에 맡겼습니다. 필요하면 `revalidate` 값을 추가해 캐시를 조절했습니다.

## 구현 여정
- Step 1: API 라우트를 전수 조사해 어떤 의존성이 있는지 확인했습니다. OCR, AI 비교, 자동 승인 라우트는 모두 Node.js 런타임이 필요하다는 걸 확인하고 설정을 넣었습니다.
- Step 2: 모바일 전용 페이지들은 `src/app/(mobile)` 아래에 있으면서도 서버 컴포넌트로 작성되어 있습니다. 저는 이 부분을 `force-dynamic`으로 바꿔 실시간 데이터를 확실히 전달하도록 했습니다.
- Step 3: Next 이미지 최적화는 CDN에서 가져오는 자원을 다루므로 `remotePatterns`를 등록했습니다. 덕분에 Fluid Computing 흐름이 끊기지 않고, 에지 캐시와 서버 렌더링이 자연스럽게 이어졌습니다.

## 겪은 이슈와 해결 과정
- 처음에는 Edge로 돌려도 되겠지 싶어 OCR 라우트의 런타임을 명시하지 않았는데, 배포 후 `pdf-lib`가 `fs`를 찾지 못한다는 오류를 쏟아냈습니다. 이때 Fluid Computing 글을 찾아보며 “요청별 런타임을 정해두라”는 조언을 확인했습니다.
- 또 한 번은 리드 타임을 줄이겠다며 모든 페이지를 정적으로 만들어버렸더니, 관리자가 데이터를 갱신해도 반영이 늦었습니다. 이후 `force-dynamic`과 `revalidate`를 적절히 섞는 패턴을 정리했습니다.
- 무엇보다 중요한 건 팀 규범을 세우는 일이었습니다. PR 템플릿에 “새 라우트의 runtime/dynamic 전략”이라는 체크박스를 넣어, 모두가 같은 원칙을 공유하도록 했습니다.

## 결과와 회고
- 이제는 서버 무거운 작업이 특히 필요한 엔드포인트만 Node.js 런타임으로 묶여 있어, 엣지 캐시가 필요한 페이지는 자유롭게 배포됩니다.
- Fluid Computing이라는 이름을 붙이니 팀 동료와 대화도 쉬워졌습니다. “이건 플루이드하게 Node로 보내자” 같은 말이 농담처럼 오가지만, 실제로는 큰 사고를 방지하는 암묵지로 작동합니다.
- 여러분은 어떤 기준으로 라우트 런타임을 정하시나요? 더 스마트한 체크리스트가 있다면 꼭 공유해주세요.

# Reference
- https://nextjs.org/docs/app/building-your-application/rendering/edge-and-nodejs-runtimes

# 연결문서
- [[Fluid Pipeline으로 OCR과 AI 검증을 한 번에 묶어낸 기록]]
- [[PWA로 모바일 사용성을 챙기며 S3 업로드와 오프라인 캐싱을 조율한 기록]]
- [[CLOVA OCR API와 PDF 페이지 분할로 학력 증빙 자동화]]
