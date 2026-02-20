---
tags:
  - Logging
  - Winston
  - CloudWatch
  - NestJS
  - GraphQL
  - DevOps
title: Winston + CloudWatch 구조화 로깅 구현
created: 2024-02-14 10:10
modified: 2024-02-14 10:10
---

새벽 배포 후에만 터지는 버그 때문에 여러 번 곤혹을 치렀다. 로그가 텍스트 한 줄로만 남고, CloudWatch에서는 인코딩 문제로 제대로 검색도 안 됐다. NestJS 기본 로거 대신 Winston을 중심으로 구조화 로깅과 CloudWatch 수집 파이프라인을 다시 짰다.

## 트랜스포트 구성

콘솔과 CloudWatch에 각각 맞는 포맷을 적용해 읽기 쉬운 로그와 검색 가능한 JSON을 동시에 얻었다. `main.ts`에서 `WinstonModule`을 기본 로거로 주입하고 `app.useLogger`로 NestJS 내부 로그도 같은 파이프라인을 타게 했다. CloudWatch는 공식 모듈 대신 직접 작성한 커스텀 트랜스포트(`cloudwatch-winston.ts`)를 썼다. `@aws-sdk/client-cloudwatch-logs`로 PutLogEvents를 호출하고, 배치 업로드 간격을 `minInterval`로 조절했다.

```ts
// iloveclub-core/packages/backend/src/common/utils/winston.util.ts
const transports = [
  new winston.transports.Console({
    level: currentLogLevels.console,
    format: env === 'production'
      ? winston.format.combine(
          winston.format.timestamp({ format: getISOTimestamp }),
          winston.format.json(),
          winston.format.printf(info => {
            if (typeof info.message === 'object' && info.message !== null) {
              return JSON.stringify({ timestamp: info.timestamp, level: info.level, ...info.message });
            }
            return `${info.timestamp} ${info.level}: ${info.message}`;
          }),
        )
      : winston.format.combine(
          winston.format.timestamp({ format: getISOTimestamp }),
          winston.format.json(),
          utilities.format.nestLike('IloveClub', { prettyPrint: true }),
        ),
  }),
];

// CloudWatch 트랜스포트 추가 (환경별 활성화)
if (getCloudWatchLevel() !== false) {
  transports.push(new CloudWatchTransport({
    logGroupName: `IloveClub-Backend-${env}`,
    logStreamName: getLogStreamName,  // IloveClub-Logs-YYYY-MM-DD
    shouldCreateLogGroup: true,
    shouldCreateLogStream: true,
    minInterval: 10000,  // 10초마다 전송
    maxQueuedBatches: 50,
    maxBatchCount: 100,
    ignoreErrors: true,
    formatLog: (item) => { /* JSON 포맷팅 */ },
    getTimestamp: ({ timestamp }) => { /* ISO → ms 변환 */ },
  }));
}
```

## 메시지 포맷과 제약

환경마다 레벨을 다르게 주고, `correlationId`, `requestId` 같은 필드를 확장할 수 있도록 json 포맷을 유지했다. CloudWatch는 256KB 이상 이벤트를 거부하니, `cloudwatch-winston.ts`에서 `truncate-utf8-bytes`로 메시지를 잘라낸다.

```ts
// iloveclub-core/packages/backend/src/common/utils/winston.util.ts
const LOG_LEVELS = {
  production: { console: 'info', file: 'verbose', cloudwatch: 'http' },
  development: { console: 'verbose', file: 'debug', cloudwatch: 'http' },
  test: { console: 'info', file: 'info', cloudwatch: 'none' },
};

export const winstonLogger = WinstonModule.createLogger({
  transports: winstonTransports,
  format: winston.format.combine(
    winston.format.timestamp({ format: getISOTimestamp }),
    combineMessageAndSplat(),  // splat 인자 처리 및 순환 참조 방지
    winston.format.json(),
  ),
});
```

`cloudwatch-winston.ts`는 `maxMessageNumBytes: 256000`을 넘으면 `[Truncated by CloudWatchTransport]` 접미사를 붙여 잘라낸다. 이 설정 덕분에 CloudWatch에서 `level="error"` 같은 쿼리로 바로 필터링할 수 있게 됐다.

## GraphQL 로그 소음 줄이기

초기에는 모든 GraphQL 요청이 미들웨어에서 로깅되어 콘솔이 난리였다. `logging.middleware.ts`에 "GraphQL이면 인터셉터에서 처리하고 미들웨어는 패스"하는 조건을 추가해 이중 로그를 막았다.

```ts
// iloveclub-core/packages/backend/src/logging/logging.middleware.ts
@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const isGraphql = req.body?.operationName;
    if (isGraphql) {
      // GraphQL 요청이면, 로깅을 intercept에서 처리하도록 middleware 로깅을 건너뜁니다.
      return next();
    }

    const userAgent = req.get('user-agent');
    if (userAgent && userAgent.includes('ELB-HealthChecker')) {
      return next();
    }

    // REST 로깅 처리
    res.on('finish', () => {
      this.logger.http(
        `[${method}] ${originalUrl} - IP: ${realIp} - Status: ${statusCode} - UserAgent: ${userAgent}`,
      );
    });
    next();
  }
}
```

이후에는 인터셉터에서 응답 시간, 변수 크기 등을 별도 필드로 기록해 성능 분석에도 활용하고 있다.

## 겪은 이슈

- CloudWatch 스트림: 날짜별 스트림만 지원해서, 최초 배포 후 하루가 지나면 자동으로 스트림을 만들지 못했다. `ensureLogStream` 로직을 추가하고 10초마다 스트림을 재확인하도록 스케줄러를 붙였다.
- 순환 참조: JSON.stringify 시 순환 참조가 있으면 전송에 실패했다. `combineMessageAndSplat` 헬퍼로 순환 필드를 제거하고, GPT에게 NestJS 응답 객체 구조를 물어보며 예외 케이스를 점검했다.

지금은 Sentry보다 먼저 CloudWatch에서 문제를 발견할 정도로 로그가 명확해졌다. 성능 리포트를 만들 때도 구조화된 데이터를 그대로 Athena에 적재해 활용했고, 알람 조건을 세분화하면서 야간 장애 대응 시간을 30% 정도 줄였다. 다음에는 OpenTelemetry와 연동해 추적 정보까지 한 번에 묶어볼 계획이다.

# Reference
- https://github.com/winstonjs/winston
- https://github.com/lazywithclass/winston-cloudwatch
- https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/WhatIsCloudWatchLogs.html
- https://docs.nestjs.com/techniques/logger

# 연결문서
- [[파일 암호화 파이프라인 구현]]
- [[NestJS GraphQL Subscription으로 실시간 예약 구현]]
- [[CLOVA OCR API와 PDF 페이지 분할로 학력 증빙 자동화]]
