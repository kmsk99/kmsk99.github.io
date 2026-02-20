---
tags:
  - OCR
  - AI
  - Pipeline
  - NextJS
  - AWS
  - Security
title: OCR + AI 검증 파이프라인으로 학교 인증 자동화
created: 2025-10-10 10:45
modified: 2025-10-10 10:45
---

"학교 인증이 언제 되냐"는 문의가 올 때마다 종이 문서 인증을 눈으로 확인하던 시절이었다. 1분 이내 완료를 목표로 삼았는데, OCR과 AI 검증을 각각 따로 호출하느라 요청이 꼬이고 실패 로그를 추적하기도 힘들었다. OCR부터 AI 비교, 자동 승인까지 이어지는 하나의 흐름을 직접 설계해봤다.

## 파이프라인 구조

문서 스캔 → 텍스트 추출 → AI 분석 → 결과 저장을 순차적으로 연결한 비동기 체인으로 구성했다. 중간 상태를 RDB에 기록해 실패 지점을 역추적할 수 있게 했다. 오래 걸리는 단계도 체인에 맡겨두고 프론트엔드는 즉시 응답을 받아 UI를 빠르게 갱신했다.

업로드 파일은 AWS KMS로 암호화돼 있었다. `getDecryptedBytes` 같은 헬퍼를 두어 Node.js 런타임에서만 해독이 가능하게 했다. CLOVA OCR API를 감싸는 `/api/ocr` 엔드포인트를 만들고, PDF는 `pdf-lib`로 한 페이지씩 분리해 5회 이하의 동시 호출을 보장했다. LLM 기반 필드 추출은 Bedrock Nova 모델을 사용해 학교명·기간 등을 JSON으로 정렬하도록 프롬프트를 설계했다. 모델이 엉뚱한 응답을 주면 바로 `process_status`를 `error`로 바꿨다.

## 오케스트레이터와 단계별 처리

`orchestrator`가 들어온 요청을 즉시 받아들인 뒤, 내부에서 `/api/admin/school-record/ocr-scan`을 `fetch`로 킥한다. 프로젝트의 `route.ts`는 `chain: true`를 body에 넣어 다음 단계로 넘긴다.

```ts
const body = JSON.stringify({ schoolRecordId, chain: true });
fetch(`${origin}/api/admin/school-record/ocr-scan`, { method: 'POST', body, ... });

// ocr-scan/route.ts - OCR 완료 후 chain이 true면 ai-extract 호출
if (chain) {
  const body = JSON.stringify({ schoolRecordId, version: result.version, chain: true });
  fetch(`${origin}/api/admin/school-record/ai-extract`, { method: 'POST', body, ... });
}
```

`ocr-scan`은 `runOcrScan`으로 첨부파일을 순회하며 CLOVA OCR을 호출하고, 추출된 텍스트를 합쳐 새로운 submission 버전을 만든다. `ocr.server.ts`에서는 PDF를 `pdf-lib`로 페이지별 분리하고, 4개씩 동시 요청으로 CLOVA API 제한을 준수한다. 각 첨부파일별 로그를 남겨 나중에 실패 원인을 쉽게 찾았다.

AI 추출과 비교 단계는 같은 체인 컨셉으로 구현했다. 모델 JSON이 깨졌을 때를 대비해 `fallback` 로직으로 타겟 이름이 텍스트에 있으면 그대로 채워 넣었다. 자동 승인 단계는 confidence 점수가 0.9 이상일 때만 동작하게 했고, 성공 시에는 유저·관리자 알림, 스탬프 적립 같은 후처리를 하나의 함수에서 마무리했다.

## 겪은 이슈

- OCR API 504: 간헐적으로 504를 던졌다. 배치 간 딜레이를 100ms로 뒀다가, 실패 시 재시도가 필요하다는 걸 깨닫고 `Promise.allSettled` 결과를 모아 나중에 수동 재처리할 수 있게 했다.
- PDF 첫 페이지만 읽는 문제: 중요한 도장이 빠지는 경우가 있었다. 페이지 수와 사용자가 원하는 페이지 제한을 비교해 최소 2장까지는 기본으로 읽도록 정책을 바꿨다.
- AI 모델 JSON 파싱: 코드 블록으로 JSON을 감싸는 바람에 파서가 터졌다. 정규식으로 ```json 라벨을 제거하는 전처리를 넣어 해결했다.

한 번의 버튼 클릭으로 모든 단계가 자동으로 흘러간다. 사람 검수 시간은 절반 이하로 떨어졌고, 실패 로그도 submission 테이블에서 바로 찾아볼 수 있다. 체인 구조 덕분에 기능을 쪼개 유지보수할 수 있다는 점이 마음에 든다. 다음에는 과정 중간에 휴리스틱을 더 넣거나, 다른 분야의 문서에도 그대로 확장해보고 싶다.

# Reference
- https://clova.ai/ocr
- https://platform.openai.com/docs
- https://pdf-lib.js.org
- https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html

# 연결문서
- [[Next.js Fluid Computing과 maxDuration 적용]]
- [[파일 암호화 파이프라인 구현]]
- [[Nestjs + Prisma 백엔드에서 고객정보 양방향 암호화하기]]
