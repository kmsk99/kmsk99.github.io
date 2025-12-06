---
tags:
  - Engineering
  - TechDeepDive
  - GraphQL
  - Prisma
  - NestJS
  - Caching
  - Backend
title: 역할 기반 승인 흐름 설계기 다단계 검증을 코드로 담다
created: '2025-02-14 10:35'
modified: '2025-02-14 10:35'
slug: 역할-기반-승인-흐름-설계기-다단계-검증을-코드로-담다
---

# Intro
제가 만든 서비스에는 신청자 → 담당 매니저 → 본부 관리자 순으로 진행되는 승인 프로세스가 있습니다. 이메일로 시트를 주고받던 시절에는 누가 승인했는지 추적하기가 정말 어려웠고, 권한이 없는 사람이 URL만 알면 민감한 데이터가 보이는 상황도 있었습니다. 그래서 역할 기반 접근 제어(RBAC)와 승인 흐름을 코드로 통합했습니다.

## 핵심 아이디어 요약
- NestJS의 커스텀 `@Role` 데코레이터와 `RoleGuard`로 GraphQL 리졸버에 필요한 권한을 선언했습니다.
- 승인 단계는 Prisma 트랜잭션과 상태 머신으로 모델링하고, 상태가 바뀔 때마다 알림을 발송했습니다.
- 역할별 접근 가능 리소스를 `AccessControlService`에 집약해 정책을 한 곳에서 관리했습니다.

## 준비와 선택
1. **도메인 역할 정의**  
   `Applicant`, `Manager`, `Admin` 세 그룹을 기준으로 접근 레벨을 나눴습니다.
2. **가드 체인**  
   JWT 인증 후에 `RoleGuard`가 동작하도록 `@UseGuards(GqlAuthGuard, RoleGuard)` 순서를 고정했습니다.
3. **정책 테이블화**  
   `AccessLevel`과 `MemberRole` 사이의 매핑을 코드로 명시해 팀별 정책을 눈으로 확인할 수 있게 했습니다.

## 구현 여정
### Step 1: RoleGuard 작성

```ts
// src/auth/role.guard.ts
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.get<AllowedRoles>('roles', context.getHandler());
    if (!roles) return true;

    const req = GqlExecutionContext.create(context).getContext().req;
    const user = req.user as User;
    if (!user) return false;

    return this.matchRoles(roles, user.userRole);
  }

  matchRoles(roles: AllowedRoles, userRole: UserRole) {
    if (roles.includes('Any')) return true;
    return roles.includes(userRole);
  }
}
```

GraphQL 컨텍스트에서 사용자 정보를 가져와 승인 리졸버마다 필요한 역할을 체크합니다.

### Step 2: 접근 정책 매핑

```ts
// src/access-control/access-control.service.ts
private memberRoleByAccessLevel: Record<AccessLevel, MemberRole[]> = {
  [AccessLevel.PRESIDENTONLY]: [MemberRole.PRESIDENT],
  [AccessLevel.ADMINONLY]: [MemberRole.ADMIN, MemberRole.PRESIDENT],
  [AccessLevel.MEMBER]: [
    MemberRole.PRESIDENT,
    MemberRole.ADMIN,
    MemberRole.MEMBER,
    MemberRole.GRADUATED,
  ],
};

getMemberRoleByAccessLevel(accessLevel: AccessLevel): MemberRole[] {
  return this.memberRoleByAccessLevel[accessLevel];
}
```

승인 대상자에게 알림을 보낼 때도 이 매핑을 활용해 역할별로 수신자를 필터링했습니다.

### Step 3: 승인 상태 전환
승인 서비스에서는 신청 → 검토 → 승인/거절 상태를 Prisma 트랜잭션으로 관리했습니다. 상태가 바뀔 때마다 `NotificationsService`를 호출해 다음 담당자에게 알림을 보냈습니다.

```ts
const { ok } = await this.notificationsService.createNotification({
  userId: approverId,
  type: 'CERTIFICATE_PENDING',
  variables: { name: applicantName },
});
```

알림을 보낼 때 `shouldSendPush`에서 사용자의 야간 수신 동의 여부나 관심 카테고리를 확인해, 불필요한 푸시를 줄였습니다.

### 예상치 못한 이슈
- 리졸버에 `@Role(['ADMIN'])`만 붙였더니 매니저가 본인 신청서를 수정할 수 없었습니다. `AuthorizedUserGuard`를 별도로 만들어 "본인 소유 리소스일 때는 예외" 규칙을 추가했습니다.
- 역할이 변경된 사용자가 캐시된 토큰으로 계속 접근하는 문제는 Redis 기반 세션 스토어에서 토큰을 무효화하는 방식으로 해결했습니다. GPT에게 NestJS에서 GraphQL guard와 interceptor 순서가 어떻게 동작하는지 확인해 보고 구조를 재정리했습니다.

## 결과와 회고
이제 승인 진행 상황이 GraphQL API 하나로 보이고, 누가 언제 어떤 결정을 내렸는지도 로그로 남습니다. 역할에 따른 화면 제어도 프론트에서 같은 정책을 재사용하면서 유지보수가 편해졌습니다. 다음엔 정책을 환경 설정이 아닌 DB로 옮겨 운영자가 직접 수정하게 만드는 것이 목표입니다. 여러분은 승인 흐름을 어떻게 모델링하고 계신가요?

# Reference
- https://docs.nestjs.com/guards
- https://graphql.org/learn/authorization/

# 연결문서
- [[AES-256과 Prisma Middleware로 개인정보 안전하게 돌리기]]
- [[NestJS GraphQL 예약 도메인에서 실시간성을 확보한 과정]]
- [[Firebase Admin SDK로 상태 기반 푸시 알림을 다듬은 후기]]
