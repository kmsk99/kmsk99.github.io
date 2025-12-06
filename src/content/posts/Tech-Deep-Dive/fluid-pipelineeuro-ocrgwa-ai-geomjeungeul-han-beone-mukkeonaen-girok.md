---
tags:
  - Engineering
  - TechDeepDive
  - OCR
  - AI
  - PDF
  - AWS
  - Security
  - Encryption
title: Fluid Pipeline으로 OCR과 AI 검증을 한 번에 묶어낸 기록
created: '2025-10-10 10:45'
modified: '2025-10-10 10:45'
---

# Intro
- 종이 문서 인증을 눈으로 확인하던 시절, 저는 늘 마감 직전에 머리를 쥐어뜯었습니다.
- 그러다 보니 OCR과 AI 검증을 각각 따로 호출하느라 요청이 꼬이고, 실패 로그를 추적하기도 힘들었습니다.
- 그래서 이번에는 OCR부터 AI 비교, 자동 승인까지 이어지는 하나의 흐름을 직접 설계해봤습니다.

## 핵심 아이디어 요약
- 문서 스캔 → 텍스트 추출 → AI 분석 → 결과 저장을 순차적으로 연결한 비동기 체인으로 구성했습니다.
- 중간 상태를 RDB에 기록해 실패 지점을 역추적할 수 있게 했습니다.
- 오래 걸리는 단계도 체인에 맡겨두고 프론트엔드는 즉시 응답을 받아 UI를 빠르게 갱신했습니다.

## 준비와 선택
1. **보안이 필요한 파일 복호화**: 업로드 파일은 AWS KMS로 암호화돼 있었습니다. `getDecryptedBytes` 같은 헬퍼를 두어 Node.js 런타임에서만 해독이 가능하도록 했습니다.
2. **OCR 서비스 추상화**: CLOVA OCR API를 감싸는 `/api/ocr` 엔드포인트를 만들고, PDF는 `pdf-lib`로 한 페이지씩 분리해 5회 이하의 동시 호출을 보장했습니다.
3. **LLM 기반 필드 추출**: Bedrock Nova 모델을 사용해 학교명·기간 등을 JSON으로 정렬하도록 프롬프트를 설계했습니다. 모델이 엉뚱한 응답을 주면 바로 `process_status`를 `error`로 바꿉니다.

## 구현 여정
- Step 1: `orchestrator`가 들어온 요청을 즉시 받아들인 뒤, 내부에서 `/api/admin/.../ocr-scan`을 `fetch`로 킥합니다. 이때는 응답을 기다리지 않고 바로 `success`를 반환해 클라이언트를 잠깐이나마 해방시켰습니다.
- Step 2: `ocr-scan`은 첨부파일을 순회하며 문서에 맞는 OCR 전략을 고르고, 추출된 텍스트를 합쳐 새로운 submission 버전을 만들었습니다. 각 첨부파일별 로그를 남겨 나중에 실패 원인을 쉽게 찾았습니다.
- Step 3: AI 추출과 비교 단계는 모두 같은 체인 컨셉으로 구현했습니다. 모델 JSON이 깨졌을 때를 대비해 `fallback` 로직으로 타겟 이름이 텍스트에 있으면 그대로 채워 넣었습니다.
- Step 4: 끝으로 자동 승인 단계는 confidence 점수가 0.9 이상일 때만 동작하게 했고, 성공 시에는 유저·관리자 알림, 스탬프 적립 같은 후처리를 하나의 함수에서 마무리했습니다.

## 겪은 이슈와 해결 과정
- OCR API가 간헐적으로 504를 던졌습니다. 저는 배치 간 딜레이를 100ms로 뒀다가, 실패 시 재시도가 필요하다는 걸 깨닫고 `Promise.allSettled` 결과를 모아 나중에 수동 재처리할 수 있게 했습니다.
- PDF의 첫 페이지만 읽다가 중요한 도장이 빠지는 경우가 있었습니다. 그래서 페이지 수와 사용자가 원하는 페이지 제한을 비교해 최소 2장까지는 기본으로 읽도록 정책을 바꿨습니다.
- AI 모델이 코드 블록으로 JSON을 감싸는 바람에 파서가 터졌습니다. 정규식으로 ```json 라벨을 제거하는 전처리를 넣어 해결했습니다.

## 결과와 회고
- 지금은 한 번의 버튼 클릭으로 모든 단계가 자동으로 흘러갑니다. 사람 검수 시간은 절반 이하로 떨어졌고, 실패 로그도 submission 테이블에서 바로 찾아볼 수 있습니다.
- 무엇보다 체인 구조 덕분에 기능을 쪼개 유지보수할 수 있다는 점이 마음에 듭니다. 다음에는 과정 중간에 휴리스틱을 더 넣거나, 다른 분야의 문서에도 그대로 확장해보고 싶습니다.
- 여러분은 OCR과 AI를 함께 쓸 때 어떤 실패 케이스를 가장 두려워하시나요? 댓글로 경험을 들려주시면 저도 배워보고 싶습니다.

# Reference
- https://pdf-lib.js.org
- https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html

# 연결문서
- [Next.js Fluid Computing으로 서버 리듬을 조율한 이야기](/post/next-js-fluid-computingeuro-seobeo-rideumeul-joyulhan-iyagi)
- [AWS KMS와 AES-GCM으로 서버 사이드 암호화 업로드 구축기](/post/aws-kmswa-aes-gcmeuro-seobeo-saideu-amhohwa-eomnodeu-guchukgi)
- [AES-256과 Prisma Middleware로 개인정보 안전하게 돌리기](/post/aes-256gwa-prisma-middlewarero-gaeinjeongbo-anjeonhage-dolligi)
