---
tags:
  - NestJS
  - GraphQL
  - Prisma
  - Realtime
  - Reservations
  - Backend
title: NestJS GraphQL 예약 도메인에서 실시간성을 확보한 과정
created: 2025-02-14 10:05
modified: 2025-02-14 10:05
---

# Intro
저는 공간 예약 트래픽이 한밤중에도 몰리는 SaaS를 운영합니다. REST 중심으로 구축했던 예전 시스템은 폴링이 잦아서 공석이 나도 바로 반영되지 않았고, 동시에 두 명이 같은 시간을 잡으면 뒤늦게 충돌이 일어나곤 했죠. 그래서 이번엔 NestJS + GraphQL + Prisma 조합으로 실시간성을 끌어올렸습니다.

## 핵심 아이디어 요약
- GraphQL 구독을 `graphql-ws` 프로토콜로 통일해 웹·모바일에서 같은 스트림을 바라보게 했습니다.
- Prisma 레벨에서 시간대 중복을 탐지하고, 트랜잭션 안에서 예약 카운트를 즉시 갱신하도록 했습니다.
- 프론트엔드는 Apollo Client의 `split` 링크로 구독과 쿼리를 자연스럽게 나눠 사용자에게 즉각적인 UI 피드백을 줬습니다.

## 준비와 선택
1. **연결 관리**  
   HTTP와 WebSocket을 동시에 써야 했기 때문에 NestJS `GqlConfigService`에서 구독 경로를 `/graphql` 하나로 고정했습니다.
2. **권한 전달**  
   예약 도메인은 민감한 정보가 많아서 토큰을 연결 파라미터로 넘겨야 했습니다. 백엔드 `onConnect` 훅에서 Authorization 헤더를 주입하고, 프론트에서도 동일한 키를 맞췄습니다.
3. **동시성 제어**  
   Prisma가 제공하는 미들웨어와 트랜잭션을 활용해 예약 시간을 배열 비교로 검증했습니다.

## 구현 여정
### Step 1: 구독 설정 다듬기
`src/gql-config.service.ts`에서는 다음과 같이 `graphql-ws`를 등록했습니다.

```ts
// src/gql-config.service.ts
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

이 구조 덕분에 구독 컨텍스트에서도 기존 JWT 가드를 재사용할 수 있었습니다.

### Step 2: 프론트엔드 링크 분기
Next.js 앱에서 Apollo Client를 만들 때 다음과 같은 `split` 구성을 썼습니다.

```ts
// src/shared/components/ApolloWrapper/ui/index.tsx
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

결과적으로 예약이 승인될 때마다 UI 리스트가 스르륵 갱신돼 폴링 코드를 완전히 지울 수 있었습니다.

### Step 3: 시간대 충돌 방지
Prisma 서비스에서는 예약 시간 배열을 비교해 겹치는 슬롯을 막았습니다.

```ts
// src/facility-reservations/facility-reservations.service.ts
const occupiedTime = reservation.map(r => r.reservationTime).flat();
const reservationTime = facilityReservation.reservationTime;
const hasCollision = reservationTime.some(time => occupiedTime.includes(time));
if (hasCollision) {
  throw new ConflictException('이미 예약된 시간입니다.');
}
```

`upsert`가 아닌 분리된 트랜잭션을 쓴 이유는, 한 번의 요청에서 여러 시간대를 잡는 경우가 있어서 실패 시 전체 요청을 롤백하기 위함입니다.

### 예상치 못한 이슈
- 구독 서버와 프론트의 시간 제한이 맞지 않아 첫 배포 직후에는 30초마다 연결이 끊겼습니다. CloudFront 앞단의 Idle Timeout을 늘리고, 클라이언트에서 `retryWait`를 지수 백오프로 바꿔 끊김을 줄였습니다.
- GraphQL 스키마가 커지면서 codegen 시간이 늘었는데, Turborepo 대신 pnpm `--filter`로 스키마 관련 패키지만 재생성하도록 했습니다. GPT한테는 `graphql-ws` 재연결 전략을 비교 설명해 달라고 부탁해 최종 파라미터를 결정했습니다.

## 결과와 회고
이제 예약 현황을 지켜보던 운영자가 새로고침을 반복하지 않아도 되고, 사용자는 웹과 모바일에서 동일한 실시간 피드를 봅니다. Prisma를 중심으로 검증 로직을 한 곳에 모아두니 REST 시절보다 버그 재현이 쉬워졌고, 로드 테스트에서도 1초 내 응답률이 20% 이상 개선됐습니다.

다음 목표는 예약 승인이 아닌 취소·변경 워크플로에도 같은 실시간성을 적용하는 것입니다. 여러분은 GraphQL 구독을 어디까지 활용하고 계신가요?

# Reference
- https://docs.nestjs.com/graphql/subscriptions
- https://the-guild.dev/graphql/ws
- https://www.prisma.io/docs/concepts/components/prisma-client/transactions

# 연결문서
- [[GitHub Actions와 Docker, Elastic Beanstalk로 통합 배포 자동화하기]]
- [[Winston과 CloudWatch로 구조화 로깅 파이프라인 다듬기]]
- [[pnpm 모노레포로 여러 제품을 한 팀처럼 묶은 이유]]
