---
tags:
  - Engineering
  - TechDeepDive
  - Payment
  - ServerActions
  - Backend
title: 무료 이벤트 좌석 검증을 서버 액션으로 묶은 과정
created: '2025-10-09 14:06'
modified: '2025-10-09 14:06'
slug: muryo-ibenteu-jwaseok-geomjeungeul-seobeo-aeksyeoneuro-mukkeun-gwajeong
---

# Intro
저는 무료 이벤트 신청을 처리하면서 “누가 먼저 클릭하느냐”에 따라 좌석이 중복되는 문제를 겪었습니다. 결제 없는 신청이라 서버에서 한 번에 검증하고 생성해야 안전하더라고요. 그래서 좌석 검증과 신청 생성을 하나의 서버 액션으로 묶었습니다.

## 핵심 아이디어 요약
- 이벤트가 활성 상태인지, 이미 종료됐는지 먼저 확인합니다.
- 좌석 수를 계산해 남은 좌석이 0이면 즉시 에러를 반환합니다.
- 검증이 모두 통과하면 서비스 롤 키로 신청 레코드를 생성해 레이스 컨디션을 최소화했습니다.

## 준비와 선택
1. **두 단계 검증**: 이벤트가 비활성화되었거나 지난 일정이면 즉시 에러를 반환합니다.
2. **좌석 계산**: 참여 상태인 신청만 카운트해 실제로 좌석을 차지한 인원만 고려했습니다.
3. **서비스 롤 사용**: 신청 생성과 검증을 같은 서버 전용 클라이언트에서 처리해 RLS의 영향을 받지 않도록 했습니다.

## 구현 여정
### Step 1: 이벤트 유효성 체크
이벤트 정보를 조회해 비활성 상태나 과거 일정이면 `isValid: false`를 반환합니다. UI에서는 이 메시지를 그대로 사용자에게 보여줍니다.

### Step 2: 좌석 확인
좌석 상한이 없으면 무제한으로 처리하고, 있다면 참여자 수를 세어 남은 좌석을 계산합니다. 남은 좌석이 0 이하라면 오류를 반환합니다.

### Step 3: 신청 생성
검증이 모두 통과하면 서비스 롤 클라이언트로 신청 레코드를 추가합니다. 성공하면 신청 ID를 반환해 UI가 상세 페이지로 이동합니다.

```ts
import { createAdminClient } from './supabaseAdmin';
import { getCurrentUser } from './auth';

export const applyFreeEvent = async (eventId: string) => {
  const supabaseAdmin = createAdminClient();
  const user = await getCurrentUser();

  const validation = await validateEvent(eventId);
  if (!validation.isValid) throw new Error(validation.error);

  const seatCheck = await validateSeatLimit(eventId, validation.event);
  if (!seatCheck.isValid) throw new Error(seatCheck.error);

  // 검증을 통과한 뒤에만 서비스 롤 권한으로 신청 레코드를 생성합니다.
  const { data, error } = await supabaseAdmin
    .from('event_application')
    .insert({
      user_id: user.id,
      event_id: eventId,
      status: 'confirmed',
    })
    .select('id')
    .single();

  if (error || !data) throw error ?? new Error('신청 생성 실패');
  return data.id;
};
```

## 겪은 이슈와 해결 과정
- **중복 신청**: 같은 사용자가 이미 참여 중이면 다시 신청할 수 없도록 별도 쿼리로 검사하고 에러를 던졌습니다.
- **좌석 초과**: 무료 신청은 곧바로 좌석을 차지하므로, 실패 시 오류 메시지를 사용자에게 명확히 전달했습니다.
- **타임존**: 이벤트 시작 시간이 과거인지 확인할 때는 Date 객체로 비교해 정확한 시점을 검증했습니다.

## 결과와 회고
지금은 무료 이벤트 신청이 서버에서 한 번에 처리되어 좌석이 겹치는 일이 거의 없습니다. 프런트에서는 신청 ID만 받아 상세 페이지로 안내하면 끝이죠. 다음에는 신청 생성과 동시에 알림을 보내 운영자가 실시간으로 좌석 변동을 확인할 수 있게 만들고 싶습니다.

여러분은 비슷한 예약 시스템을 어떻게 처리하고 계신가요? 좌석 관리 팁이 있다면 꼭 공유해 주세요.

# Reference
- https://supabase.com/docs/guides/auth/server-side/nextjs

# 연결문서
- [[Bearer 토큰을 Supabase 쿠키로 바꿔주는 Next.js 서버 클라이언트]]
- [[Firestore 장바구니 동기화에서 배운 방어적 패턴]]
- [[결제 위젯 자동 재시도와 웹훅 이중 검증으로 에러 줄이기]]
