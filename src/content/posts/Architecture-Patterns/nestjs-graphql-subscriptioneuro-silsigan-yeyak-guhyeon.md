---
tags:
  - NestJS
  - GraphQL
  - Prisma
  - Realtime
  - Reservations
  - Backend
title: NestJS GraphQL Subscription으로 실시간 예약 구현
created: '2024-02-14 10:05'
modified: '2024-02-14 10:05'
---

# Intro

공간 예약 트래픽이 한밤중에도 몰리는 SaaS를 운영한다. REST 중심으로 구축했던 예전 시스템은 폴링이 잦아서 공석이 나도 바로 반영되지 않았고, 동시에 두 명이 같은 시간을 잡으면 뒤늦게 충돌이 일어나곤 했다. 그래서 이번엔 NestJS + GraphQL + Prisma 조합으로 실시간성을 끌어올렸다.

# GraphQL 구독과 프론트엔드 분기

GraphQL 구독을 `graphql-ws` 프로토콜로 통일해 웹·모바일에서 같은 스트림을 바라보게 했다. Prisma 레벨에서 시간대 중복을 탐지하고, 트랜잭션 안에서 예약 카운트를 즉시 갱신하도록 했다. 프론트엔드는 Apollo Client의 `split` 링크로 구독과 쿼리를 자연스럽게 나눠 사용자에게 즉각적인 UI 피드백을 줬다.

HTTP와 WebSocket을 동시에 써야 했기 때문에 NestJS `GqlConfigService`에서 구독 경로를 `/graphql` 하나로 고정했다. 예약 도메인은 민감한 정보가 많아서 토큰을 연결 파라미터로 넘겨야 했다. 백엔드 `onConnect` 훅에서 Authorization 헤더를 주입하고, 프론트에서도 동일한 키를 맞췄다. Prisma가 제공하는 미들웨어와 트랜잭션을 활용해 예약 시간을 배열 비교로 검증했다.

# 구독 설정

```ts
subscriptions: {
  'graphql-ws': {
    path: '/graphql',
    onConnect: connectionParams => ({
      req: {
        headers: {
          authorization:
            connectionParams.authorization ??
            connectionParams.Authorization ??
            '',
        },
      },
    }),
  },
},
```

이 구조 덕분에 구독 컨텍스트에서도 기존 JWT 가드를 재사용할 수 있었다.

# 프론트엔드 링크 분기

```ts
const wsLink = new GraphQLWsLink(
  createClient({
    url: process.env.NEXT_PUBLIC_GRAPHQL_WS_ENDPOINT ?? 'ws://localhost:4000/graphql',
    connectionParams: () => {
      const token = localStorage.getItem('accessToken') ?? '';
      return token ? { authorization: `Bearer ${token}` } : {};
    },
    shouldRetry: () => true,
    retryAttempts: 5,
  }),
);

const splitLink = split(
  ({ query }) => {
    const definition = getMainDefinition(query);
    return (
      definition.kind === 'OperationDefinition' &&
      definition.operation === 'subscription'
    );
  },
  wsLink,
  authLink.concat(httpLink),
);
```

결과적으로 예약이 승인될 때마다 UI 리스트가 스르륵 갱신돼 폴링 코드를 완전히 지울 수 있었다.

# 시간대 충돌 방지

프로젝트의 `facility-reservations.service.ts`에서 실제로 쓰는 시간 중복 검사 로직이다. `reservationTime`은 문자열 배열(예: `['09:00', '10:00']`)이고, 이미 승인된 예약들의 시간을 `flat()`으로 펼쳐 비교한다.

```ts
const reservation = await this.prisma.facilityReservation.findMany({
  where: {
    facilityId: facilityReservation.facilityId,
    reservationDate: {
      gte: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
      lt: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1),
    },
    status: 'ACCEPTED',
  },
});

const occupiedTime = reservation.map(r => r.reservationTime).flat();
const reservationTime = facilityReservation.reservationTime;

// 예약 시간이 겹치는 경우 true 반환
const result = reservationTime.some(time => occupiedTime.includes(time));
return result;
```

`duplicateTime` 메서드에서는 겹치는 시간대만 필터링해 `timeArrayToRangeString`으로 사용자에게 보여줄 문자열을 만든다. `upsert`가 아닌 분리된 트랜잭션을 쓴 이유는, 한 번의 요청에서 여러 시간대를 잡는 경우가 있어서 실패 시 전체 요청을 롤백하기 위함이다.

# 예상치 못한 이슈

구독 서버와 프론트의 시간 제한이 맞지 않아 첫 배포 직후에는 30초마다 연결이 끊겼다. CloudFront 앞단의 Idle Timeout을 늘리고, 클라이언트에서 `retryWait`를 지수 백오프로 바꿔 끊김을 줄였다. GraphQL 스키마가 커지면서 codegen 시간이 늘었는데, Turborepo 대신 pnpm `--filter`로 스키마 관련 패키지만 재생성하도록 했다. GPT한테는 `graphql-ws` 재연결 전략을 비교 설명해 달라고 부탁해 최종 파라미터를 결정했다.

# 결과

이제 예약 현황을 지켜보던 운영자가 새로고침을 반복하지 않아도 되고, 사용자는 웹과 모바일에서 동일한 실시간 피드를 본다. Prisma를 중심으로 검증 로직을 한 곳에 모아두니 REST 시절보다 버그 재현이 쉬워졌고, 로드 테스트에서도 1초 내 응답률이 20% 이상 개선됐다. 다음 목표는 예약 승인이 아닌 취소·변경 워크플로에도 같은 실시간성을 적용하는 것이다.

# Reference
- https://docs.nestjs.com/graphql/subscriptions
- https://github.com/enisdenjo/graphql-ws
- https://the-guild.dev/graphql/ws
- https://www.prisma.io/docs/concepts/components/prisma-client/transactions

# 연결문서
- [GitHub Actions와 Docker, Elastic Beanstalk로 통합 배포 자동화하기](/post/github-actionswa-docker-elastic-beanstalkro-tonghap-baepo-jadonghwahagi)
- [Winston + CloudWatch 구조화 로깅 구현](/post/winston-cloudwatch-gujohwa-roging-guhyeon)
- [pnpm 워크스페이스 모노레포 구성](/post/pnpm-wokeuseupeiseu-monorepo-guseong)
