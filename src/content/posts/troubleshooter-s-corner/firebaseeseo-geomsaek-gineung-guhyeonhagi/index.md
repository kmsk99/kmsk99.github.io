---
tags:
  - Engineering
  - IssueNote
  - Firebase
  - Firestore
  - Backend
title: Firebase에서 검색 기능 구현하기
created: '2023-12-22 03:15'
modified: '2023-12-22 03:50'
slug: firebaseeseo-geomsaek-gineung-guhyeonhagi
---

# Intro

firebase 에서는 부분 문자열을 통해서 문자열을 검색할수 있는 기능이 없다. 이로 인해서 검색을 구현할 떄에는 완벽히 똑같은 문자열을 통해 검색하거나, 외부 라이브러리를 써야한다. 그러나 firebase 내에서도 부분 문자열을 통한 검색이 구현 가능하다.

![](../../../assets/ed4e8c13-7fc57f407f52c889ef07bbc1a0b960a3-md5.png)

이와 같이 미리 가능한 모든 키워드 조합을 만들어내어 Array 에 저장하는 방법이다.

# 구현 방법

```js
/**
 * 주어진 텍스트에서 특수 문자와 공백을 제거합니다.
 * @param {string} text - 처리할 문자열
 * @returns {string} 처리된 문자열
 */
export const cleaningText = (text: string): string => {
  // 특수문자 및 공백 제거, 다양한 언어 지원
  const regEx = /[`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\\/ ]/gim;

  const cleanText = text.replace(regEx, "").toLowerCase();

  return cleanText;
};

/**
 * 주어진 텍스트 배열로부터 키워드를 생성합니다.
 * @param {string[]} texts - 키워드를 생성할 텍스트 배열
 * @returns {string[]} 생성된 키워드 배열
 */
export const createKeywords = (texts: string[]): string[] => {
  const keywords = new Set<string>();

  texts.forEach((text) => {
    // 특수문자 및 공백 제거, 다양한 언어 지원
    const cleanText = cleaningText(text);

    const length = cleanText.length;

    // 모든 가능한 2글자 이상, 10글자 이하의 부분 문자열을 생성
    for (let i = 0; i < length; i++) {
      let temp = "";
      for (let j = i; j < length && j < i + 11; j++) {
        temp += cleanText[j];
        if (temp.length >= 2) {
          keywords.add(temp);
        }
      }
    }
  });

  return Array.from(keywords);
};
```

위와 같이 text 배열을 입력으로 받아, 2 글자 이상, 10 글자 이하인 부분 문자열을 생성해준다.

```js
// 키워드 생성
const keywords = createKeywords(stringFields);
```

이러한 함수를 통해 부분 키워드 집합을 생성하는 것이 가능하다.

```js
export const getProducts = async (
  startAfterDoc: DocumentSnapshot | null,
  limitNumber = 10,
  filters: any = {},
  order: {
    field: string;
    direction: "asc" | "desc";
  } = { field: "name", direction: "asc" }
): Promise<{
  products: Product[];
  lastVisible: DocumentSnapshot | null;
  hasMore: boolean;
}> => {
  try {
    const productsRef = collection(db, "products");
    let productsQuery = query(productsRef);

    // 필터링 옵션 적용
    for (const [field, value] of Object.entries(filters)) {
      if (field === "keywords" && typeof value === "string") {
        // 키워드 필드에 대한 필터링
        productsQuery = query(
          productsQuery,
          where(field, "array-contains", cleaningText(value))
        );
      } else if (
        field === "keywords" &&
        Array.isArray(value) &&
        value.length > 0
      ) {
        const firstKeyword = value[0];
        productsQuery = query(
          productsQuery,
          where("keywords", "array-contains", cleaningText(firstKeyword))
        );
      }

    // 페이지네이션 적용
    if (startAfterDoc) {
      productsQuery = query(productsQuery, startAfter(startAfterDoc));
    }
    productsQuery = query(productsQuery, limit(limitNumber));

    // Firestore에서 쿼리에 맞는 데이터를 조회합니다.
    const snapshot = await getDocs(productsQuery);
    let products: Product[] = [];
    snapshot.forEach((doc) => {
      products.push({ ...doc.data(), productId: doc.id } as Product);
    });

    // 클라이언트 측에서 추가 키워드 필터링
    if (
      filters.keywords &&
      Array.isArray(filters.keywords) &&
      filters.keywords.length > 1
    ) {
      const additionalKeywords = filters.keywords.slice(1);
      products = products.filter((product) =>
        additionalKeywords.every((keyword: string) =>
          product.keywords.includes(cleaningText(keyword))
        )
      );
    }

    const lastVisible = snapshot.docs[snapshot.docs.length - 1] || null;
    const hasMore = snapshot.docs.length === limitNumber;
    return { products, lastVisible, hasMore };
  } catch (err) {
    console.error(err);
    return { products: [], lastVisible: null, hasMore: false };
  }
};
```

다중 키워드의 AND 연산은 Firebase 에서 지원하지 않아, 첫 키워드를 통한 쿼리 이후, 클라이언트 측에서 필터링을 해준다.
만일 OR 연산이 필요하다면 클라이언트 측 필터링을 없애고, "array-contains-any" 를 통해 필터링이 가능하다

## 사용 후기

firebase 자체가 백엔드를 직접구축할 필요가 없다는 장점이 있지만, 이러한 기본적인 문자열 쿼리도 지원하지 않는다는 것이 상당한 단점으로 느껴진다.

실제 외주 프로젝트나 간단한 앱도 firebase 로 구현해보았지만, 사용량 이슈와 이러한 불편점등으로 인해서 앞으로 firebase 를 실제 운영 서버로 사용할 일은 없을 듯 하다.

# Reference

https://mingeesuh.tistory.com/entry/Firebase-%EC%9B%B9-%ED%8C%8C%EC%9D%B4%EC%96%B4%EC%8A%A4%ED%86%A0%EC%96%B4-%EA%B2%80%EC%83%89-%EA%B8%B0%EB%8A%A5-%EA%B5%AC%ED%98%84%ED%95%98%EA%B8%B0feat-%EC%BF%BC%EB%A6%AC%EB%AC%B8-Algolia

# 연결문서
- [[Firebase에서 검색 기능 구현하기 - 삽질 끝에 찾은 해결책]]
- [[Firestore 장바구니 동기화에서 배운 방어적 패턴]]
- [[Firestore에서 풀텍스트 검색 흉내 내기, 키워드 인덱싱 실험기]]
