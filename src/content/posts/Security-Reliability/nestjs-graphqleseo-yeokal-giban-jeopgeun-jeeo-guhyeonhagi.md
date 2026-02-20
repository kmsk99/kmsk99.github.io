---
tags:
  - NestJS
  - GraphQL
  - RBAC
  - Prisma
  - Auth
  - Security
title: NestJS GraphQL에서 역할 기반 접근 제어 구현하기
created: '2024-02-14 10:35'
modified: 2025-02-20T00:00:00.000Z
---

이 프로젝트는 대학 동아리 플랫폼이다. 동아리별로 게시글, 공지, 모집 공고, 활동 등 다양한 리소스가 있고, 각 리소스마다 공개 범위가 다르다. 누구나 볼 수 있는 공지도 있고, 같은 대학 학생만 볼 수 있는 글, 동아리 회원만 볼 수 있는 글, 회장만 수정할 수 있는 공지도 있다. 이걸 코드로 어떻게 구현했는지 정리했다.

## 전체 구조

접근 제어는 두 단계로 나뉜다.

1. 리졸버 단계: JWT 인증 + 전역 역할(UserRole) 체크
2. 서비스 단계: 리소스별 접근 레벨(AccessLevel)과 동아리 내 역할(MemberRole) 체크

리졸버 가드는 "이 사용자가 로그인했는지", "시스템 관리자(ADMIN)인지" 같은 전역 조건만 본다. 반면 Post, Notice, Activity 같은 개별 리소스는 동아리 멤버십과 해당 리소스의 `accessLevel`에 따라 접근이 달라진다. 그래서 `AccessControlService`가 서비스 레이어에서 별도로 권한을 검사한다.

## Prisma Enum 정의

역할과 접근 레벨은 Prisma 스키마에 enum으로 정의돼 있다.

```prisma
enum UserRole {
  ADMIN   // 시스템 관리자
  USER    // 일반 사용자
}

enum MemberRole {
  PRESIDENT   // 회장
  ADMIN       // 동아리 관리자
  MEMBER      // 회원
  GRADUATED   // 졸업생
  SUSPENDED   // 정지
  PENDING     // 신청중
  WITHDRAWAL  // 탈퇴
  INVITED     // 초대중
  EXPELLED    // 제명
}

enum AccessLevel {
  PUBLIC           // 공개
  UNIVERSITYONLY   // 같은 대학만
  MEMBERSONLY      // 회원만
  ACTIVEMEMBERSONLY // 활동회원만
  ADMINONLY        // 관리자만
  PRESIDENTONLY    // 회장만
  PRIVATE          // 비공개
}

enum ManagerStatus {
  PENDING   // 대기중
  ACTIVE    // 활동중
  PRESIDENT // 회장
  RETIRED   // 퇴임
}
```

`UserRole`은 전역 사용자 역할이고, `MemberRole`은 동아리별 멤버 역할이다. `AccessLevel`은 리소스(게시글, 공지 등)에 설정되는 공개 범위다.

## JWT Strategy

인증은 Passport JWT 전략으로 처리한다. `jwt.strategy.ts`에서 Bearer 토큰을 추출하고, `AuthService.validateUser()`로 사용자 존재 여부를 확인한다.

```ts
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly authService: AuthService,
    readonly configService: ConfigService,
  ) {
    const jwtSecret = configService.get('JWT_ACCESS_SECRET');
    if (!jwtSecret) {
      throw new Error('JWT_ACCESS_SECRET 환경 변수가 설정되지 않았습니다.');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwtSecret,
    });
  }

  async validate(payload: JwtDto): Promise<User> {
    const { ok, user } = await this.authService.validateUser(payload.userId);
    if (!ok || !user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
```

검증된 사용자는 `request.user`에 담긴다.

## 가드 체인

### 기본 가드: GqlOptionalAuthGuard

`app.module.ts`에서 `APP_GUARD`로 `GqlOptionalAuthGuard`를 등록했다. 모든 GraphQL 요청에 기본 적용된다.

```ts
{
  provide: APP_GUARD,
  useClass: GqlOptionalAuthGuard,
}
```

이 가드는 JWT가 있으면 사용자 정보를 넣어주고, 없거나 유효하지 않으면 `null`을 넣는다. 요청을 막지 않는다. 그래서 공개 쿼리(동아리 목록, 공개 게시글 등)는 로그인 없이 호출할 수 있다.

### 인증 필수: GqlAuthGuard

로그인이 필요한 리졸버에는 `GqlAuthGuard`를 쓴다. `AuthGuard('jwt')`를 상속하고, GraphQL 컨텍스트에서 `req`를 꺼내는 방식만 오버라이드한다.

```ts
@Injectable()
export class GqlAuthGuard extends AuthGuard('jwt') {
  getRequest(context: ExecutionContext) {
    const ctx = GqlExecutionContext.create(context);
    const { req } = ctx.getContext();

    if (!req) {
      return { headers: {}, connection: { remoteAddress: 'unknown' }, ip: 'unknown' };
    }

    // WebSocket 연결에서 전달된 인증 토큰이 있는 경우 헤더에 설정
    if (req.connectionParams && req.connectionParams.authorization) {
      req.headers.authorization = req.connectionParams.authorization;
    }

    return req;
  }
}
```

WebSocket 구독 시 `connectionParams.authorization`에 토큰을 넘기는 경우도 처리한다.

### 역할 체크: RoleGuard

시스템 관리자 전용 리졸버에는 `RoleGuard`를 함께 쓴다. `@Role` 데코레이터로 허용 역할을 지정한다.

```ts
export type AllowedRoles = keyof typeof UserRole | 'Any';
export const Role = (roles: AllowedRoles[]) => SetMetadata('roles', roles);
```

```ts
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

`roles`가 없으면 통과하고, `'Any'`가 있으면 인증된 사용자 전부 통과한다. 그 외에는 `user.userRole`이 목록에 있을 때만 통과한다.

### 사용 패턴

관리자 전용 쿼리/뮤테이션은 다음처럼 쓴다.

```ts
@Role(['ADMIN'])
@UseGuards(GqlAuthGuard, RoleGuard)
@Query(() => UsersOutput)
async getUsersForAdmin(...) { ... }
```

순서는 `@Role` → `@UseGuards(GqlAuthGuard, RoleGuard)`다. `GqlAuthGuard`가 먼저 인증하고, `RoleGuard`가 역할을 검사한다.

일반 인증만 필요한 경우에는 `GqlAuthGuard`만 쓴다.

```ts
@UseGuards(GqlAuthGuard)
@Mutation(() => UserOutput)
async updateUser(@UserEntity() user: User, ...) { ... }
```

## AccessControlService

리소스별 접근 권한은 `AccessControlService`에서 처리한다. Post, Activity, Notice, RecruitmentNotice, ResourceLibrary, Comment, Submission, Reply 등에 대한 `check*Permission` 메서드가 있다.

### AccessLevel ↔ MemberRole 매핑

`memberRoleByAccessLevel`은 "이 AccessLevel의 리소스에 접근할 수 있는 MemberRole 목록"을 정의한다.

```ts
private memberRoleByAccessLevel: Record<AccessLevel, MemberRole[]> = {
  [AccessLevel.PRESIDENTONLY]: [MemberRole.PRESIDENT],
  [AccessLevel.ADMINONLY]: [MemberRole.ADMIN, MemberRole.PRESIDENT],
  [AccessLevel.ACTIVEMEMBERSONLY]: [
    MemberRole.ADMIN,
    MemberRole.PRESIDENT,
    MemberRole.MEMBER,
  ],
  [AccessLevel.MEMBERSONLY]: [
    MemberRole.ADMIN,
    MemberRole.PRESIDENT,
    MemberRole.MEMBER,
    MemberRole.GRADUATED,
  ],
  [AccessLevel.UNIVERSITYONLY]: [
    MemberRole.ADMIN,
    MemberRole.PRESIDENT,
    MemberRole.MEMBER,
    MemberRole.GRADUATED,
  ],
  [AccessLevel.PRIVATE]: [],
  [AccessLevel.PUBLIC]: [],
};
```

`roleAccessLevel`은 반대로 "이 MemberRole이 접근할 수 있는 AccessLevel 목록"을 정의한다.

```ts
private roleAccessLevel: Record<MemberRole, AccessLevel[]> = {
  [MemberRole.PRESIDENT]: [
    AccessLevel.MEMBERSONLY,
    AccessLevel.ACTIVEMEMBERSONLY,
    AccessLevel.ADMINONLY,
    AccessLevel.PRESIDENTONLY,
    AccessLevel.UNIVERSITYONLY,
  ],
  [MemberRole.ADMIN]: [
    AccessLevel.MEMBERSONLY,
    AccessLevel.ACTIVEMEMBERSONLY,
    AccessLevel.ADMINONLY,
    AccessLevel.UNIVERSITYONLY,
  ],
  [MemberRole.MEMBER]: [
    AccessLevel.MEMBERSONLY,
    AccessLevel.ACTIVEMEMBERSONLY,
    AccessLevel.UNIVERSITYONLY,
  ],
  [MemberRole.GRADUATED]: [AccessLevel.MEMBERSONLY, AccessLevel.UNIVERSITYONLY],
  // PENDING, INVITED, WITHDRAWAL, SUSPENDED, EXPELLED: []
};
```

### hasClubPermission, hasUniversityPermission

`hasClubPermission`은 특정 동아리에서 주어진 `AccessLevel`에 접근할 수 있는지 확인한다. `hasUniversityPermission`은 같은 대학 소속 여부를 확인한다.

```ts
async hasClubPermission({
  userId,
  clubId,
  accessLevel,
}: {
  userId?: string | null;
  clubId?: string | null;
  accessLevel: AccessLevel;
}): Promise<boolean> {
  if (accessLevel === AccessLevel.PUBLIC) return true;
  if (!userId) return false;

  const user = await this.prisma.user.findFirstOrThrow({ where: { id: userId } });
  if (user.userRole === 'ADMIN') return true;  // 시스템 관리자는 bypass

  if (!clubId) return false;
  if (accessLevel === AccessLevel.PRIVATE) return false;

  if (accessLevel === AccessLevel.UNIVERSITYONLY) {
    // 같은 대학 소속인지 확인
    const club = await this.prisma.club.findUniqueOrThrow({ where: { id: clubId } });
    await this.prisma.universityMember.findUniqueOrThrow({
      where: {
        userId_universityId: { userId, universityId: club.universityId },
        verified: true,
      },
    });
    return true;
  }

  const clubMember = await this.getClubMember(userId, clubId);
  return this.accessLevelRequiredRole[accessLevel].includes(clubMember.memberRole);
}
```

시스템 관리자(`UserRole.ADMIN`)는 대부분의 검사를 통과한다.

### checkPostPermission, checkNoticePermission 등

리소스별로 `check*Permission` 메서드가 있다. 예를 들어 `checkPostPermission`은 `action`(create, get, update, delete, comment)에 따라 권한을 검사한다.

```ts
async checkPostPermission({
  userId,
  clubId,
  communityId,
  postId,
  action,
}: {
  userId?: string | null;
  clubId?: string | null;
  communityId?: string | null;
  postId?: string;
  action: PostActionType;
}): Promise<boolean> {
  if (action === 'create') {
    if (clubId) {
      return this.hasClubPermission({
        userId,
        clubId,
        accessLevel: AccessLevel.MEMBERSONLY,
      });
    } else if (communityId) {
      return this.hasUniversityPermission({ userId, universityId: communityId });
    }
    // ...
  }
  // get, update, delete, comment에 따라 post의 accessLevel과 사용자 역할 비교
}
```

서비스 레이어에서 이 메서드를 호출해 권한을 확인한다.

```ts
const checkPostPermission = await this.accessControlService.checkPostPermission({
  userId: user.id,
  postId: data.id,
  action: 'update',
});

if (!checkPostPermission) {
  return { ok: false, error: getErrorMessage('Post', 'UpdatePermission') };
}
```

### ResolveField에서 canUpdate, canDelete

프론트에서 버튼 표시 여부를 결정할 때 쓰는 `canUpdate`, `canDelete` 같은 필드는 리졸버의 `@ResolveField`에서 `checkPostPermission`을 호출한다.

```ts
@ResolveField('canUpdate', () => Boolean)
async canUpdate(
  @UserEntity() user: User | null,
  @Parent() post: Post,
): Promise<boolean> {
  return this.accessControlService.checkPostPermission({
    userId: user?.id,
    postId: post.id,
    clubId: post.clubId,
    action: 'update',
  });
}
```

## 정리

1. 기본 가드: `GqlOptionalAuthGuard`로 공개/비공개 모두 처리 가능
2. 인증 필수: `GqlAuthGuard`로 JWT 검증
3. 역할 제한: `RoleGuard` + `@Role(['ADMIN'])`으로 시스템 관리자 전용 API 보호
4. 리소스별 권한: `AccessControlService.check*Permission()`으로 동아리·대학·멤버 역할 기반 접근 제어
5. 시스템 관리자: `UserRole.ADMIN`은 대부분의 `AccessControlService` 검사를 bypass

가드는 리졸버 단위로, `AccessControlService`는 서비스 단위로 동작한다. 리소스가 속한 동아리와 사용자의 멤버 역할을 함께 봐야 하기 때문에, 세밀한 권한은 서비스 레이어에서 처리하는 구조가 맞다.

# Reference
- https://docs.nestjs.com/guards
- https://docs.nestjs.com/fundamentals/execution-context

# 연결문서
- [Nestjs + Prisma 백엔드에서 고객정보 양방향 암호화하기](/post/nestjs-prisma-baegendeueseo-gogaekjeongbo-yangbanghyang-amhohwahagi)
- [NestJS GraphQL Subscription으로 실시간 예약 구현](/post/nestjs-graphql-subscriptioneuro-silsigan-yeyak-guhyeon)
- [Firebase Admin SDK 푸시 알림 필터링](/post/firebase-admin-sdk-pusi-allim-pilteoring)
