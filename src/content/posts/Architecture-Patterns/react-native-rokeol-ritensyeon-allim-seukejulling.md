---
tags:
  - ReactNative
  - Expo
  - Notifications
  - Engagement
  - Mobile
title: React Native 로컬 리텐션 알림 스케줄링
created: '2026-01-21'
modified: '2026-01-21'
---

# Intro

장기 미접속 사용자를 깨우는 로컬 알림을 만들었는데, 기기마다 중복 예약이나 권한 누락이 빈번했다. React Native에서 Expo Notifications를 활용해 스케줄링, 취소, 멱등성을 모두 잡는 유틸을 정리했다.

# 스케줄링 전략

알림마다 고유 식별자를 생성해 새 스케줄 전에 기존 알림을 취소한다. 플랫폼 권한을 다시 확인하고, 지원하지 않는 환경(web)은 빠르게 빠져나간다. 리텐션/온보딩 등 시나리오별 예약과 해제를 하나의 서비스 모듈로 묶었다.

앱이 Expo 기반이라 `expo-notifications`를 썼고, 네이티브 브리지를 만들 필요가 없었다. 사용자별 알림을 추적하기 위해 `createNotificationIdentifier(userId, type)` 패턴을 도입했다. 반복 스케줄이 필요한 리텐션 알림은 하드코딩된 배열보다 타입 안전한 상수 배열을 사용했다.

# 구현 포인트

iOS/Android가 아닌 경우에는 바로 null을 반환해 크래시를 막았다. 동일 식별자의 알림이 이미 예약돼 있으면 `cancelLocalNotification`을 먼저 실행했다. `scheduleLocalNotification` 하나에서 title/body/trigger를 모두 처리하고, 개별 유스케이스는 헬퍼가 감싸도록 했다. 리텐션 알림의 경우 `RETENTION_REMINDER_SCHEDULE`을 순회하면서 각각 await를 걸어 순차적으로 예약했다. 온보딩, 리텐션 알림 모두 취소 함수에서 `Promise.all`로 묶어 멱등성을 보장했다.

```ts
export async function scheduleLocalNotification(
  data: LocalNotificationData,
): Promise<string | null> {
  try {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;

    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return null;

    // 기존 같은 identifier로 스케줄된 알림이 있다면 취소
    await cancelLocalNotification(data.identifier);

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: data.title,
        body: data.body,
        data: { type: data.type, identifier: data.identifier },
        sound: true,
        badge: 1,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: data.scheduledTime,
      },
      identifier: data.identifier,
    });

    return notificationId;
  } catch (error) {
    console.error('로컬 알림 스케줄링 실패:', error);
    return null;
  }
}

// 사용자 ID 기반 identifier 생성
export function createNotificationIdentifier(
  userId: string,
  type: LocalNotificationType,
): string {
  return `${type}_${userId}`;
}
```

온보딩/리텐션 시나리오별 헬퍼가 `scheduleLocalNotification`을 호출한다.

```ts
return await scheduleLocalNotification({
  type: 'profile_completion_reminder',
  title: '커리어를 등록해주세요📝',
  body: '커리어를 입력하여 내 프로필을 완성해보세요.',
  scheduledTime: getNextDayAtTime(10),
  identifier: createNotificationIdentifier(userId, 'profile_completion_reminder'),
});
```

# 결과

QA에서 테스트 케이스를 반복 실행해도 더 이상 알림이 중첩되지 않고, 예약 취소 후 즉시 재예약이 잘 동작한다. 사용자가 알림 권한을 끄면 함수가 조용히 null을 반환하기 때문에, UI에서는 토스트로 안내할 수 있게 분리할 예정이다. 다음 단계로는 사용자가 알림을 열었을 때 루트 화면으로 연결하는 라우팅 전략을 푸시 알림 코드와 공유하려고 한다.

# Reference
- https://docs.expo.dev/versions/latest/sdk/notifications/

# 연결문서
- [ActionSheet 래퍼 훅 구현](/post/actionsheet-raepeo-huk-guhyeon)
- [Expo 푸시 토큰 등록 흐름 정리](/post/expo-pusi-tokeun-deungnok-heureum-jeongni)
- [KeyboardStickyView 포커스 버그 수정](/post/keyboardstickyview-pokeoseu-beogeu-sujeong)
