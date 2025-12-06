---
tags:
  - Engineering
  - TechDeepDive
  - PushNotification
  - Expo
  - Android
  - iOS
  - ReactNative
  - Payment
title: React Native에서 로컬 리텐션 알림을 스케줄링하며 확인한 포인트
created: '2024-11-27 10:20'
modified: '2024-11-27 10:20'
slug: react-native에서-로컬-리텐션-알림을-스케줄링하며-확인한-포인트
---

# Intro
- 장기 미접속 사용자를 깨우는 로컬 알림을 만들었는데, 기기마다 중복 예약이나 권한 누락이 빈번했어요.
- 저는 React Native에서 Expo Notifications를 활용해 스케줄링, 취소, 멱등성을 모두 잡는 유틸을 정리했습니다.

## 핵심 아이디어 요약
- 알림마다 고유 식별자를 생성해 새 스케줄 전에 기존 알림을 취소합니다.
- 플랫폼 권한을 다시 확인하고, 지원하지 않는 환경(web)은 빠르게 빠져나갑니다.
- 리텐션/온보딩 등 시나리오별 예약과 해제를 하나의 서비스 모듈로 묶었습니다.

## 준비와 선택
- 앱이 Expo 기반이라 `expo-notifications`를 썼고, 네이티브 브리지를 만들 필요가 없었습니다.
- 사용자별 알림을 추적하기 위해 `createNotificationIdentifier(userId, type)` 패턴을 도입했습니다.
- 반복 스케줄이 필요한 리텐션 알림은 하드코딩된 배열보다 타입 안전한 상수 배열을 사용했습니다.

## 구현 여정
1. **권한 확인과 빠른 탈출**: iOS/Android가 아닌 경우에는 바로 null을 반환해 크래시를 막았습니다.
2. **기존 알림 취소**: 동일 식별자의 알림이 이미 예약돼 있으면 `cancelLocalNotification`을 먼저 실행했습니다.
3. **스케줄 공통화**: `scheduleLocalNotification` 하나에서 title/body/trigger를 모두 처리하고, 개별 유스케이스는 헬퍼가 감싸도록 했습니다.
4. **대량 스케줄**: 리텐션 알림의 경우 `RETENTION_REMINDER_SCHEDULE`을 순회하면서 각각 await를 걸어 순차적으로 예약했습니다.
5. **취소 메서드 통일**: 온보딩, 리텐션 알림 모두 취소 함수에서 `Promise.all`로 묶어 멱등성을 보장했습니다.

```ts
// src/shared/libs/local-notifications.ts:20-248
export async function scheduleLocalNotification(
  data: LocalNotificationData,
): Promise<string | null> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return null;

  await cancelLocalNotification(data.identifier);

  return await Notifications.scheduleNotificationAsync({
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
}

export async function scheduleAllRetentionReminders(userId: string) {
  await cancelAllRetentionReminders(userId);
  for (const days of RETENTION_REMINDER_SCHEDULE) {
    await scheduleRetentionReminder(userId, days);
  }
}

export async function cancelAllUserNotifications(userId: string) {
  await Promise.all([
    cancelAllOnboardingNotifications(userId),
    cancelAllRetentionReminders(userId),
  ]);
}
```

## 결과와 회고
- QA에서 테스트 케이스를 반복 실행해도 더 이상 알림이 중첩되지 않고, 예약 취소 후 즉시 재예약이 잘 동작합니다.
- 사용자가 알림 권한을 끄면 함수가 조용히 null을 반환하기 때문에, UI에서는 토스트로 안내할 수 있게 분리할 예정입니다.
- 다음 단계로는 사용자가 알림을 열었을 때 루트 화면으로 연결하는 라우팅 전략을 푸시 알림 코드와 공유하려고 합니다.
- 여러분은 로컬 알림을 멱등하게 관리하기 위해 어떤 패턴을 쓰고 있나요? 다른 아이디어가 있다면 알려주세요.

# Reference
- https://docs.expo.dev/versions/latest/sdk/notifications/

# 연결문서
- [[ActionSheet를 안전하게 감싸는 훅을 만든 이유]]
- [[Expo 푸시 토큰 등록 루틴에서 배운 것]]
- [[KeyboardStickyView 버그를 잡으면서 적어둔 노트]]
