---
tags:
  - Firebase
  - AdminSDK
  - PushNotifications
  - Backend
  - NestJS
title: Firebase Admin SDK 푸시 알림 필터링
created: 2024-02-14 10:40
modified: 2024-02-14 10:40
---

# Intro

직접 설치한 앱에서 밤 11시에 푸시가 온 것을 발견했다. 이벤트성 알림과 긴급 알림이 섞여 있었고, 사용자별로 받고 싶지 않은 카테고리도 달랐다. 그래서 Firebase Admin SDK를 중심으로 상태 기반 푸시 시스템을 재구성했다.

# 상태 기반 필터링

백엔드에서 Firebase Admin SDK를 초기화해 서버에서 직접 토큰을 관리했다. 사용자 동의 항목과 알림 코드 범위를 매핑해 보낼지 말지를 결정했다. 개발 환경에서는 실제 푸시 대신 로그만 출력해 테스트 중에 사용자에게 알림이 가지 않도록 했다.

서비스 계정 키를 환경 변수에 넣고 `\n` 문자열을 실제 개행으로 치환했다. 알림 코드를 1000번 단위로 나눠 개인, 팀, 전체, 프로젝트 알림을 구분했다. 사용자 설정에서 야간 알림을 끈 경우 오후 9시부터 오전 8시 사이에는 푸시를 보내지 않았다.

# Firebase 초기화

```ts
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

초기화는 싱글턴으로 한 번만 수행하고, `NODE_ENV`가 development면 실제 전송을 건너뛰었다.

# 상태 기반 필터 로직

프로젝트의 `notifications.service.ts`에서 실제로 쓰는 `shouldSendPush` 로직이다. 알림 코드를 1000번 단위로 나눠 개인·동아리·동아리연합회·전체·프로젝트·인증서 알림을 구분한다.

```ts
private shouldSendPush(user: User, notification: Notification): boolean {
  if (!user.pushAgree) return false;

  const pushAgree = user.pushAgree as unknown as PushAgree[];
  const total = pushAgree.find(agree => agree.name === 'total')?.value;
  const night = pushAgree.find(agree => agree.name === 'night')?.value;
  const personal = pushAgree.find(agree => agree.name === 'personal')?.value;
  const club = pushAgree.find(agree => agree.name === 'club')?.value;
  const union = pushAgree.find(agree => agree.name === 'union')?.value;
  const all = pushAgree.find(agree => agree.name === 'all')?.value;
  const project = pushAgree.find(agree => agree.name === 'project')?.value;
  const certificate = pushAgree.find(agree => agree.name === 'certificate')?.value;

  if (!total) return false;

  if (!night) {
    const now = new Date();
    const hour = now.getHours();
    if (hour >= 21 || hour < 8) return false;
  }

  const code = notification.notificationCode || 0;

  if (1000 <= code && code < 2000) return personal ?? false;
  else if (2000 <= code && code < 3000) return club ?? false;
  else if (3000 <= code && code < 4000) return union ?? false;
  else if (4000 <= code && code < 5000) return all ?? false;
  else if (5000 <= code && code < 6000) return project ?? false;
  else if (6000 <= code && code < 7000) return certificate ?? false;

  return false;
}
```

`createNotification`에서 알림을 DB에 저장한 뒤 `shouldSendPush`가 true일 때만 `fcmService.sendPush`를 호출한다. 알림 코드가 확장되더라도 범위를 추가하면 되기 때문에, 운영팀이 새로운 카테고리를 제안하기 쉬워졌다.

# 전송 로직

```ts
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

모바일 앱에서는 푸시 데이터에 포함된 `url`을 읽어 PWA 딥링크를 열도록 했다.

# 예상치 못한 이슈

특정 사용자가 토큰을 여러 기기에 등록하면 마지막 토큰만 유지됐다. 토큰 테이블을 따로 만들고, 로그인 시 이전 토큰은 `messaging().subscribeToTopic`에서 제거하도록 개선했다. Firebase Admin SDK 버전을 올렸더니 ESM 번들에서 `fs` 모듈을 찾지 못했다. 서버 전용 패키지라 번들링에서 제외해야 했고, Webpack 설정에서 `externals`에 `firebase-admin`을 추가했다. GPT에게 NestJS에서 firebase-admin tree shaking 문제가 알려진 이슈인지 찾아달라고 요청한 덕분에 빠르게 해결했다.

# 결과

이제 사용자들은 자신이 신청한 프로세스 상태가 바뀔 때만 푸시를 받고, 야간에는 조용히 잠을 잘 수 있다. 운영팀은 알림 로그를 살펴보며 어떤 카테고리가 많이 비활성화되는지도 분석한다. 다음으로는 다국어 메시지를 템플릿화하고, 웹 푸시와 모바일 푸시를 하나의 서비스에서 관리할 계획이다.

# Reference
- https://firebase.google.com/docs/cloud-messaging/admin
- https://firebase.google.com/docs/admin/setup
- https://firebase.google.com/docs/cloud-messaging/send-message
- https://developer.mozilla.org/docs/Web/API/Push_API

# 연결문서
- [[Nestjs + Prisma 백엔드에서 고객정보 양방향 암호화하기]]
- [[Firestore에서 키워드 인덱싱으로 검색 구현하기]]
