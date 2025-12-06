---
tags:
  - Engineering
  - TechDeepDive
  - Supabase
  - PushNotification
  - Automation
  - CICD
  - DevOps
  - Backend
title: 스탬프 누적과 리워드를 자동화한 워크플로우
created: '2025-10-09 14:06'
modified: '2025-10-09 14:06'
---

# Intro
저는 친구 초대와 학력 인증 등 여러 이벤트에 스탬프를 주다 보니, “스탬프가 몇 개 쌓였는지”를 일일이 계산해 리워드를 지급하는 일이 번거로웠습니다. 그래서 스탬프 적립과 리워드 생성 로직을 한 번에 처리하는 파이프라인을 만들었습니다.

## 핵심 아이디어 요약
- 스탬프를 지급할 때마다 현재 개수를 세고, 5·10·15개일 때 자동 리워드를 생성합니다.
- 이미 스탬프나 리워드가 존재하면 중복 지급을 막고 친절한 메시지를 돌려줍니다.
- 초대/학력 인증처럼 이벤트별로 헬퍼 함수를 분리해 의도를 드러나게 했습니다.

## 준비와 선택
1. **서비스 롤 사용**: RLS가 걸린 테이블이라 서비스 롤 키로만 접근 가능한 서버 클라이언트를 만들었습니다.
2. **공통 함수 추출**: `addUserStamp` 하나로 실제 insert를 처리하고, 소스 타입만 넘기면 되도록 했습니다.
3. **리워드 정책**: `REWARD_STAMP_COUNTS` 배열에 [5, 10, 15]를 정의하고, 해당 개수에 정확히 도달했을 때만 리워드를 생성하도록 했습니다.

## 구현 여정
### Step 1: 스탬프 지급 함수
사용자 ID와 source type(학력 인증, 친구 초대 등)을 받아 스탬프를 지급합니다. 성공하면 리워드 생성 여부를 함께 반환합니다.

```ts
import { createAdminClient } from './supabaseAdmin';

const REWARD_STAMP_COUNTS = [5, 10, 15];

export const addUserStamp = async (
  userId: string,
  sourceType: StampSourceType,
  inviteHistoryId?: string | null,
  schoolRecordId?: string | null,
) => {
  const supabase = createAdminClient();
  const { data: newStamp, error } = await supabase
    .from('user_stamp')
    .insert({
      user_id: userId,
      source_type: sourceType,
      invite_history_id: inviteHistoryId,
      school_record_id: schoolRecordId,
    })
    .select()
    .single();

  if (error) return { success: false, message: '스탬프 지급 중 오류가 발생했습니다.' };

  // 새 스탬프 개수가 5·10·15개라면 checkAndCreateReward가 자동으로 리워드를 추가합니다.
  const rewardResult = await checkAndCreateReward(userId);
  return {
    success: true,
    stampId: newStamp.id,
    rewardCreated: rewardResult.created,
    rewardMessage: rewardResult.message,
  };
};
```

### Step 2: 자동 리워드 생성
현재 스탬프 개수를 조회해 5·10·15개에 도달하면 리워드 테이블에 레코드를 추가합니다. 이미 리워드가 있다면 생성하지 않고 메시지만 반환합니다.

### Step 3: 이벤트별 헬퍼
- 학력 인증이 완료되면 `addUserStamp`를 호출하고, 이미 스탬프가 있다면 메시지를 반환합니다.
- 초대 코드가 사용되면 초대한 사람과 초대받은 사람에게 각각 맞는 스탬프를 지급합니다.

## 겪은 이슈와 해결 과정
- **중복 지급**: 동일한 이벤트가 다시 호출되면 이미 지급된 스탬프를 찾아 실패 메시지를 반환합니다. 호출부에서 이 메시지를 그대로 사용자에게 보여 중복을 막았습니다.
- **리워드 중복**: 리워드가 생성된 후 다시 스탬프 개수가 변해도 `user_reward`를 조회해 중복 insert를 막습니다.
- **에러 핸들링**: Supabase 오류가 발생하면 콘솔에 상세 로그를 남기고, 호출자에게는 “스탬프 지급 중 오류가 발생했습니다” 같은 일반 메시지를 보냈습니다.

## 결과와 회고
이제는 스탬프 개수를 손으로 세지 않아도 리워드가 자동으로 들어갑니다. 초대 코드나 학력 인증 API에서도 같은 함수를 재사용하니 로직이 흩어지지 않고, 새로운 스탬프 정책을 추가할 때도 `REWARD_STAMP_COUNTS`만 바꾸면 됩니다. 다음에는 리워드가 생성되었을 때 푸시 알림을 보내 사용자에게 즉시 알려주고 싶습니다.

여러분은 리워드 시스템을 어떻게 자동화하고 계신가요? 다른 아이디어가 있다면 댓글로 알려주세요. 서로의 경험을 공유하면 더 재미있는 보상 구조가 탄생할 것 같습니다.

# Reference
- https://supabase.com/docs/guides/functions
- https://supabase.com/docs/guides/auth/row-level-security

# 연결문서
- [[React Native 파일 업로드 파이프라인을 정리한 기록]]
- [[암호화 파일을 복호화해 안전하게 다운로드시키는 방법]]
- [[AI 자동화를 cron 엔드포인트로 안전하게 트리거한 과정]]
