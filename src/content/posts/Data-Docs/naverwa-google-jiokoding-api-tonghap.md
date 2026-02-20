---
tags:
  - Geocoding
  - Naver
  - Google
  - API
  - Next.js
title: Naver와 Google 지오코딩 API 통합
created: '2025-11-11'
modified: '2025-11-12'
---

# 배경

위치 기반 앱에서 구역을 등록할 때 좌표만 있고 주소가 없는 경우, 또는 주소만 있고 좌표가 없는 경우가 빈번하다. 국내 데이터는 Naver Maps Geocoding API가 정확하고, 해외 데이터는 Google Maps Geocoding API를 써야 한다. 두 API를 통합하여 좌표 기반으로 자동 프로바이더 선택, 점진적 주소 검색, 역지오코딩을 처리하는 레이어를 구축했다.

# API 프록시 구조

외부 지도 API의 시크릿 키를 클라이언트에 노출하지 않기 위해, Next.js API Route를 프록시로 사용한다.

```
클라이언트 → /api/geocoding → Naver or Google
클라이언트 → /api/reverse-geocoding → Naver or Google
```

## 지오코딩 Route Handler

```ts
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query');
  const provider = searchParams.get('provider') || 'naver';

  if (!query) {
    return NextResponse.json(
      { error: '검색할 주소(query)가 필요합니다.' },
      { status: 400 },
    );
  }

  if (provider === 'google') {
    const data = await fetchGoogleGeocoding(query, language);
    return NextResponse.json(data);
  }

  const data = await fetchNaverGeocoding({
    query,
    language: language as 'kor' | 'eng',
    page: parseInt(page, 10),
    count: parseInt(count, 10),
    coordinate: coordinate || undefined,
    filter: filterParam,
  });

  return NextResponse.json(data);
}
```

Naver API는 페이지네이션(`page`, `count`)과 좌표 기반 정렬(`coordinate`), 행정코드 필터(`filter`)를 지원한다. Google API는 `language`만 받는다.

## 역지오코딩 Route Handler

```ts
export async function GET(request: NextRequest) {
  const coords = searchParams.get('coords');
  const provider = searchParams.get('provider') || 'naver';

  if (!coords) {
    return NextResponse.json(
      { error: '좌표(coords)가 필요합니다. 예: coords=127.585,34.9765' },
      { status: 400 },
    );
  }

  const coordsPattern = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;
  if (!coordsPattern.test(coords)) {
    return NextResponse.json(
      { error: '좌표 형식이 올바르지 않습니다. 형식: "경도,위도"' },
      { status: 400 },
    );
  }

  if (provider === 'google') {
    const data = await fetchGoogleReverseGeocoding(coords);
    return NextResponse.json(data);
  }

  const data = await fetchNaverReverseGeocoding({
    coords,
    sourcecrs: sourcecrsParam,
    targetcrs: targetcrsParam,
    orders: ordersParam,
    output: outputParam,
  });

  return NextResponse.json(data);
}
```

Naver 역지오코딩은 좌표계 변환(`sourcecrs`, `targetcrs`)과 결과 타입 선택(`orders`: `legalcode`, `admcode`, `addr`, `roadaddr`)을 세밀하게 제어할 수 있다.

# 점진적 주소 검색

공공데이터의 주소는 "서울특별시 성북구 왕산로 4(신설동) 옥상"처럼 부가 정보가 붙어 있는 경우가 많아 정확히 매칭되지 않는다. 이를 위해 점진적으로 주소를 간소화하면서 검색하는 `searchAddressProgressive`를 구현했다.

```ts
export const searchAddressProgressive = async (
  fullAddress: string,
  language: 'kor' | 'eng' = 'kor',
): Promise<Address | null> => {
  const addressParts = fullAddress.trim().split(/\s+/);

  // 1단계: 시도/시군구를 제거하고 도로명만으로 검색
  if (addressParts.length > 2) {
    const roadNameParts = addressParts.slice(2);

    for (let i = roadNameParts.length; i > 0; i--) {
      const currentQuery = roadNameParts.slice(0, i).join(' ');

      const queriesToTry = [currentQuery];
      if (currentQuery.includes('(')) {
        const withoutParentheses = currentQuery
          .replace(/\([^)]*\)/g, '')
          .replace(/（[^）]*）/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (withoutParentheses !== currentQuery) {
          queriesToTry.push(withoutParentheses);
        }
      }

      for (const query of queriesToTry) {
        const result = await searchFirstAddress(query, language);
        if (result && geocodingUtils.isValidAddress(result)) {
          return result;
        }
      }
    }
  }

  // 2단계: 전체 주소에서 뒤부터 단어를 줄이면서 검색
  for (let i = addressParts.length; i > 0; i--) {
    const currentQuery = addressParts.slice(0, i).join(' ');

    const queriesToTry = [currentQuery];
    if (currentQuery.includes('(')) {
      const withoutParentheses = currentQuery
        .replace(/\([^)]*\)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (withoutParentheses !== currentQuery) {
        queriesToTry.push(withoutParentheses);
      }
    }

    for (const query of queriesToTry) {
      const result = await searchFirstAddress(query, language);
      if (result && geocodingUtils.isValidAddress(result)) {
        return result;
      }
    }
  }

  return null;
};
```

검색 전략:
1. 앞 두 단어(시도, 시군구)를 제거해 도로명 주소만 남긴다. Naver API가 "왕산로 4"처럼 간결한 도로명에 더 잘 반응하는 경우가 많다.
2. 도로명에서도 뒤부터 단어를 줄인다: "왕산로 4 옥상" → "왕산로 4" → "왕산로"
3. 각 단계에서 괄호를 제거한 버전도 함께 시도한다: "왕산로 4(신설동)" → "왕산로 4"
4. 모두 실패하면 전체 주소로 동일한 과정을 반복한다.

이 함수를 기반으로 좌표 변환과 다중 주소 검색을 구현했다.

```ts
export const getCoordinatesFromAddress = async (
  address: string,
): Promise<Coordinates | null> => {
  const result = await searchAddressProgressive(address);
  if (!result) return null;

  return {
    longitude: parseFloat(result.x),
    latitude: parseFloat(result.y),
  };
};

export const searchMultipleAddressesProgressive = async (
  fullAddresses: string[],
): Promise<(Address | null)[]> => {
  return Promise.all(
    fullAddresses.map(address => searchAddressProgressive(address)),
  );
};
```

# 역지오코딩

좌표로부터 주소를 가져올 때는 프로바이더 자동 선택이 중요하다.

## 관리자 패널 (Next.js)

```ts
export const getAddressFromCoords = async (
  lng: number, lat: number,
): Promise<string | null> => {
  const result = await reverseGeocode({
    coords: `${lng},${lat}`,
    orders: 'roadaddr,addr',
  });

  const items = result?.results ?? [];
  for (const item of items) {
    const region = item.region;
    const land = item.land;

    if (land?.name) {
      return `${region.area1.name} ${region.area2.name} ${land.name} ${land.number1}`;
    }
  }

  return null;
};
```

Naver 역지오코딩의 `orders` 파라미터로 도로명주소(`roadaddr`)를 우선 반환하도록 설정한다.

국내 좌표에는 Naver를, 해외 좌표에는 Google을 사용해야 하므로 좌표 기반 분기를 처리한다.

```ts
// 대한민국 대략적 경계 (완전히 벗어나면 국내가 아님)
const isInSouthKorea = (lng: number, lat: number) =>
  lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;

if (isInSouthKorea(lng, lat)) {
  return getAddressFromCoords(lng, lat);
} else {
  return getAddressFromCoordsGoogle(lng, lat);
}
```

## 모바일 앱 (React Native)

앱에서는 Edge Function을 통해 역지오코딩을 호출한다. `getGeocodingProviderByCoords`로 좌표가 국내인지 판별한 뒤 프로바이더를 결정한다.

```ts
export const getAddressFromCoordsByProvider = async (
  lng: number, lat: number,
): Promise<string | null> => {
  const provider = getGeocodingProviderByCoords(lng, lat);

  if (provider === 'google') {
    return getAddressFromCoordsGoogle(lng, lat);
  }

  return getAddressFromCoordsNaver(lng, lat);
};
```

`makeAuthenticatedApiRequest`를 통해 인증 토큰을 자동으로 포함하므로, API Route에서 비인가 요청을 차단할 수 있다.

# 국가 코드 추출

구역 등록 시 좌표로부터 국가 코드를 결정해야 하는 경우, Google Reverse Geocoding의 `address_components`에서 `country` 타입을 찾아 ISO 3166-1 alpha-2 코드를 추출한다.

```ts
export const getCountryCodeFromCoordsGoogle = async (
  lng: number, lat: number,
): Promise<Iso3166_1Alpha2 | null> => {
  const response = await reverseGeocodeGoogle(`${lng},${lat}`);

  if (response.status !== 'OK' || !response.results?.length) return null;

  for (const result of response.results) {
    for (const component of result.address_components) {
      if (component.types.includes('country')) {
        return normalizeIso3166_1Alpha2(component.short_name);
      }
    }
  }

  return null;
};
```

`normalizeIso3166_1Alpha2`로 "KR", "JP" 같은 코드를 정규화한다. 이 값은 구역의 `country_code` 필드에 저장되어 국가별 필터링에 사용된다.

# 주변 주소 검색과 필터링

중심 좌표 기반으로 주변 주소를 검색하는 기능과, 행정코드 필터를 이용한 정밀 검색도 지원한다.

```ts
export const searchNearbyAddresses = async (
  query: string,
  centerCoordinates: Coordinates,
  count: number = 10,
): Promise<Address[]> => {
  const coordinate = `${centerCoordinates.longitude},${centerCoordinates.latitude}`;

  const response = await searchAddress({ query, coordinate, count });
  return response.addresses;
};

export const searchAddressWithFilter = async (
  query: string,
  filterType: 'HCODE' | 'BCODE',
  codes: string[],
): Promise<Address[]> => {
  const filter = `${filterType}@${codes.join(';')}`;
  const response = await searchAddress({ query, filter });
  return response.addresses;
};
```

`coordinate` 파라미터를 전달하면 Naver API가 해당 좌표에 가까운 결과를 우선 반환한다. `HCODE`(행정동 코드)나 `BCODE`(법정동 코드) 필터로 특정 행정구역 내 결과만 가져올 수 있다.

# 결과

지오코딩 레이어를 통합하면서 얻은 이점:
- API 키를 Server-side에서 관리해 클라이언트 노출을 방지한다
- 좌표 기반 자동 프로바이더 선택으로 국내/해외 주소를 모두 처리한다
- 점진적 검색으로 부정확한 공공데이터 주소도 높은 확률로 매칭한다
- 한영 괄호, 부가 설명 등을 자동으로 제거해 검색 성공률을 높인다
- 통일된 인터페이스로 Naver, Google 두 가지 지도 API를 사용한다

# Reference

- https://api.ncloud-docs.com/docs/ai-naver-mapsgeocoding
- https://developers.google.com/maps/documentation/geocoding

# 연결문서

- [PostGIS RPC로 구역 저장과 공간 조회](/post/postgis-rpcro-guyeok-jeojanggwa-gonggan-johoe)
- [공공데이터 위치 정보 전처리](/post/gonggongdeiteo-wichi-jeongbo-jeoncheori)
- [네이버 지도 SDK로 매장 지도 구현](/post/neibeo-jido-sdkro-maejang-jido-guhyeon)
- [Firebase 서버리스 위치 기반 앱 구현](/post/firebase-seobeoriseu-wichi-giban-aep-guhyeon)
