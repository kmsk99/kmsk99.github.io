---
tags:
  - Payment
  - Webhook
  - Security
  - Retry
  - Frontend
  - Backend
title: 결제 위젯 자동 재시도와 웹훅 이중 검증으로 에러 줄이기
created: '2025-10-09 14:06'
modified: '2025-10-09 14:06'
---

# Intro
저는 결제 버튼을 눌렀는데 아무 반응이 없을 때만큼 식은땀이 흐르는 순간이 없습니다. 모바일 네트워크에서 결제 위젯이 멈추기라도 하면 “결제가 됐나요?”라는 문의가 줄을 서죠. 그래서 프런트엔드와 백엔드 모두에 자동 재시도와 웹훅 이중 검증을 도입해 사용자가 느끼는 불확실성을 줄였습니다.

## 핵심 아이디어 요약
- 프런트에서는 위젯을 리셋하고 새 주문 번호를 발급해 최대 3회까지 자동 재시도를 돌립니다.
- 백엔드는 서명 검증과 재조회 두 단계를 거쳐 웹훅 위변조를 차단합니다.
- 결제 완료 시 좌석 수와 중복 신청 여부를 다시 확인해 엣지 케이스를 막았습니다.

## 준비와 선택
1. **Retry 정책**: UI에서 타임아웃을 줄이고 싶어서 1초 간격으로 최대 세 번 위젯을 재초기화하는 단순 전략을 택했습니다. 복잡한 큐보다 확실히 안정적이더군요.
2. **상태 관리**: `isRetrying`, `retryCount`, `hasPaymentError` 같은 플래그를 만들어 버튼 라벨과 비활성화 조건을 명확하게 했습니다.
3. **서버 보안**: 결제 대행사에서 보내는 웹훅은 HMAC과 전송 시간을 모두 확인해야 믿을 수 있다고 판단해, 검증 로직을 별도 함수로 분리했습니다.

## 구현 여정
### Step 1: 위젯 재초기화와 자동 재시도
UI에서 결제 위젯 상태를 추적하며 실패 시 자동으로 재초기화했습니다.

```tsx
const autoRetryPaymentWidget = () => {
  const maxRetries = 3;
  if (retryCount >= maxRetries) {
    setHasPaymentError(true);
    setIsRetrying(false);
    return;
  }

  setIsRetrying(true);
  setTimeout(() => {
    setWidgetResetKey(prev => prev + 1);
    setOrderId(`order_${Date.now()}`);
    setRetryCount(prev => prev + 1);
  }, 1000);
};
```

위젯이 실패하면 1초 뒤 새 주문 번호로 렌더링을 강제하고, 재시도 횟수가 세 번을 넘으면 사용자에게 수동 재시도를 안내했습니다.

### Step 2: 결제 버튼 상태 관리
버튼 라벨은 `isRetrying ? "결제 위젯 재시도 중... (1/3)" : "결제하기"` 식으로 상황을 드러냅니다. 재시도 중에는 버튼을 비활성화해 중복 클릭을 막고, 실패했을 때만 수동 재시도 버튼을 따로 보여줬습니다.

### Step 3: 결제 전 유효성 검사
결제 전에 서버로 좌석 수와 구매 가능 여부를 확인하는 API를 호출하고, 위젯에서 `onReady` 이벤트가 도착할 때까지 버튼을 비활성화했습니다.

### Step 4: 웹훅 서명과 시간 검증
서버는 전송 시간이 5분 이내인지 확인하고, Base64 서명을 HMAC-SHA256으로 검증했습니다.

```ts
import crypto from 'crypto';

export function verifyWebhookSignature(payload: string, signature: string) {
  const expected = crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET!)
    .update(payload, 'utf8')
    .digest('base64');

  const actual = signature
    .split(',')
    .filter(value => value.startsWith('v1:'))
    .map(value => value.replace('v1:', ''));

  return actual.some(value =>
    crypto.timingSafeEqual(
      Buffer.from(value, 'base64'),
      Buffer.from(expected, 'base64'),
    ),
  );
}
```

첫 번째 서명이 통과하면 토스페이먼츠가 보낸 이벤트라는 전제하에 주문 상태를 재조회하고, 이미 처리된 주문인지 다시 확인했습니다.

### Step 5: 결제 완료 후 안전장치
결제 완료 시 좌석 수와 중복 신청 여부를 다시 확인하고, 문제가 있으면 결제를 되돌릴 수 있도록 상세 로그를 남겼습니다.

## 겪은 이슈와 해결 과정
- **위젯 스크립트 오류**: `loadTossPayments`가 간헐적으로 실패해 위젯이 null이 되었습니다. `onError` 콜백에서 `autoRetryPaymentWidget()`을 바로 호출해 사용자 개입 없이 회복하도록 만들었습니다.
- **서명 헤더 누락**: 토스 테스트 웹훅에서 가끔 서명이 빈 문자열로 오는 일이 있었습니다. 검증 함수에서 필수 헤더가 없으면 바로 401을 반환하도록 해서 로그가 쌓이도록 했습니다.
- **좌석 초과**: 결제가 먼저 완료되고 좌석 수가 뒤늦게 줄어드는 바람에 "결제는 됐는데 참가가 안 된다"는 사고가 한번 났습니다. 이후 `validateSeatLimit`에서 실패하면 치명적인 에러 로그를 남기고 사용자에게 고객센터를 안내하도록 바꿨습니다.

## 결과와 회고
자동 재시도와 서명 검증을 붙인 뒤에는 결제 실패 문의가 눈에 띄게 줄었습니다. 저는 특히 "결제 버튼이 안 눌립니다"라는 문구를 "위젯을 다시 로딩 중이에요"로 바꾼 것만으로도 고객센터 부담이 크게 줄었다는 점이 인상적이었어요. 다음에는 토스 웹훅을 Supabase Functions로 라우팅해 장애 반경을 더 줄여볼 계획입니다.

혹시 비슷한 결제 문제를 겪은 적이 있으신가요? 자동 재시도나 웹훅 검증 팁이 있다면 꼭 알려주세요. 서로의 시행착오가 큰 힘이 되더라고요.

# Reference
- https://docs.tosspayments.com/reference/js-sdk
- https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage

# 연결문서
- [Supabase RPC로 포인트 적립·차감을 안전하게 처리한 방법](/post/supabase-rpcro-pointeu-jeongnip-chagameul-anjeonhage-cheorihan-bangbeop)
- [갤럭시 기기까지 고려한 Supabase 첨부파일 업로드 안정화기](/post/gaelleoksi-gigikkaji-goryeohan-supabase-cheombupail-eomnodeu-anjeonghwagi)
- [AES-256과 Prisma Middleware로 개인정보 안전하게 돌리기](/post/aes-256gwa-prisma-middlewarero-gaeinjeongbo-anjeonhage-dolligi)
