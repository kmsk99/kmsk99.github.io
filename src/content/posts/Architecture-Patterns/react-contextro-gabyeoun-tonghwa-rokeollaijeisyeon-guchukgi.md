---
tags:
  - React
  - NextJS
  - Localization
  - Currency
  - Frontend
  - UX
title: React Context로 가벼운 통화 로컬라이제이션 구축기
created: '2025-10-09 10:00'
modified: '2025-10-09 10:00'
---

# Intro
- 글로벌 사용자들이 동시에 몰리는 장바구니 화면에서 “USD가 왜 갑자기 KRW로 바뀌죠?”라는 문의를 받았을 때 진짜 식은땀이 났어요. 거창한 i18n 솔루션을 도입하기엔 일정이 촉박했고, 프런트에서 빠르게 통화를 전환할 수 있는 경량 설계를 찾기 시작했습니다.
- 저는 React Context와 간단한 환율 테이블만으로 MVP를 끌고 나갔고, 덕분에 코드가 훨씬 단순해졌습니다.

## 핵심 아이디어 요약
- `LocalizationProvider`를 만들어 통화 코드와 setter를 전역 상태로 노출합니다.
- 환율 정보는 `exchangeRateDollars` 객체로 정의하고, `convertPrice` 유틸에서 `Intl.NumberFormat` 스타일로 문자열을 뽑아냅니다.
- 헤더 UI(`HomeHeader`)에서 통화 선택 드롭다운을 열고, 선택 즉시 Context를 업데이트해 전 페이지에 반영했습니다.

## 준비와 선택
- Next.js App Router를 쓰고 있었기 때문에, 서버 컴포넌트에서는 브라우저 전용 API를 사용할 수 없다는 점을 명심했습니다. 따라서 컨텍스트 제공자는 `use client`로 선언된 컴포넌트에서만 사용했어요.
- 통화 전환은 SSR 시점보다 CSR 시점에 이뤄지는 게 자연스럽다고 판단했고, 그래서 루트 레이아웃에서 `LocalizationProvider`를 감쌌습니다.
- 환율 정보는 아주 정교하게 맞출 필요가 없어서, 정기적으로 대체하려고 `strings.ts`에 상수로 정의했습니다. 환율 계산 로직은 향후 API로 교체하기 쉽게 분리했죠.
- 참고로 초기 아이디어는 “zustand로 갈까?”였는데, GPT에게 Context vs zustand 장단점을 비교해 달라고 물어봤다가 “컴포넌트 수가 적고 파생 상태가 단순하면 Context가 충분하다”라는 대답을 듣고 방향을 틀었습니다.

## 구현 여정
1. **환율 상수와 타입 정의**  
   `exchangeRateDollars`에 지원 통화를 정리하고, `ExchangeRate` 타입을 추출했습니다.
   ```ts
   // src/utils/strings.ts
   export const exchangeRateDollars = {
     USD: { value: 1, symbol: "$" },
     KRW: { value: 1305.6, symbol: "₩" },
     JPY: { value: 147.97, symbol: "¥" },
     VND: { value: 24335, symbol: "₫" },
   };
   export type ExchangeRate = keyof typeof exchangeRateDollars;
   ```
   숫자만 바꾸면 확장되는 구조라 운영팀이 환율을 손쉽게 갱신할 수 있었습니다.

2. **Context 제공자 작성**  
   통화 상태를 전역으로 보관하고, setter를 함께 넘겨 헤더에서 통화 코드를 바꿀 수 있도록 했습니다.
   ```tsx
   // src/utils/LocalizationProvider.tsx
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
   이 Provider는 `src/app/layout.tsx`에서 `AuthProvider`와 함께 감싸고 있습니다.

3. **가격 변환 유틸 추가**  
   제품 카드나 주문서에서 공통으로 호출할 수 있게 `convertPrice` 함수를 만들었습니다.
   ```ts
   // src/utils/utils.ts
   export const convertPrice = (price: number, currency: ExchangeRate): string => {
     const rate = exchangeRateDollars[currency];
     return `${(price * rate.value).toLocaleString("en-US", {
       style: "currency",
       currency,
       minimumFractionDigits: currency === "USD" ? 2 : 0,
     })} ${currency}`;
   };
   ```
   KRW, VND처럼 소수점이 필요 없는 화폐는 자동으로 정수만 출력되도록 처리했습니다.

4. **헤더에서 통화 토글 노출**  
   `HomeHeader`에서 지구본 버튼을 눌렀을 때 통화 리스트가 펼쳐지도록 만들고, 선택하면 `setCurrency`를 호출합니다.
   ```tsx
   // src/components/organisms/HomeHeader.tsx
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
   헤더가 클라이언트 컴포넌트라서 Context 소비가 자연스럽고, 장바구니 아이콘 배지 같은 UI도 통화 전환과 동시에 업데이트됩니다.

5. **페이지 전반에서 재사용**  
   상품 카드(`ProductItem`), 주문서(`src/app/(home)/order/page.tsx`) 등 모든 가격 표시는 `convertPrice`를 통해 동일한 문자열을 노출합니다. 나중에 환율 API를 붙이거나 통화당 할인율을 적용할 때도 한 곳만 고치면 됩니다.

## 결과와 회고
- 무거운 국제화 솔루션 없이도 통화 전환 UX를 빠르게 구축했고, 제품 상세·장바구니·주문서 모두 동일한 환율 데이터를 바라보게 만들었습니다.
- “전 페이지가 갑자기 달러로만 보여요” 같은 이슈가 사라졌고, 운영자가 정기적으로 환율 상수를 업데이트하는 프로세스도 안정화됐습니다.
- 다음 단계에서는 지역별 세금이나 배송비 계산을 엮고 싶은데, 혹시 비슷한 환경에서 통화와 세금을 어떻게 다루시는지 알려주시면 감사하겠습니다!

# Reference
- https://react.dev/reference/react/createContext
- https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number/toLocaleString

# 연결문서
- [NICE 본인인증 팝업을 Next.js에서 안전하게 다루기](/post/nice-bonninninjeung-pabeobeul-next-jseseo-anjeonhage-darugi)
- [네트워크 흔들릴 때도 프로필 세션을 지키는 useProfileWithRetry 만들기](/post/neteuwokeu-heundeullil-ttaedo-peuropil-sesyeoneul-jikineun-useprofilewithretry-mandeulgi)
- [React Quill 에디터에서 YouTube 링크를 이용한 비디오 삽입 방법](/post/react-quill-editeoeseo-youtube-ringkeureul-iyonghan-bidio-samnip-bangbeop)
