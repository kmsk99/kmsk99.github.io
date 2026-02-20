---
tags:
  - React
  - NextJS
  - Localization
  - Currency
  - Frontend
  - UX
title: React Context로 통화 로컬라이제이션 구현
created: '2025-10-09 10:00'
modified: '2025-10-09 10:00'
---

# Intro

외주 개발 중 장바구니 화면에서 "USD가 왜 갑자기 KRW로 바뀌죠?" 같은 이슈를 발견했다. 거창한 i18n 솔루션을 도입하기엔 일정이 촉박했고, 프런트에서 빠르게 통화를 전환할 수 있는 경량 설계를 찾기 시작했다. React Context와 간단한 환율 테이블만으로 MVP를 끌고 나갔고, 덕분에 코드가 훨씬 단순해졌다.

# LocalizationProvider 설계

`LocalizationProvider`를 만들어 통화 코드와 setter를 전역 상태로 노출했다. 환율 정보는 `exchangeRateDollars` 객체로 정의하고, `convertPrice` 유틸에서 `Intl.NumberFormat` 스타일로 문자열을 뽑아냈다. 헤더 UI(`HomeHeader`)에서 통화 선택 드롭다운을 열고, 선택 즉시 Context를 업데이트해 전 페이지에 반영했다.

Next.js App Router를 쓰고 있었기 때문에, 서버 컴포넌트에서는 브라우저 전용 API를 사용할 수 없다는 점을 명심했다. 따라서 컨텍스트 제공자는 `use client`로 선언된 컴포넌트에서만 사용했다. 통화 전환은 SSR 시점보다 CSR 시점에 이뤄지는 게 자연스럽다고 판단했고, 그래서 루트 레이아웃에서 `LocalizationProvider`를 감쌌다. 환율 정보는 아주 정교하게 맞출 필요가 없어서, 정기적으로 대체하려고 `strings.ts`에 상수로 정의했다. 환율 계산 로직은 향후 API로 교체하기 쉽게 분리했다. 초기 아이디어는 "zustand로 갈까?"였는데, GPT에게 Context vs zustand 장단점을 비교해 달라고 물어봤다가 "컴포넌트 수가 적고 파생 상태가 단순하면 Context가 충분하다"라는 대답을 듣고 방향을 틀었다.

# 환율 상수와 Context

```ts
export const exchangeRateDollars = {
  USD: { value: 1, symbol: "$" },
  KRW: { value: 1305.6, symbol: "₩" },
  JPY: { value: 147.97, symbol: "¥" },
  VND: { value: 24335, symbol: "₫" },
};
export type ExchangeRate = keyof typeof exchangeRateDollars;
```

숫자만 바꾸면 확장되는 구조라 운영팀이 환율을 손쉽게 갱신할 수 있었다.

```tsx
"use client";

export const LocalizationContext = createContext({
  currency: "USD" as ExchangeRate,
  setCurrency: (_: ExchangeRate) => {},
});

export function LocalizationProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrency] = useState<ExchangeRate>("USD");
  return (
    <LocalizationContext.Provider value={{ currency, setCurrency }}>
      {children}
    </LocalizationContext.Provider>
  );
}
```

이 Provider는 `src/app/layout.tsx`에서 `AuthProvider`와 함께 감싸고 있다.

# convertPrice와 헤더 통합

```ts
export const convertPrice = (price: number, currency: ExchangeRate): string => {
  const rate = exchangeRateDollars[currency];
  return `${(price * rate.value).toLocaleString("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "USD" ? 2 : 0,
  })} ${currency}`;
};
```

KRW, VND처럼 소수점이 필요 없는 화폐는 자동으로 정수만 출력되도록 처리했다.

```tsx
const { currency, setCurrency } = useLocalization();

<button onClick={() => setShowGlobalMenu(!showGlobalMenu)}>
  <FaGlobeAmericas className="w-6 h-6" />
</button>
{showGlobalMenu && (
  <div className="absolute bg-white border border-zinc-400 right-0">
    <button onClick={() => { setCurrency("USD"); setShowGlobalMenu(false); }}>🇺🇸 USD</button>
    <button onClick={() => { setCurrency("VND"); setShowGlobalMenu(false); }}>🇻🇳 VND</button>
    ...
  </div>
)}
```

헤더가 클라이언트 컴포넌트라서 Context 소비가 자연스럽고, 장바구니 아이콘 배지 같은 UI도 통화 전환과 동시에 업데이트된다. 상품 카드(`ProductItem`), 주문서(`src/app/(home)/order/page.tsx`) 등 모든 가격 표시는 `convertPrice`를 통해 동일한 문자열을 노출한다. 나중에 환율 API를 붙이거나 통화당 할인율을 적용할 때도 한 곳만 고치면 된다.

# 결과

무거운 국제화 솔루션 없이도 통화 전환 UX를 빠르게 구축했고, 제품 상세·장바구니·주문서 모두 동일한 환율 데이터를 바라보게 만들었다. "전 페이지가 갑자기 달러로만 보여요" 같은 이슈가 사라졌고, 운영자가 정기적으로 환율 상수를 업데이트하는 프로세스도 안정화됐다. 다음 단계에서는 지역별 세금이나 배송비 계산을 엮고 싶다.

# Reference
- https://react.dev/reference/react/useContext
- https://react.dev/reference/react/createContext
- https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number/toLocaleString

# 연결문서
- [NICE 본인인증 API 서버 구현](/post/nice-bonninninjeung-api-seobeo-guhyeon)
- [useProfileWithRetry - 네트워크 불안정 대응 훅](/post/useprofilewithretry-neteuwokeu-buranjeong-daeeung-huk)
- [React Native 앱의 다국어 지원 구현](/post/react-native-aebui-dagugeo-jiwon-guhyeon)
