---
tags:
  - Engineering
  - TechDeepDive
title: 초대 코드와 스탬프 지급을 한 흐름으로 묶은 이유
created: '2025-10-09 14:06'
modified: '2025-10-09 14:06'
---

# Intro
저는 초대 코드 이벤트를 운영하면서 “누가 언제 스탬프를 받았지?”를 추적하기 어려웠습니다. 초대받은 사람과 초대한 사람 모두에게 보상을 주려면 흐름을 하나로 묶어야 했죠. 그래서 초대 코드 검증, 히스토리 저장, 스탬프 지급을 한 API에서 처리하도록 만들었습니다.

## 핵심 아이디어 요약
- 초대 코드를 사용하면 히스토리 테이블에 기록하고, 초대받은 사용자에게 즉시 스탬프를 지급합니다.
- 초대받은 사용자가 이미 학교 인증을 마쳤다면 초대한 사람에게도 스탬프를 줍니다.
- 모든 로직은 서비스 롤 클라이언트에서 실행해 RLS를 우회합니다.

## 준비와 선택
1. **코드 검증**: 초대 코드가 존재하는지, 자신의 코드를 사용하지 않았는지 확인했습니다.
2. **중복 사용 방지**: 이미 초대받은 기록이 있으면 에러를 반환해 중복 등록을 차단했습니다.
3. **시간 제한**: 가입 후 72시간이 지나면 초대 코드를 쓸 수 없도록 `created_at` 비교를 추가했습니다.

## 구현 여정
### Step 1: 초대 코드 사용
세션 사용자를 확인하고, 초대 코드가 유효한지 검사한 뒤 히스토리 테이블에 `inviter_id`, `invitee_id`로 레코드를 만듭니다.

### Step 2: 스탬프 지급
새로 생성된 히스토리 ID로 초대받은 사용자에게 스탬프를 지급합니다. 이미 지급된 스탬프가 있으면 실패 메시지를 반환합니다.

```ts
import { addUserStamp } from './stamp-service';

export const addInviteReceivedStamp = async (
  inviteeId: string,
  inviteHistoryId: string,
) => {
  return addUserStamp(inviteeId, '친구 초대 받음', inviteHistoryId, null);
};
```

### Step 3: 학교 인증 연동
초대받은 사용자가 이미 학교 인증을 마친 상태라면 초대한 사용자에게 “친구 초대 완료” 스탬프를 주고 히스토리에 `verified` 플래그를 업데이트합니다.

## 겪은 이슈와 해결 과정
- **자기 코드 사용**: 사용자 ID와 초대 코드의 작성자가 같으면 403을 반환해 자기 자신을 초대할 수 없도록 했습니다.
- **동시 요청**: 두 번 연속 호출될 수 있어 히스토리 insert 시 unique constraint를 활용했습니다.
- **스탬프 중복**: 스탬프 지급 함수가 내부적으로 중복을 확인해 메시지를 반환하므로, 호출부에서는 그대로 사용자에게 안내했습니다.

## 결과와 회고
지금은 초대 코드가 사용되면 스탬프와 히스토리가 동시에 기록돼 운영자가 엑셀로 체크할 일이 없어졌습니다. 학교 인증까지 이어지면 자동으로 초대한 사람에게 보상도 지급되니 이벤트 관리가 훨씬 수월합니다. 다음에는 초대 코드 사용 시 알림을 보내 초대자가 바로 변화를 느낄 수 있게 해볼 예정입니다.

여러분은 친구 초대 보상을 어떻게 구현하고 계신가요? 다른 아이디어가 있다면 댓글로 공유해주세요.

# Reference
- https://supabase.com/docs/guides/auth/row-level-security
- https://supabase.com/docs/guides/functions

# 연결문서
- [AES-256과 Prisma Middleware로 개인정보 안전하게 돌리기](/post/aes-256gwa-prisma-middlewarero-gaeinjeongbo-anjeonhage-dolligi)
- [AI 자동화를 cron 엔드포인트로 안전하게 트리거한 과정](/post/ai-jadonghwareul-cron-endeupointeuro-anjeonhage-teurigeohan-gwajeong)
- [AWS KMS와 AES-GCM으로 서버 사이드 암호화 업로드 구축기](/post/aws-kmswa-aes-gcmeuro-seobeo-saideu-amhohwa-eomnodeu-guchukgi)
