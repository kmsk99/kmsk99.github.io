---
tags:
  - Firebase
  - AdminSDK
  - PushNotifications
  - Backend
  - NestJS
title: Firebase Admin SDK로 상태 기반 푸시 알림을 다듬은 후기
created: 2024-02-14 10:40
modified: 2024-02-14 10:40
---

# Intro
서비스를 운영하다 보니 "왜 밤 11시에 푸시가 왔죠?"라는 문의를 자주 받았습니다. 이벤트성 알림과 긴급 알림이 섞여 있었고, 사용자별로 받고 싶지 않은 카테고리도 달랐습니다. 그래서 Firebase Admin SDK를 중심으로 상태 기반 푸시 시스템을 재구성했습니다.

## 핵심 아이디어 요약
- 백엔드에서 Firebase Admin SDK를 초기화해 서버에서 직접 토큰을 관리했습니다.
- 사용자 동의 항목과 알림 코드 범위를 매핑해 보낼지 말지를 결정했습니다.
- 개발 환경에서는 실제 푸시 대신 로그만 출력해 테스트 중에 사용자에게 알림이 가지 않도록 했습니다.

## 준비와 선택
1. **Firebase 인증 정보 관리**  
   서비스 계정 키를 환경 변수에 넣고 `\n` 문자열을 실제 개행으로 치환했습니다.
2. **카테고리 필터링**  
   알림 코드를 1000번 단위로 나눠 개인, 팀, 전체, 프로젝트 알림을 구분했습니다.
3. **야간 차단**  
   사용자 설정에서 야간 알림을 끈 경우 오후 9시부터 오전 8시 사이에는 푸시를 보내지 않았습니다.

## 구현 여정
### Step 1: Firebase 초기화

```ts
// src/notifications/fcm.service.ts
constructor(private readonly configService: ConfigService) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: this.configService.get<string>('FIREBASE_PROJECT_ID'),
      privateKey: this.configService
        .get<string>('FIREBASE_PRIVATE_KEY')
        ?.replace(/\\n/g, '\n'),
      clientEmail: this.configService.get<string>('FIREBASE_CLIENT_EMAIL'),
    }),
  });
}
```

초기화는 싱글턴으로 한 번만 수행하고, `NODE_ENV`가 development면 실제 전송을 건너뛰었습니다.

### Step 2: 상태 기반 필터

```ts
// src/notifications/notifications.service.ts
private shouldSendPush(user: User, notification: Notification): boolean {
  if (!user.pushAgree) return false;
  const pushAgree = user.pushAgree as unknown as PushAgree[];
  const total = pushAgree.find(agree => agree.name === 'total')?.value;
  if (!total) return false;

  const night = pushAgree.find(agree => agree.name === 'night')?.value;
  if (!night) {
    const hour = new Date().getHours();
    if (hour >= 21 || hour < 8) return false;
  }

  const code = notification.notificationCode ?? 0;
  if (1000 <= code && code < 2000) return pushAgree.find(agree => agree.name === 'personal')?.value ?? false;
  if (2000 <= code && code < 3000) return pushAgree.find(agree => agree.name === 'team')?.value ?? false;
  if (4000 <= code && code < 5000) return pushAgree.find(agree => agree.name === 'all')?.value ?? false;
  if (6000 <= code && code < 7000) return pushAgree.find(agree => agree.name === 'certificate')?.value ?? false;

  return false;
}
```

알림 코드가 확장되더라도 범위를 추가하면 되기 때문에, 운영팀이 새로운 카테고리를 제안하기 쉬워졌습니다.

### Step 3: 전송 로직

```ts
// src/notifications/fcm.service.ts
async sendPush(data: SendPushInput): Promise<CoreOutput> {
  if (this.NODE_ENV === 'development') {
    console.log(`[DEV] Push 알람: ${data.title}`, data);
    return { ok: true };
  }

  const payload: Message = {
    token: data.token,
    notification: { title: data.title, body: data.body },
    data: { ...(data.url && { url: data.url }) },
  };

  await admin.messaging().send(payload);
  return { ok: true };
}
```

모바일 앱에서는 푸시 데이터에 포함된 `url`을 읽어 PWA 딥링크를 열도록 했습니다.

### 예상치 못한 이슈
- 특정 사용자가 토큰을 여러 기기에 등록하면 마지막 토큰만 유지됐습니다. 토큰 테이블을 따로 만들고, 로그인 시 이전 토큰은 `messaging().subscribeToTopic`에서 제거하도록 개선했습니다.
- Firebase Admin SDK 버전을 올렸더니 ESM 번들에서 `fs` 모듈을 찾지 못했습니다. 서버 전용 패키지라 번들링에서 제외해야 했고, Webpack 설정에서 `externals`에 `firebase-admin`을 추가했습니다. GPT에게 NestJS에서 firebase-admin tree shaking 문제가 알려진 이슈인지 찾아달라고 요청한 덕분에 빠르게 해결했습니다.

## 결과와 회고
이제 사용자들은 자신이 신청한 프로세스 상태가 바뀔 때만 푸시를 받고, 야간에는 조용히 잠을 잘 수 있습니다. 운영팀은 알림 로그를 살펴보며 어떤 카테고리가 많이 비활성화되는지도 분석합니다. 다음으로는 다국어 메시지를 템플릿화하고, 웹 푸시와 모바일 푸시를 하나의 서비스에서 관리할 계획입니다. 여러분의 푸시 시스템은 사용자의 맥락을 얼마나 반영하고 있나요?

# Reference
- https://firebase.google.com/docs/admin/setup
- https://firebase.google.com/docs/cloud-messaging/send-message
- https://developer.mozilla.org/docs/Web/API/Push_API

# 연결문서
- [[PWA Builder로 IOS 빌드 시 오류 해결]]
- [[AES-256과 Prisma Middleware로 개인정보 안전하게 돌리기]]
- [[Firebase에서 검색 기능 구현하기 - 삽질 끝에 찾은 해결책]]
