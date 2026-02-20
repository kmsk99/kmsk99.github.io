---
tags:
  - Supabase
  - Invites
  - Rewards
  - Backend
  - Automation
title: 초대 코드 검증과 스탬프 지급 통합
created: '2025-03-27'
modified: '2025-04-29'
---

# 문제

초대 코드 이벤트를 운영하면서 "누가 언제 스탬프를 받았지?"를 추적하기 어려웠다. 초대받은 사람과 초대한 사람 모두에게 보상을 주려면 흐름을 하나로 묶어야 했다. 초대 코드 검증, 히스토리 저장, 스탬프 지급을 한 API에서 처리하도록 만들었다.

# 설계

- 초대 코드를 사용하면 히스토리 테이블에 기록하고, 초대받은 사용자에게 즉시 스탬프를 지급한다.
- 초대받은 사용자가 이미 학교 인증을 마쳤다면 초대한 사람에게도 스탬프를 준다.
- 모든 로직은 서비스 롤 클라이언트에서 실행해 RLS를 우회한다.

# 구현

### 코드 검증
초대 코드가 존재하는지, 자신의 코드를 사용하지 않았는지 확인했다.

### 중복 사용 방지
이미 초대받은 기록이 있으면 에러를 반환해 중복 등록을 차단했다.

### 시간 제한
가입 후 72시간이 지나면 초대 코드를 쓸 수 없도록 `created_at` 비교를 추가했다.

### 초대 코드 사용
세션 사용자를 확인하고, 초대 코드가 유효한지 검사한 뒤 히스토리 테이블에 `inviter_id`, `invitee_id`로 레코드를 만든다.

### 스탬프 지급
새로 생성된 히스토리 ID로 초대받은 사용자에게 스탬프를 지급한다. 이미 지급된 스탬프가 있으면 실패 메시지를 반환한다.

```ts
// src/shared/supabase/servers/stamp.server.ts (reference/schoolmeets)
export const addInviteReceivedStamp = async (
  inviteeId: string,
  inviteHistoryId: string,
): Promise<StampResult> => {
  return await addUserStamp(inviteeId, '친구 초대 받음', inviteHistoryId, null);
};
```

### 학교 인증 연동
초대받은 사용자가 이미 학교 인증을 마친 상태라면 초대한 사용자에게 "친구 초대 완료" 스탬프를 주고 히스토리에 `verified` 플래그를 업데이트한다.

```ts
// 초대 코드 검증 → 히스토리 저장 → 스탬프 지급 → 학교 인증 시 초대자 스탬프
const { data: inviteCode } = await adminClient
  .from('invite_code')
  .select('user_id, code')
  .eq('code', code)
  .single();

if (inviteCode.user_id === user.id) {
  return NextResponse.json(
    { error: '자신의 초대 코드는 사용할 수 없습니다.' },
    { status: 403 },
  );
}

// 72시간 이내 가입 여부 확인
if (hoursSinceRegistration > 72) {
  return NextResponse.json(
    { error: '초대 코드는 가입 후 72시간 이내에만 사용 가능합니다.' },
    { status: 400 },
  );
}

const { data: newInviteHistory } = await adminClient
  .from('invite_history')
  .insert({ inviter_id: inviteCode.user_id, invitee_id: user.id })
  .select('id')
  .single();

const inviteReceivedStampResult = await addInviteReceivedStamp(
  user.id,
  newInviteHistory.id,
);

// 이미 학교 인증 완료된 사용자라면 초대자에게도 스탬프 지급
if (verifiedSchoolRecord) {
  inviteProcessResult = await processInviteEducationVerification(
    newInviteHistory.id,
  );
}
```

# 이슈와 해결

- 자기 코드 사용: 사용자 ID와 초대 코드의 작성자가 같으면 403을 반환해 자기 자신을 초대할 수 없도록 했다.
- 동시 요청: 두 번 연속 호출될 수 있어 히스토리 insert 시 unique constraint를 활용했다.
- 스탬프 중복: 스탬프 지급 함수가 내부적으로 중복을 확인해 메시지를 반환하므로, 호출부에서는 그대로 사용자에게 안내했다.

# 결과

초대 코드가 사용되면 스탬프와 히스토리가 동시에 기록돼 운영자가 엑셀로 체크할 일이 없어졌다. 학교 인증까지 이어지면 자동으로 초대한 사람에게 보상도 지급되니 이벤트 관리가 훨씬 수월하다. 다음에는 초대 코드 사용 시 알림을 보내 초대자가 바로 변화를 느낄 수 있게 해볼 예정이다.

# Reference
- https://supabase.com/docs/guides/auth/row-level-security
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/functions

# 연결문서
- [Nestjs + Prisma 백엔드에서 고객정보 양방향 암호화하기](/post/nestjs-prisma-baegendeueseo-gogaekjeongbo-yangbanghyang-amhohwahagi)
- [Vercel Cron으로 AI 자동화 트리거 구현](/post/vercel-croneuro-ai-jadonghwa-teurigeo-guhyeon)
- [파일 암호화 파이프라인 구현](/post/pail-amhohwa-paipeurain-guhyeon)
