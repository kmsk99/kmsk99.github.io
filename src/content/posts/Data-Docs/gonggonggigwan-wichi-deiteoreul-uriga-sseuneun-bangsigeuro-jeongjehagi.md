---
tags:
  - DataCleaning
  - Geo
  - CSV
  - Automation
  - Firebase
  - ReactNative
title: 공공기관 위치 데이터를 우리가 쓰는 방식으로 정제하기
created: '2025-10-09 11:00'
modified: '2025-10-09 15:15'
---

# Intro
3년 전 저는 각 지자체에서 제공하는 공공시설 위치 CSV를 받아 보고 깜짝 놀랐습니다. 컬럼 이름은 제각각이고 좌표는 WGS84와 TM 좌표가 뒤섞여 있었죠. 게다가 사용자 제보로 들어오는 위치는 주소도, 위도·경도도 빠져 있는 경우가 많아 결국 지도에 찍을 수가 없었습니다. "이걸 누가 다 정리해?" 싶은 순간이었는데, 결국 제가 했습니다. 비슷한 데이터 정제 지옥을 겪고 있다면 그때의 삽질 기록이 도움이 될지도 모르겠습니다.

## 핵심 아이디어 요약
1. 관리자 전용 CSV 업로드 화면에서 스키마를 강제하고, 잘못된 형식이 들어올 여지를 줄였습니다.
2. 문자열 필드를 일관된 enum으로 변환해 프론트/백 모두에서 타입 안정성을 확보했습니다.
3. 사용자 제보는 지오코딩을 자동화하고 Firestore에 쓰기 전에 중복 검사를 수행해 데이터 품질을 유지했습니다.

## 준비와 선택
- 파일 업로드는 Expo `DocumentPicker` + `FileSystem` 조합으로 충분했습니다. 당시에 다뤘던 행 수가 1,700건 수준이라 굳이 서버를 거치지 않아도 됐습니다.
- CSV 파싱은 `react-native-csv`를 사용했습니다. PapaParse API와 같아서 온보딩 비용이 거의 없었습니다.
- 주소/좌표 변환은 Vworld와 Naver Reverse Geocoding API를 비교한 끝에, 좌표 기반 주문이 많은 우리 서비스에 Naver 응답 구조가 더 적합했습니다.

## 구현 여정

### Step 1. CSV 업로드 파이프라인 구축
관리자 메뉴에 `BatchUpload` 스크린을 추가했습니다. 파일을 고르면 CSV를 파싱하고 `LocationInfo` 배열로 만들어 넘깁니다.

```ts
// screens/Developer/BatchUpload.tsx
const result = readString(string, {
  header: true,
  dynamicTyping: true,
  skipEmptyLines: true,
});
const locationsInfo = dataArray
  .filter((data) => data.latitude && data.longitude)
  .map((data) => ({
    title: data.title,
    address: data.location,
    latlng: {
      latitude: Number(data.latitude),
      longitude: Number(data.longitude),
    },
  }));
```

CSV 헤더를 강제로 맞춰야 해서, 각 지자체 데이터는 미리 스크립트로 컬럼명을 통일한 뒤 업로드했습니다. 그래도 한 번씩 콤마가 들어간 메모 때문에 파서가 깨지곤 해서, 문제 파일은 `"`로 감싸도록 사전에 규칙을 정했습니다.

### Step 2. 문자열을 Enum으로 치환
데이터마다 "실내/실외", "공공기관/공공시설"처럼 표현이 제각각이라 문자열을 Enum으로 바꾸는 헬퍼를 만들어 썼습니다.

```ts
// utils/utils.ts
export const convertStringToPlaceType = (placeType: string) => {
  switch (placeType) {
    case "공공기관":
      return PlaceType.publicInstitution;
    // ...중략
    default:
      return PlaceType.etc;
  }
};
```

이 덕분에 필터링 로직이나 클러스터 색상 변경 조건이 훨씬 간단해졌습니다. 말미에 공백이나 특수 문자가 섞인 경우가 많아서 업로드 직전에 트리밍을 의무화했습니다.

### Step 3. 관리자 전용 대량 업로드 API
CSV로 만든 데이터를 Firestore에 쓰는 로직은 `batchUploadLocationInfo`가 담당했습니다.

```ts
// firebase/locationHandler.ts
const { ok: isAdmin } = await checkAdmin(currentUser);
if (!isAdmin) return { ok: false, error: "운영진만 대량 업로드" };
const { ok, data } = await uploadAdminLocationInfo(locationInfo, currentUser);
```

여기서 `uploadAdminLocationInfo`는 기존 위치 반경 5m 내에 중복이 있는지 검사한 뒤 `active`를 `true`로 설정합니다. 공공 데이터만 1,700건이 넘다 보니 비슷한 좌표가 많았고, 이 검사를 빼면 똑같은 위치가 여러 번 등록될 위험이 컸습니다.

### Step 4. 사용자 제보 자동 지오코딩
사용자가 제보할 때는 지도에서 포인트만 찍도록 했습니다. 위도·경도를 받은 뒤 바로 `latLngtoAddressAPI`로 주소를 보강했습니다.

```ts
// utils/api.ts
const response = await fetch(
  `${gcUrl}coords=${latLng.longitude},${latLng.latitude}&sourcecrs=epsg:4326&orders=roadaddr&output=json`,
  {
    headers: {
      "X-NCP-APIGW-API-KEY-ID": clientId,
      "X-NCP-APIGW-API-KEY": clientSecret,
    },
  }
);
```

예상 못 한 문제는 공공 데이터 좌표와 사용자가 찍은 좌표가 5~10m 정도 오차가 날 때가 있다는 겁니다. 반경 5m 중복 검사에 계속 걸려서, 좌표를 소수점 6자리로 반올림해 비교했고 필요한 경우에는 관리자 화면에서 수동 병합 기능을 추가했습니다.

### 시행착오 메모
- 어떤 지자체는 위도·경도 대신 지번 주소만 제공했습니다. 이 경우 Kakao Local API로 좌표를 역으로 구한 뒤 Naver API로 정규화했습니다.
- CSV 업로드 중 앱이 백그라운드로 내려가면 작업이 끊기는 문제가 있어 `keepAwake` 옵션으로 화면이 꺼지지 않도록 했습니다.
- 글을 정리하면서 GPT에게 용어를 재확인했지만, 실제 데이터 검증과 변환 로직은 모두 직접 테스트했습니다.

## 결과와 회고
최종적으로 정제한 공공기관 위치 데이터는 약 1,700건, 사용자 제보는 200건 정도였고 모두 Firestore에 안정적으로 안착했습니다. 덕분에 데이터 정제에 쓰던 시간이 하루에 30분 이하로 줄었고, 제보 승인 속도도 크게 빨라졌어요. 3년이 지난 지금은 데이터 포맷이나 API 정책이 조금씩 바뀌었지만, "업로드 파이프라인을 먼저 자동화하자"는 교훈은 여전히 유효합니다. 여러분은 지리 데이터 정제에서 어떤 함정을 만났었나요? 댓글로 서로의 삽질을 공유해요!

# Reference
- https://docs.expo.dev/versions/latest/sdk/document-picker/

# 연결문서
- [Deep Link Friendly Redirect Validation을 구현하며 배운 보안 체크리스트](/post/deep-link-friendly-redirect-validationeul-guhyeonhamyeo-baeun-boan-chekeuriseuteu)
- [Firebase 서버리스 백엔드로 위치 기반 서비스를 굴리는 법](/post/firebase-seobeoriseu-baegendeuro-wichi-giban-seobiseureul-gullineun-beop)
- [React Native 파일 업로드 파이프라인을 정리한 기록](/post/react-native-pail-eomnodeu-paipeuraineul-jeongnihan-girok)
