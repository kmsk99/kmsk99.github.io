---
tags:
  - Supabase
  - Rewards
  - Stamps
  - Automation
  - Backend
title: 스탬프 적립과 자동 리워드 생성 구현
created: '2025-05-29'
modified: '2025-05-30'
---

# 문제

친구 초대와 학력 인증 등 여러 이벤트에 스탬프를 주다 보니, "스탬프가 몇 개 쌓였는지"를 일일이 계산해 리워드를 지급하는 일이 번거로웠다. 스탬프 적립과 리워드 생성 로직을 한 번에 처리하는 파이프라인이 필요했다.

# 설계

- 스탬프를 지급할 때마다 현재 개수를 세고, 5·10·15개일 때 자동 리워드를 생성한다.
- 이미 스탬프나 리워드가 존재하면 중복 지급을 막고 친절한 메시지를 돌려준다.
- 초대/학력 인증처럼 이벤트별로 헬퍼 함수를 분리해 의도를 드러나게 했다.

# 구현

### 서비스 롤 사용
RLS가 걸린 테이블이라 서비스 롤 키로만 접근 가능한 서버 클라이언트를 만들었다. `addUserStamp` 하나로 실제 insert를 처리하고, 소스 타입만 넘기면 되도록 했다. 리워드 정책은 `REWARD_STAMP_COUNTS` 배열에 [5, 10, 15]를 정의하고, 해당 개수에 정확히 도달했을 때만 리워드를 생성한다.

### 스탬프 지급 함수
사용자 ID와 source type(학력 인증, 친구 초대 등)을 받아 스탬프를 지급한다. 성공하면 리워드 생성 여부를 함께 반환한다.

```ts
// src/shared/supabase/servers/stamp.server.ts (reference/schoolmeets)
const REWARD_STAMP_COUNTS = [5, 10, 15];

const addUserStamp = async (
  userId: string,
  sourceType: StampSourceType,
  inviteHistoryId?: string | null,
  schoolRecordId?: string | null,
): Promise<StampResult> => {
  const supabase = createAdminClient();

  // 중복 스탬프 확인
  let query = supabase
    .from('user_stamp')
    .select('id')
    .eq('user_id', userId)
    .eq('source_type', sourceType);
  if (inviteHistoryId) query = query.eq('invite_history_id', inviteHistoryId);
  else query = query.is('invite_history_id', null);
  if (schoolRecordId) query = query.eq('school_record_id', schoolRecordId);
  else query = query.is('school_record_id', null);

  const { data: existingStamp } = await query.single();
  if (existingStamp) {
    return { success: false, message: '이미 해당 스탬프를 획득하셨습니다.' };
  }

  const { data: newStamp, error: insertError } = await supabase
    .from('user_stamp')
    .insert({
      user_id: userId,
      source_type: sourceType,
      invite_history_id: inviteHistoryId,
      school_record_id: schoolRecordId,
    })
    .select('id')
    .single();

  if (insertError) {
    return { success: false, message: '스탬프 지급 중 오류가 발생했습니다.' };
  }

  const rewardResult = await checkAndCreateReward(userId);
  return {
    success: true,
    message: `${sourceType} 스탬프가 지급되었습니다.`,
    stampId: newStamp.id,
    rewardCreated: rewardResult.created,
    rewardMessage: rewardResult.message,
  };
};
```

### 자동 리워드 생성
현재 스탬프 개수를 조회해 5·10·15개에 도달하면 리워드 테이블에 레코드를 추가한다. 이미 리워드가 있으면 생성하지 않고 메시지만 반환한다.

```ts
const checkAndCreateReward = async (userId: string) => {
  const { count: currentStampCount } = await supabase
    .from('user_stamp')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  const stampCount = currentStampCount || 0;
  if (!REWARD_STAMP_COUNTS.includes(stampCount)) {
    return { created: false, message: '리워드 생성 대상이 아닙니다.' };
  }

  const { data: existingReward } = await supabase
    .from('user_reward')
    .select('id')
    .eq('user_id', userId)
    .eq('stamp_count', stampCount)
    .single();

  if (existingReward) {
    return { created: false, message: '이미 해당 스탬프 개수에 대한 리워드가 존재합니다.' };
  }

  await supabase.from('user_reward').insert({
    user_id: userId,
    stamp_count: stampCount,
    is_rewarded: false,
    is_read: false,
  });
  return { created: true, message: `${stampCount}개 스탬프 리워드가 생성되었습니다.` };
};
```

### 이벤트별 헬퍼
학력 인증이 완료되면 `addUserStamp`를 호출하고, 이미 스탬프가 있으면 메시지를 반환한다. 초대 코드가 사용되면 초대한 사람과 초대받은 사람에게 각각 맞는 스탬프를 지급한다.

# 이슈와 해결

- 중복 지급: 동일한 이벤트가 다시 호출되면 이미 지급된 스탬프를 찾아 실패 메시지를 반환한다. 호출부에서 이 메시지를 그대로 사용자에게 보여 중복을 막았다.
- 리워드 중복: 리워드가 생성된 후 다시 스탬프 개수가 변해도 `user_reward`를 조회해 중복 insert를 막는다.
- 에러 핸들링: Supabase 오류가 발생하면 콘솔에 상세 로그를 남기고, 호출자에게는 "스탬프 지급 중 오류가 발생했다" 같은 일반 메시지를 보냈다.

# 결과

스탬프 개수를 손으로 세지 않아도 리워드가 자동으로 들어간다. 초대 코드나 학력 인증 API에서도 같은 함수를 재사용하니 로직이 흩어지지 않고, 새로운 스탬프 정책을 추가할 때도 `REWARD_STAMP_COUNTS`만 바꾸면 된다. 다음에는 리워드가 생성되었을 때 푸시 알림을 보내 사용자에게 즉시 알려주고 싶다.

# Reference
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/functions
- https://supabase.com/docs/guides/auth/row-level-security

# 연결문서
- [React Native 파일 업로드 유틸 구현](/post/react-native-pail-eomnodeu-yutil-guhyeon)
- [파일 암호화 파이프라인 구현](/post/pail-amhohwa-paipeurain-guhyeon)
- [Vercel Cron으로 AI 자동화 트리거 구현](/post/vercel-croneuro-ai-jadonghwa-teurigeo-guhyeon)
