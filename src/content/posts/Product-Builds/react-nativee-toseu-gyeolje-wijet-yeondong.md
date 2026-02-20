---
tags:
  - Payment
  - Toss
  - ReactNative
  - Mobile
  - UX
title: React Native에 토스 결제 위젯 연동
created: '2025-11-27 13:20'
modified: '2025-11-27 13:20'
---

# 문제

네이티브 앱 안에 토스 결제 위젯을 넣었더니, 약관 동의 상태나 결제 요청 타이밍이 꼬여 오류가 났다. 공식 SDK를 감싸는 컴포넌트를 만들어 위젯 로딩과 결제 요청을 안정화했다.

# 설계

- `PaymentWidgetProvider`로 토스 SDK 컨텍스트를 구성하고, 결제/약관 위젯을 각각 렌더링한다.
- 약관 동의 상태를 주기적으로 확인해 동의하지 않은 상태에서 결제를 요청하지 않도록 했다.
- 글로벌 함수(`requestTossPayment`)를 등록해 다른 화면에서도 결제를 트리거할 수 있게 했다.

# 구현

`@tosspayments/widget-sdk-react-native`를 사용했고, 환경 변수로 제공되는 clientKey를 체크해 오류를 미리 잡았다. 위젯 로딩 실패를 대비해 4015 오류(없는 variant)를 감지하고 기본 옵션으로 재시도했다. UI는 tailwind 스타일 유틸과 기본 색상을 공유해 디자인 시스템을 유지했다.

### 프로바이더 구성
`PaymentWidgetProvider`로 래핑하고 customerKey, clientKey를 넣었다.

### 위젯 렌더링
위젯 로딩 후 `renderPaymentMethods`와 `renderAgreement`를 호출했다.

### 결제 요청 등록
`paymentWidgetControl`이 준비되면 `global.requestTossPayment`에 결제 함수를 등록했다.

### 약관 동의 체크
`setInterval`로 약관 동의 여부를 확인하고 콜백에 전달했다.

### 오류 재시도
4015 오류가 발생하면 variant 없는 렌더링으로 두 번까지 재시도했다.

```tsx
function TossPaymentWidgetInner({
  amount,
  orderId,
  orderName,
  onSuccess,
  onFail,
  onError,
  onAgreementChange,
}: TossPaymentWidgetProps) {
  const paymentWidgetControl = usePaymentWidget();
  const [paymentMethodWidgetControl, setPaymentMethodWidgetControl] =
    useState<PaymentMethodWidgetControl | null>(null);
  const [agreementWidgetControl, setAgreementWidgetControl] =
    useState<AgreementWidgetControl | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const renderPaymentMethods = async (variantKey?: string) => {
    try {
      const control = await paymentWidgetControl.renderPaymentMethods(
        'payment-methods',
        {
          value: amount,
          currency: TOSS_RN_CONFIG.WIDGET_DEFAULTS.CURRENCY,
          country: TOSS_RN_CONFIG.WIDGET_DEFAULTS.COUNTRY,
        },
        variantKey ? { variantKey } : {},
      );
      setPaymentMethodWidgetControl(control);
    } catch (error: any) {
      if (error.code === '4015' && variantKey && retryCount < 2) {
        setRetryCount(prev => prev + 1);
        await renderPaymentMethods();
      } else {
        onError?.(error);
      }
    }
  };

  React.useEffect(() => {
    if (
      paymentWidgetControl &&
      paymentMethodWidgetControl &&
      agreementWidgetControl
    ) {
      (global as any).requestTossPayment = async () => {
        const agreement = await agreementWidgetControl.getAgreementStatus();
        if (agreement.agreedRequiredTerms !== true) {
          errorMessage('약관에 동의해주세요.');
          return;
        }
        const result = await paymentWidgetControl.requestPayment?.({
          orderId,
          orderName,
        });
        if (result?.success) {
          onSuccess?.(result.success);
          return result.success;
        } else if (result?.fail) {
          onFail?.(result.fail);
          throw new Error(result.fail.message || '결제에 실패했습니다.');
        }
      };
    }
    return () => {
      if ((global as any).requestTossPayment) delete (global as any).requestTossPayment;
    };
  }, [
    paymentWidgetControl,
    paymentMethodWidgetControl,
    agreementWidgetControl,
    orderId,
    orderName,
    onSuccess,
    onFail,
    onError,
  ]);

  React.useEffect(() => {
    if (!agreementWidgetControl) return;
    const checkAgreementStatus = async () => {
      const agreement = await agreementWidgetControl.getAgreementStatus();
      onAgreementChange?.(agreement.agreedRequiredTerms);
    };
    checkAgreementStatus();
    const interval = setInterval(
      checkAgreementStatus,
      TOSS_RN_CONFIG.AGREEMENT_CHECK_INTERVAL,
    );
    return () => clearInterval(interval);
  }, [agreementWidgetControl, onAgreementChange]);

  return (
    <View style={[tw`w-full bg-white`, { minHeight: TOSS_RN_CONFIG.WIDGET_MIN_HEIGHT }]}>
      <PaymentMethodWidget
        selector='payment-methods'
        onLoadEnd={() => renderPaymentMethods('schoolmeetupapply')}
      />
      <AgreementWidget
        selector='agreement'
        onLoadEnd={() => renderAgreement('AGREEMENT')}
      />
    </View>
  );
}

export default function TossPaymentWidget(props: TossPaymentWidgetProps) {
  const clientKey = process.env.EXPO_PUBLIC_TOSS_CLIENT_KEY;
  if (!clientKey) {
    return (
      <View style={[tw`flex items-center justify-center bg-gray-95 p-4`, { minHeight: TOSS_RN_CONFIG.WIDGET_MIN_HEIGHT }]}>
        <Text style={tw`text-center text-gray-40`}>결제 위젯을 불러올 수 없습니다.</Text>
      </View>
    );
  }

  return (
    <View style={[tw`w-full bg-white`, { minHeight: TOSS_RN_CONFIG.WIDGET_MIN_HEIGHT }]}>
      <PaymentWidgetProvider
        clientKey={clientKey}
        customerKey={TOSS_RN_CONFIG.WIDGET_DEFAULTS.CUSTOMER_KEY}
      >
        <TossPaymentWidgetInner {...props} />
      </PaymentWidgetProvider>
    </View>
  );
}
```

# 결과

결제 중 약관 동의를 빼먹으면 즉시 토스트로 안내할 수 있어 사용자 오류가 크게 줄었다. 글로벌 결제 함수를 등록해 결제 버튼이 다른 위치에 있어도 전체 프로세스를 공유할 수 있었다. 앞으로는 결제 요청 Promise를 더 정교하게 래핑해 리트라이 UI를 제공해 보려 한다.

# Reference
- https://docs.tosspayments.com/reference/widget-sdk
- https://docs.expo.dev/guides/environment-variables/

# 연결문서
- [ActionSheet 래퍼 훅 구현](/post/actionsheet-raepeo-huk-guhyeon)
- [Android 더블백 종료 처리](/post/android-deobeulbaek-jongnyo-cheori)
