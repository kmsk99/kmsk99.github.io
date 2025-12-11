---
tags:
  - Supabase
  - Auth
  - DI
  - Backend
  - Security
title: 본인인증 DI 중복 계정을 탐지하는 API를 만든 이유
created: 2025-10-09 14:06
modified: 2025-10-09 14:06
---

# Intro
저는 본인인증 DI가 같은 계정이 여러 개 생기는 문제를 겪었습니다. 사용자에게 “이미 인증한 계정이 있어요”라고 안내하고 싶었지만, RLS 때문에 클라이언트가 마음대로 프로필을 조회할 수 없었죠. 그래서 서비스 롤 클라이언트를 이용해 중복 계정을 탐지하는 API를 만들었습니다.

## 핵심 아이디어 요약
- DI 값을 파라미터로 받아 동일한 프로필을 모두 조회합니다.
- 세션 사용자가 있으면 본인을 제외한 계정만 반환합니다.
- Supabase Auth의 사용자 정보까지 결합해 어떤 계정이 활성 상태인지 표시합니다.

## 준비와 선택
1. **서비스 롤**: 프로필과 Auth 정보를 함께 조회해야 해서 서비스 롤 클라이언트를 사용했습니다.
2. **현재 사용자 구분**: 세션에서 user ID를 읽어 같은 DI라도 현재 로그인한 계정은 제외했습니다.
3. **fallback**: DI 파라미터가 없으면 현재 사용자 프로필에서 DI를 가져와 조회했습니다.

## 구현 여정
### Step 1: DI 결정
쿼리에 `di`가 없으면 세션 사용자 프로필을 조회해 DI를 찾습니다. 둘 다 없으면 400으로 종료합니다.

### Step 2: 프로필 조회
프로필 테이블에서 동일한 DI를 가진 항목을 모두 가져옵니다. 필요한 필드는 이름, 전화번호, 인증 여부 등입니다.

### Step 3: Auth 사용자 매칭
각 프로필 ID로 `admin.auth.admin.getUserById`를 호출해 활성/비활성 상태를 확인합니다. 현재 사용자와 동일하면 otherUsers에서 제외합니다.

```ts
import { createAdminClient } from './supabaseAdmin';

const adminClient = createAdminClient();

const { data: profiles } = await adminClient
  .from('profile')
  .select('id, di, full_name, phone_number, is_verified, is_complete')
  .eq('di', di);

const users = await Promise.all(
  (profiles ?? []).map(async profile => {
    const { data } = await adminClient.auth.admin.getUserById(profile.id);
    return data?.user ?? null;
  }),
);

const otherUsers = users.filter(
  user => user && (!currentUserId || user.id !== currentUserId),
);
return {
  success: true,
  di,
  profiles,
  users,
  otherUsers,
  isDuplicated: otherUsers.length > 0,
};
```

## 겪은 이슈와 해결 과정
- **권한 문제**: 서비스 롤이 아니면 프로필과 Auth를 동시에 볼 수 없어, 관리자 클라이언트 사용을 강제했습니다.
- **Auth 호출 실패**: 일부 계정은 삭제되어 있어 조회가 실패했습니다. try/catch로 예외를 무시하고 null을 반환해 흐름을 유지했습니다.
- **응답 형식**: 프런트에서 활용하기 쉽도록 `isDuplicated` 플래그와 `otherUsers` 배열을 포함해 반환했습니다.

## 결과와 회고
이제는 DI가 중복된 사용자가 있으면 UI에서 즉시 알려줄 수 있습니다. 계정 복구나 고객센터 응대도 훨씬 빨라졌죠. 다음에는 중복 계정을 자동으로 잠그는 정책을 검토해볼 생각입니다.

여러분은 본인인증 식별자를 어떻게 관리하고 계신가요? 다른 사례가 있다면 댓글로 공유해주세요.

# Reference
- https://supabase.com/docs/guides/auth/row-level-security

# 연결문서
- [[AI 자동화를 cron 엔드포인트로 안전하게 트리거한 과정]]
- [[Bearer 토큰을 Supabase 쿠키로 바꿔주는 Next.js 서버 클라이언트]]
- [[Supabase RPC로 포인트 적립·차감을 안전하게 처리한 방법]]
