---
tags:
  - Supabase
  - Auth
  - DI
  - Backend
  - Security
title: NICE DI 기반 중복 계정 탐지 API
created: 2025-10-09 14:06
modified: 2025-10-09 14:06
---

본인인증 DI가 같은 계정이 여러 개 생기는 문제를 겪었다. 사용자에게 "이미 인증한 계정이 있어요"라고 안내하고 싶었지만, RLS 때문에 클라이언트가 마음대로 프로필을 조회할 수 없었다. 서비스 롤 클라이언트를 이용해 중복 계정을 탐지하는 API를 만들었다.

## API 설계
- DI 값을 파라미터로 받아 동일한 프로필을 모두 조회한다.
- 세션 사용자가 있으면 본인을 제외한 계정만 반환한다.
- Supabase Auth의 사용자 정보까지 결합해 어떤 계정이 활성 상태인지 표시한다.

프로필과 Auth 정보를 함께 조회해야 해서 서비스 롤 클라이언트를 사용했다. 세션에서 user ID를 읽어 같은 DI라도 현재 로그인한 계정은 제외했다. DI 파라미터가 없으면 현재 사용자 프로필에서 DI를 가져와 조회한다.

## DI 결정
쿼리에 `di`가 없으면 세션 사용자 프로필을 조회해 DI를 찾는다. 둘 다 없으면 400으로 종료한다.

## 프로필 조회
프로필 테이블에서 동일한 DI를 가진 항목을 모두 가져온다. 필요한 필드는 이름, 전화번호, 인증 여부 등이다.

## Auth 사용자 매칭
각 프로필 ID로 `admin.auth.admin.getUserById`를 호출해 활성/비활성 상태를 확인한다. 조회 실패 시 try/catch로 null을 반환해 흐름을 유지한다. 현재 사용자와 동일하면 `otherUsers`에서 제외하고, `isDuplicated`는 세션 사용자 기준으로 `otherUsers.length > 0` 또는 세션 없을 때 `users.length > 1`로 판단한다.

```ts
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const diParam = searchParams.get('di')?.trim() || null;
  const admin = createAdminClient();
  let di = diParam;
  let currentUserId: string | null = null;

  // 세션 사용자 확인
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) currentUserId = user.id;

  // di 파라미터 없으면 현재 사용자 프로필에서 조회
  if (!di && currentUserId) {
    const { data: me } = await admin.from('profile').select('id, di').eq('id', currentUserId).single();
    di = me?.di ?? null;
  }
  if (!di) return NextResponse.json({ success: false, error: 'di가 제공되지 않았습니다.' }, { status: 400 });

  const { data: profiles } = await admin
    .from('profile')
    .select('id, di, full_name, phone_number, is_verified, is_complete, created_at, updated_at')
    .eq('di', di);

  const usersRaw = await Promise.all(
    (profiles || []).map(async p => {
      try {
        const { data } = await admin.auth.admin.getUserById(p.id);
        return data?.user ?? null;
      } catch { return null; }
    }),
  );
  const users = usersRaw.filter(Boolean);
  const otherUsers = currentUserId ? users.filter(u => u && u.id !== currentUserId) : users;
  const isDuplicated = currentUserId ? otherUsers.length > 0 : users.length > 1;

  return NextResponse.json({ success: true, di, profiles, users, otherUsers, isDuplicated });
}
```

## 겪은 이슈와 해결
- 권한 문제: 서비스 롤이 아니면 프로필과 Auth를 동시에 볼 수 없어, 관리자 클라이언트 사용을 강제했다.
- Auth 호출 실패: 일부 계정은 삭제되어 있어 조회가 실패했다. try/catch로 예외를 무시하고 null을 반환해 흐름을 유지했다.
- 응답 형식: 프런트에서 활용하기 쉽도록 `isDuplicated` 플래그와 `otherUsers` 배열을 포함해 반환했다.

이제는 DI가 중복된 사용자가 있으면 UI에서 즉시 알려줄 수 있다. 계정 복구나 고객센터 응대도 훨씬 빨라졌다. 다음에는 중복 계정을 자동으로 잠그는 정책을 검토해볼 생각이다.

# Reference
- https://supabase.com/docs/guides/auth/row-level-security

# 연결문서
- [[Vercel Cron으로 AI 자동화 트리거 구현]]
- [[React Native에서 Next.js API를 인증된 상태로 호출하기]]
