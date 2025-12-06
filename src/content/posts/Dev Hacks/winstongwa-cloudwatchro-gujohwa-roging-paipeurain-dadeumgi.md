---
tags:
  - Engineering
  - TechDeepDive
  - Logging
  - AWS
  - NestJS
  - GraphQL
  - CICD
  - Performance
title: Winston과 CloudWatch로 구조화 로깅 파이프라인 다듬기
created: '2025-02-14 10:10'
modified: '2025-02-14 10:10'
---

# Intro
저는 새벽 배포 후에만 터지는 버그 때문에 여러 번 곤혹을 치렀습니다. 로그가 텍스트 한 줄로만 남고, CloudWatch에서는 인코딩 문제가 생겨 제대로 검색도 안 됐거든요. 그래서 NestJS의 기본 로거 대신 Winston을 중심으로 구조화 로깅과 CloudWatch 수집 파이프라인을 다시 짰습니다.

## 핵심 아이디어 요약
- 콘솔과 CloudWatch에 각각 맞는 포맷을 적용해 읽기 쉬운 로그와 검색 가능한 JSON을 동시에 얻었습니다.
- 전송 실패를 대비해 커스텀 트랜스포트(`cloudwatch-winston.ts`)로 배치 크기·리트라이 전략을 제어했습니다.
- NestJS 전역 로거를 교체하고, GraphQL 요청은 인터셉터로 세분화해 noisy 로그를 줄였습니다.

## 준비와 선택
1. **로거 교체**  
   `main.ts`에서 `WinstonModule`을 기본 로거로 주입하고 `app.useLogger`로 NestJS 내부 로그도 같은 파이프라인을 타게 했습니다.
2. **구조화 포맷**  
   환경마다 레벨을 다르게 주고, `correlationId`, `requestId` 같은 필드를 확장할 수 있도록 json 포맷을 유지했습니다.
3. **CloudWatch 제약 반영**  
   CloudWatch는 1MB 이상의 이벤트를 거부하므로, 메시지를 일정 길이에서 truncation하는 헬퍼를 만들었습니다.

## 구현 여정
### Step 1: 트랜스포트 구성

```ts
// src/common/utils/winston.util.ts
const transports = [
  new winston.transports.Console({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.colorize(),
      winston.format.printf(info => `${info.timestamp} [${info.level}] ${info.message}`),
    ),
  }),
  new CloudWatchTransport({
    logGroupName: process.env.CLOUDWATCH_LOG_GROUP,
    logStreamName: () => `backend-${new Date().toISOString().slice(0, 10)}`,
    messageFormatter: cloudWatchMessageFormatter,
    uploadRate: 1000,
    retryCount: 5,
  }),
];
```

`CloudWatchTransport`는 공식 모듈 대신 직접 작성했습니다. 덕분에 배치 업로드 간격을 1초로 줄이고, 오류가 나면 이벤트를 다시 큐에 넣을 수 있었습니다.

### Step 2: 메시지 포맷 통일

```ts
// src/common/utils/winston.util.ts
export const winstonLogger = WinstonModule.createLogger({
  defaultMeta: {
    service: 'reservation-platform',
    environment: process.env.NODE_ENV,
  },
  transports: winstonTransports,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    winston.format.json(),
  ),
});
```

이 설정 덕분에 CloudWatch에서 `service="reservation-platform"` 같은 쿼리로 바로 필터링할 수 있게 됐습니다.

### Step 3: GraphQL 요청 소음 줄이기
초기에는 모든 GraphQL 요청이 미들웨어에서 로깅되어 콘솔이 난리였습니다. `logging.middleware.ts`에 "GraphQL이면 인터셉터에서 처리하고 미들웨어는 패스"하는 조건을 추가해 의도치 않은 이중 로그를 막았습니다. 이후에는 인터셉터에서 응답 시간, 변수 크기 등을 별도 필드로 기록해 성능 분석에도 활용하고 있습니다.

### 예상치 못한 이슈
- CloudWatch API는 날짜별 스트림만 지원해서, 최초 배포 후 하루가 지나면 자동으로 스트림을 만들지 못했습니다. `ensureLogStream` 로직을 추가하고, 10초마다 스트림을 재확인하도록 스케줄러를 붙였습니다.
- JSON.stringify 시 순환 참조가 있으면 전송에 실패했습니다. `combineMessageAndSplat` 헬퍼로 순환 필드를 제거하고, GPT에게 순환 참조가 숨어 있을 만한 NestJS 응답 객체 구조를 물어보며 예외 케이스를 점검했습니다.

## 결과와 회고
지금은 Sentry보다 먼저 CloudWatch에서 문제를 발견할 정도로 로그가 명확해졌습니다. 성능 리포트를 만들 때도 구조화된 데이터를 그대로 Athena에 적재해 활용했고, 알람 조건을 세분화하면서 야간 장애 대응 시간을 30% 정도 줄였습니다. 다음에는 OpenTelemetry와 연동해 추적 정보까지 한 번에 묶어볼 계획입니다. 여러분은 어떤 기준으로 로그를 구조화하고 계신가요?

# Reference
- https://github.com/winstonjs/winston
- https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/WhatIsCloudWatchLogs.html
- https://docs.nestjs.com/techniques/logger

# 연결문서
- [[AWS KMS와 AES-GCM으로 서버 사이드 암호화 업로드 구축기]]
- [[NestJS GraphQL 예약 도메인에서 실시간성을 확보한 과정]]
- [[CLOVA OCR API와 PDF 페이지 분할로 학력 증빙 자동화]]
