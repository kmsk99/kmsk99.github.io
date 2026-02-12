---
tags:
  - Expo
  - PushNotifications
  - Supabase
  - Mobile
  - Reliability
title: Expo 푸시 토큰 등록 루틴에서 배운 것
created: '2025-11-27 10:00'
modified: '2025-11-27 10:00'
---

# Intro
- 로그인을 기준으로 푸시 알림 초기화를 제어하지 않으면 알림이 뒤늦게 도착하거나 아예 빠지는 일이 잦았어요.
- 저는 Expo 기반 프로젝트에서 토큰 등록과 라우팅까지 한 번에 묶어 지연과 중복을 없애는 루틴을 만들었습니다.

## 핵심 아이디어 요약
- 로그인 여부를 확인한 뒤에만 Expo 토큰을 발급하고, Supabase에 디바이스 정보를 멱등하게 업서트합니다.
- iOS/Android별 권한 체계와 알림 채널을 분기해 초기화 타이밍을 안정화합니다.
- 포그라운드/탭 이벤트를 감지해 뱃지 카운트를 즉시 동기화하고 알림 페이로드를 라우터로 넘깁니다.

## 준비와 선택
- Expo SDK를 쓰고 있어서 `expo-notifications`, `expo-constants`, `expo-device`를 그대로 활용했습니다.
- 백엔드와 토큰을 공유하기 위해 Supabase 서비스 모듈을 호출하는 구조를 유지했습니다.
- 딥링크는 `expo-router`로 처리하고 있어 `router.replace`로 알림 탭 시 이동하도록 설계했습니다.

## 구현 여정
1. **세션 선 확인**: `supabase.auth.getSession()`을 먼저 호출해 로그인 상태가 아니면 루틴 전체를 중단하고 뱃지를 0으로 초기화했습니다.
2. **알림 채널과 권한 셋업**: Android에서는 채널을 직접 생성하고, iOS에서는 세분화된 권한 상태(`AUTHORIZED`, `PROVISIONAL`, `EPHEMERAL`)를 다시 점검했습니다.
3. **프로젝트 ID와 토큰 발급**: `Constants.easConfig.projectId`가 없을 때를 대비해 `expoConfig.extra.eas.projectId`까지 탐색했습니다.
4. **디바이스 메타 업서트**: `Device.deviceName`, `Device.osVersion` 등 네이티브 정보를 함께 등록해 서버가 푸시 실패를 추적하기 쉬워졌습니다.
5. **알림 리스너**: 수신/탭 이벤트 모두에서 `updateBadgeCount`를 호출해 뱃지를 맞추고, 커스텀 라우팅 함수로 화면 이동을 처리했습니다.

```ts
// src/shared/hooks/push.ts:22-274
export function usePushNotificationsSetup() {
  const lastRegisteredTokenRef = useRef<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    (async () => {
      const res = await supabase.auth.getSession();
      setIsLoggedIn(Boolean(res?.data?.session?.user?.id));
    })();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
    if (!isLoggedIn) return;

    (async () => {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldPlaySound: false,
          shouldSetBadge: false,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
        });
      }

      const { status } = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      if (status !== 'granted') return;

      const projectId = Constants.easConfig?.projectId;
      if (!projectId) return;

      const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
      lastRegisteredTokenRef.current = tokenData.data;

      await registerUserPushToken({
        token: tokenData.data,
        provider: 'expo',
        projectId,
        deviceName: Device.deviceName ?? null,
        appVersion: Constants.nativeAppVersion ?? null,
        deviceInfo: { osName: Device.osName ?? undefined },
      });
    })();

    const receivedSub = Notifications.addNotificationReceivedListener(
      async () => updateBadgeCount(),
    );
    const responseSub = Notifications.addNotificationResponseReceivedListener(
      async response => {
        await updateBadgeCount();
        const payload = response.notification.request.content.data as NotificationPayload;
        const { route } = resolveNotificationRoute(payload);
        router.replace(route);
      },
    );

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, [isLoggedIn]);
}
```

## 결과와 회고
- 로그인 후 약 2초 안에 모든 디바이스에서 토큰이 등록되고, 서버 로그상 토큰 중복이 사라졌습니다.
- 안내 배너를 숨기고 있었던 알림도 즉시 라우팅되면서 QA 팀이 테스트를 훨씬 빠르게 끝낼 수 있었습니다.
- 다음엔 백엔드에서 토큰 중복을 더 정교하게 정리하고, 앱 내에서 실패 원인을 Toast로 바로 보여주려 합니다.
- 여러분 팀은 Expo 푸시 등록 과정에서 어떤 문제를 자주 만났나요? 댓글로 경험을 알려주시면 감사하겠습니다.

# Reference
- https://docs.expo.dev/versions/latest/sdk/notifications/

# 연결문서
- [KeyboardStickyView 버그를 잡으면서 적어둔 노트](/post/keyboardstickyview-beogeureul-jabeumyeonseo-jeogeodun-noteu)
- [React Native에서 로컬 리텐션 알림을 스케줄링하며 확인한 포인트](/post/react-nativeeseo-rokeol-ritensyeon-allimeul-seukejullinghamyeo-hwakginhan-pointeu)
- [카카오 OAuth를 iOS와 Android에 동시에 붙인 경험](/post/kakao-oauthreul-ioswa-androide-dongsie-buchin-gyeongheom)
