---
tags:
  - NextJS
  - ServerActions
  - Concurrency
  - Validation
  - Supabase
  - Events
title: Next.js Server Action으로 이벤트 좌석 검증
created: '2025-10-09 14:06'
modified: '2025-10-09 14:06'
---

무료 이벤트 신청을 처리하면서 "누가 먼저 클릭하느냐"에 따라 좌석이 중복되는 문제를 겪었다. 결제 없는 신청이라 서버에서 한 번에 검증하고 생성해야 안전했다. 좌석 검증과 신청 생성을 하나의 서버 액션으로 묶었다.

## 서버 액션 설계
- 이벤트가 활성 상태인지, 이미 종료됐는지 먼저 확인한다.
- 좌석 수를 계산해 남은 좌석이 0이면 즉시 에러를 반환한다.
- 검증이 모두 통과하면 서비스 롤 키로 신청 레코드를 생성해 레이스 컨디션을 최소화했다.

이벤트가 비활성화되었거나 지난 일정이면 즉시 에러를 반환한다. 참여 상태인 신청만 카운트해 실제로 좌석을 차지한 인원만 고려했다. 신청 생성과 검증을 같은 서버 전용 클라이언트에서 처리해 RLS의 영향을 받지 않도록 했다.

## 이벤트 유효성 체크
이벤트 정보를 조회해 비활성 상태나 과거 일정이면 `isValid: false`를 반환한다. UI에서는 이 메시지를 그대로 사용자에게 보여준다.

## 좌석 확인
좌석 상한이 없으면 무제한으로 처리하고, 있다면 참여자 수를 세어 남은 좌석을 계산한다. 남은 좌석이 0 이하라면 오류를 반환한다.

## 신청 생성
검증이 모두 통과하면 서비스 롤 클라이언트로 신청 레코드를 추가한다. 프로젝트에서는 `applyFreeMeetup`이 `validateMeetup` → `validateSeatLimit` 순으로 검사한 뒤 `meetup_application`에 `status: '참여'`로 삽입한다. 예약 번호는 `YYMMDD + 당일 시퀀스` 형식으로 생성했다.

```ts
export const validateSeatLimit = async (meetupId: string, meetup?: any) => {
  const supabase = createAdminClient();
  if (!meetup) {
    const { data } = await supabase.from('meetup').select('max_seats').eq('id', meetupId).single();
    meetup = data;
  }
  if (!meetup?.max_seats || meetup.max_seats <= 0) {
    return { isValid: true, availableSeats: -1, totalSeats: -1 };
  }
  const { count: confirmedCount } = await supabase
    .from('meetup_application')
    .select('*', { count: 'exact', head: true })
    .eq('meetup_id', meetupId)
    .eq('status', '참여');
  const availableSeats = meetup.max_seats - (confirmedCount || 0);
  if (availableSeats <= 0) {
    return { isValid: false, error: '신청 가능한 좌석이 모두 찼습니다.' };
  }
  return { isValid: true, availableSeats, totalSeats: meetup.max_seats };
};

export const applyFreeMeetup = async (meetupId: string): Promise<string> => {
  const meetupValidation = await validateMeetup(meetupId);
  if (!meetupValidation.isValid) throw new Error(meetupValidation.error);
  const seatValidation = await validateSeatLimit(meetupId, meetupValidation.meetup);
  if (!seatValidation.isValid) throw new Error(seatValidation.error);
  // 중복 신청 확인 후
  const { data: newApplication } = await supabase
    .from('meetup_application')
    .insert({ user_id: user.id, meetup_id: meetupId, status: '참여', ... })
    .select('id')
    .single();
  return newApplication.id;
};
```

## 겪은 이슈와 해결
- 중복 신청: 같은 사용자가 이미 참여 중이면 다시 신청할 수 없도록 별도 쿼리로 검사하고 에러를 던졌다.
- 좌석 초과: 무료 신청은 곧바로 좌석을 차지하므로, 실패 시 오류 메시지를 사용자에게 명확히 전달했다.
- 타임존: 이벤트 시작 시간이 과거인지 확인할 때는 Date 객체로 비교해 정확한 시점을 검증했다.

지금은 무료 이벤트 신청이 서버에서 한 번에 처리되어 좌석이 겹치는 일이 거의 없다. 프런트에서는 신청 ID만 받아 상세 페이지로 안내하면 끝이다. 다음에는 신청 생성과 동시에 알림을 보내 운영자가 실시간으로 좌석 변동을 확인할 수 있게 만들고 싶다.

# Reference
- https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations

# 연결문서
- [React Native에서 Next.js API를 인증된 상태로 호출하기](/post/react-nativeeseo-next-js-apireul-injeungdoen-sangtaero-hochulhagi)
- [Firestore 장바구니 동기화와 수량 보정](/post/firestore-jangbaguni-donggihwawa-suryang-bojeong)
- [토스 결제 위젯 재시도와 웹훅 검증](/post/toseu-gyeolje-wijet-jaesidowa-wepuk-geomjeung)
