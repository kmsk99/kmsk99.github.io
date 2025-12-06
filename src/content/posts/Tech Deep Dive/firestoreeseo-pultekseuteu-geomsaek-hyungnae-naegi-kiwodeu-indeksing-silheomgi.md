---
tags:
  - Engineering
  - TechDeepDive
  - Firestore
  - Firebase
  - Backend
title: 'Firestore에서 풀텍스트 검색 흉내 내기, 키워드 인덱싱 실험기'
created: '2025-10-09 09:30'
modified: '2025-10-09 09:30'
---

# Intro
- Firestore만으로 글로벌 쇼핑몰 검색을 구현하려니 막막했어요. Algolia나 ElasticSearch를 붙일 예산은 없고, 그렇다고 `where("name", ">=", query)` 같은 편법은 다국어 데이터를 만나면 바로 깨지더라고요.
- 저는 결국 “직접 키워드를 뽑아 던져 넣자”라는 결론에 도달했고, 삽질 끝에 현재 구조를 만들었습니다. 공감하실 분 분명 있죠?

## 핵심 아이디어 요약
- Firestore 문서에 검색 전용 `keywords` 배열을 저장하고, `array-contains`를 활용해 1차 필터링을 수행합니다.
- 문자열 필드들을 수집해 특수문자와 공백을 제거한 뒤, 2~10글자짜리 n-gram을 만들어 인덱스를 채웠습니다.
- 첫 번째 키워드로 서버 쿼리를 날리고, 나머지는 클라이언트에서 후처리하여 Firestore의 복합 조건 제한을 우회합니다.

## 준비와 선택
- Firestore는 `OR`, `LIKE` 연산을 지원하지 않아서 인덱스를 직접 만들어야 했습니다. 저는 `extractStringFields`로 문자열, 문자열 배열 필드를 긁어와 `createKeywords`로 변환해 저장했어요.
- 텍스트 전처리는 정규식을 사용해 `cleaningText` 함수에 맡겼습니다. 언어별 모양이 달라도 알파벳과 숫자만 남도록 정리해 검색 안정성을 확보했습니다.
- 설계 전에는 GPT에게 “Firestore에서 multiple array-contains를 조합하면 어떤 한계가 있나?”를 물었고, 첫 번째 조건만 쿼리에 쓰고 나머지는 앱에서 필터링한다는 전략을 세웠습니다.

## 구현 여정
1. **텍스트 정규화 함수 만들기**  
   Firestore가 대소문자 구분을 하기 때문에, 먼저 모든 입력을 소문자+알파벳만 남기도록 정리했습니다.
   ```ts
   // src/utils/utils.ts
   export const cleaningText = (text: string): string => {
     const regEx = /[`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\\/ ]/gim;
     return text.replace(regEx, "").toLowerCase();
   };
   ```
   이 함수 덕분에 `화이트 셔츠`와 `white-shirt`가 같은 키워드로 합쳐졌어요.

2. **n-gram 키워드 생성**  
   `createKeywords`는 문자열 배열을 받아 2글자 이상 10글자 이하의 모든 부분 문자열을 Set으로 모읍니다.
   ```ts
   // src/utils/utils.ts
   export const createKeywords = (texts: string[]): string[] => {
     const keywords = new Set<string>();
     texts.forEach((text) => {
       const cleanText = cleaningText(text);
       for (let i = 0; i < cleanText.length; i++) {
         let temp = "";
         for (let j = i; j < cleanText.length && j < i + 11; j++) {
           temp += cleanText[j];
           if (temp.length >= 2) keywords.add(temp);
         }
       }
     });
     return Array.from(keywords);
   };
   ```
   처음엔 1글자 키워드도 넣었는데, “a”, “e” 같은 값으로 컬렉션이 뒤덮여서 쿼리 속도가 떨어졌습니다. 그래서 현재처럼 길이를 제한했어요.

3. **문서 저장 시 키워드 주입**  
   상품을 추가하거나 업데이트할 때, 문자열 필드만 추려서 키워드를 생성한 뒤 Firestore에 저장합니다.
   ```ts
   // src/utils/firebase/mutation.ts
   const stringFields = extractStringFields(rest);
   const keywords = createKeywords(stringFields);

   await addDoc(collection(db, "products"), {
     ...newProductData,
     keywords,
     createdAt: serverTimestamp(),
   });
   ```
   `extractStringFields`가 문자열 배열까지 펼쳐주기 때문에, 색상이나 스타일 태그도 자동으로 인덱스에 포함됩니다.

4. **쿼리 제한 우회하기**  
   Firestore는 `array-contains`를 여러 개 동시에 쓰지 못합니다. 저는 첫 키워드만 서버에서 걸고, 나머지는 클라이언트에서 필터링했어요.
   ```ts
   // src/utils/firebase/query.ts
   if (filters.keywords && Array.isArray(filters.keywords)) {
     productsQuery = query(
       productsQuery,
       where("keywords", "array-contains", cleaningText(filters.keywords[0]))
     );
   }

   const snapshot = await getDocs(productsQuery);
   let products = snapshot.docs.map((doc) => ({ ...doc.data(), productId: doc.id }));

   if (filters.keywords.length > 1) {
     const additionalKeywords = filters.keywords.slice(1);
     products = products.filter((product) =>
       additionalKeywords.every((keyword: string) =>
         product.keywords.includes(cleaningText(keyword))
       )
     );
   }
   ```
   덕분에 “oversized blazer black”처럼 여러 단어를 입력해도 꽤 쓸 만한 결과를 보여줄 수 있습니다. 물론 완벽한 풀텍스트 검색은 아니지만, MVP 단계에서는 충분했어요.

5. **키워드 샘플링으로 정렬 보정**  
   `extractFromKeywords`라는 헬퍼로 키워드 중 일부를 고르게 뽑아 노출 순서를 조정했습니다. 검색 결과 추천 키워드를 만들 때 균형 있게 분포시키는 데 도움을 줬습니다.

## 결과와 회고
- 인덱스를 직접 뽑아 넣었더니 Firestore만으로도 다국어 검색이 돌아가기 시작했고, “검색 왜 안 되죠?”라는 문의가 크게 줄었습니다.
- 다만 문서가 많아질수록 키워드 배열이 커지는 점이 숙제로 남았어요. 앞으로는 인기 있는 키워드만 남기거나, Cloud Functions로 인덱스를 주기적으로 다듬는 실험을 해보려고 합니다.
- 혹시 Firestore 기반 검색을 다른 방식으로 풀어본 적이 있다면 댓글로 경험을 공유해 주세요. 서로의 시행착오를 줄여봅시다!

# Reference
- https://firebase.google.com/docs/firestore/query-data/queries
- https://firebase.google.com/docs/firestore/solutions/search

# 연결문서
- [[Firebase에서 검색 기능 구현하기 - 삽질 끝에 찾은 해결책]]
- [[Firestore 장바구니 동기화에서 배운 방어적 패턴]]
- [[Firebase에서 검색 기능 구현하기]]
