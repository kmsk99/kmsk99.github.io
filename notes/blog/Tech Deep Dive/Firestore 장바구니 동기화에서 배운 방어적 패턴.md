---
tags:
  - Engineering
  - TechDeepDive
  - Firestore
  - Firebase
  - NextJS
  - Payment
  - Backend
  - Frontend
title: Firestore 장바구니 동기화에서 배운 방어적 패턴
created: 2025-10-09 10:30
modified: 2025-10-09 10:30
uploaded: "false"
---

# Intro
- 실시간 장바구니가 들쑥날쑥하면 고객 지원 팀이 고생하고, 개발자도 밤샘하게 되죠. 저는 최근 Firestore 기반 쇼핑몰을 다루면서 “장바구니 수량이 왜 갑자기 0이 되나요?” 같은 티켓을 여러 건 받았고, 덕분에 데이터를 지키는 방어 패턴을 차근차근 정리했습니다.
- 이 글은 제가 Firestore와 Next.js 환경에서 장바구니를 설계하면서 얻게 된 삽질 메모를 공유하려고 합니다.

## 핵심 아이디어 요약
- 사용자 문서가 없더라도 `initializeCart`와 `initializePoint`로 기본 스키마를 즉시 만들어 둡니다.
- `addCartItem`, `updateCartItemQuantity` 등 모든 변동 함수는 제품 상태와 옵션 유효성을 먼저 검증한 뒤에야 Firestore를 수정합니다.
- 주문, 품절, 헤더 배지까지 이어지는 흐름을 `updateCart`와 `watchCart`로 연결해 항상 합계를 재계산하고 UI를 동기화합니다.

## 준비와 선택
- Firestore는 다중 문서 트랜잭션을 지원하지만, 이번 프로젝트는 클라이언트 SDK만 사용했습니다. 그래서 각 단계마다 실패 가능성을 줄이는 체크 로직이 필수였어요.
- 상품 정보는 `products` 컬렉션, 장바구니는 `carts`, 주문은 `orders`에 따로 저장되어 있습니다. 컬렉션이 나뉘어 있는 만큼 정합성을 맞출 도구가 필요했죠.
- 작업 전 GPT에게 “Firestore에서 카트 아이템 업데이트를 idempotent하게 만들려면 어떤 패턴이 쓸 만할까요?”라고 물었고, `arrayRemove`와 `arrayUnion`을 조합해 덮어쓰는 방식이 좋다는 힌트를 얻었습니다.

## 구현 여정
1. **카트 초기화로 빈 문서 방지**  
   로그인 직후 카트를 찾을 수 없다면 문서를 생성해 기본 구조를 채웁니다.
   ```ts
   // src/utils/firebase/mutation.ts
   export const initializeCart = async (userId: string) => {
     await setDoc(doc(db, "carts", userId), {
       items: [],
       totalOriginalPrice: 0,
       totalDiscountedPrice: 0,
       subtotal: 0,
       appliedCoupons: [],
       totalFinalPrice: 0,
       shippingFee: 0,
     });
   };
   ```
   이렇게 해두면 이후 계산 로직에서 `cartDoc.exists()` 체크를 반복하지 않아도 됩니다. 포인트 역시 `initializePoint`로 동일한 패턴을 유지했어요.

2. **항목 추가 전에 유효성 검사**  
   제품이 품절인지, 사이즈/색상 옵션이 맞는지, 사용자 입력이 빠지지 않았는지 확인합니다.
   ```ts
   // src/utils/firebase/mutation.ts
   export const addCartItem = async (userId: string, cartItem: Pick<CartItem, "productId" | "quantity" | "size" | "color">) => {
     const cartRef = doc(db, "carts", userId);
     let cartDoc = await getDoc(cartRef);
     if (!cartDoc.exists()) {
       await initializeCart(userId);
       cartDoc = await getDoc(cartRef);
     }
     const product = await getProduct(cartItem.productId);
     if (!product || product.isSoldOut) {
       errorMessage("Product is sold out! ❌");
       return false;
     }
     if (product.sizes.length && !cartItem.size) {
       errorMessage("Size not selected! ❌");
       return false;
     }
     if (product.color?.length && !cartItem.color) {
       errorMessage("Color not selected! ❌");
       return false;
     }
     // 이후 arrayUnion으로 항목 추가
   };
   ```
   조건을 통과하지 못하면 Firestore를 건드리지 않고 즉시 종료합니다. 현장에서 이 체크 하나로 티켓이 절반으로 줄었어요.

3. **재계산을 한 곳에 모으기**  
   카트가 변할 때마다 합계, 할인, 배송비를 한꺼번에 갱신해 UI가 항상 일관된 금액을 보여주도록 했습니다.
   ```ts
   // src/utils/firebase/mutation.ts
   export const updateCart = async (userId: string) => {
     const cartRef = doc(db, "carts", userId);
     let cartDoc = await getDoc(cartRef);
     if (!cartDoc.exists()) {
       await initializeCart(userId);
       cartDoc = await getDoc(cartRef);
     }
     const cart = cartDoc.data() as Cart;
     const totalOriginalPrice = cart.items.reduce((acc, item) => acc + item.price * item.quantity, 0);
     const totalDiscountedPrice = cart.items.reduce((acc, item) => acc + item.discountedPrice * item.quantity, 0);
     const shippingFee = cart.items.reduce(
       (acc, item) => acc + (typeof item.shippingFee === "number" ? item.shippingFee : 0) * (item.quantity > 0 ? 1 : 0),
       0
     );
     await updateDoc(cartRef, {
       totalOriginalPrice,
       totalDiscountedPrice,
       subtotal: totalDiscountedPrice,
       totalFinalPrice: totalDiscountedPrice + shippingFee,
       shippingFee,
     });
   };
   ```
   덕분에 주문 페이지, 헤더 배지, 장바구니 요약이 전부 같은 수치를 표시합니다. 계산 로직이 한 곳에 있기 때문에 테스트도 쉬웠습니다.

4. **품절 처리와 헤더 알림 동기화**  
   품절된 상품은 모든 카트에서 수량을 0으로 바꿔 알림을 띄웠습니다.
   ```ts
   // src/utils/firebase/mutation.ts
   export const updateSoldOutProduct = async (productId: string, isSoldOut: boolean) => {
     await updateDoc(doc(db, "products", productId), { isSoldOut });
     const q = query(collection(db, "carts"));
     const snapshot = await getDocs(q);
     snapshot.forEach(async (cart) => {
       const cartData = cart.data() as Cart;
       const existing = cartData.items.find((item) => item.productId === productId);
       if (existing) {
         await updateDoc(doc(db, "carts", cart.id), { items: arrayRemove(existing) });
         await updateDoc(doc(db, "carts", cart.id), { items: arrayUnion({ ...existing, quantity: 0 }) });
       }
     });
     successMessage("Sold out product updated! 🎉");
   };
   ```
   고객 입장에서는 갑자기 품절된 상품이 사라지는 대신, 장바구니에서 “수량 0”으로 표시돼 상황을 이해하기 쉬웠습니다.

5. **실시간 구독으로 헤더 뱃지 유지**  
   헤더에서는 `watchCart`를 활용해 장바구니 상태를 구독하고, 토글 버튼에 뱃지를 띄웁니다.
   ```ts
   // src/utils/firebase/query.ts
   export const watchCart = (userId: string, setCart: Dispatch<SetStateAction<Cart | null>>) => {
     const docRef = doc(db, "carts", userId);
     return onSnapshot(docRef, (docSnap) => {
       setCart(docSnap.exists() ? (docSnap.data() as Cart) : null);
     });
   };
   ```
   이 실시간 업데이트 덕분에 고객이 다른 탭에서 장바구니를 수정해도 헤더 뱃지가 즉시 반영됩니다.

6. **주문 생성과 카트 비우기**  
   주문이 성공하면 `addOrder`에서 카트 정보를 스냅샷 형태로 저장하고, 쿠폰·포인트 내역을 바로 업데이트합니다. 모든 작업이 끝나면 카트를 다시 초기화해 중복 결제를 방지했어요.

## 결과와 회고
- 방어적인 검증과 재계산을 도입한 뒤로 “장바구니 총액이 이상해요” 같은 문의가 거의 사라졌고, 품절 처리도 자연스러워졌습니다.
- Firestore 문서 수가 늘어나도 동일한 패턴으로 확장할 수 있어서 운영 측면에서도 안심이 되더라고요.
- 다음에는 Cloud Functions로 서버 사이드 검증을 추가해보고 싶은데, 혹시 Firestore 기반 장바구니를 다른 방식으로 안정화시킨 경험이 있다면 알려주세요. 서로의 노하우를 합쳐봅시다!

# Reference
- https://firebase.google.com/docs/firestore/manage-data/add-data
- https://firebase.google.com/docs/firestore/manage-data/transactions

# 연결문서
- [[App Router에서 Firebase Auth로 관리자 접근을 지키는 방법]]
- [[Bearer 토큰을 Supabase 쿠키로 바꿔주는 Next.js 서버 클라이언트]]
- [[Firebase에서 검색 기능 구현하기 - 삽질 끝에 찾은 해결책]]
