---
tags:
  - Firebase
  - Firestore
  - Serverless
  - ReactNative
  - Maps
  - Backend
title: Firebase 서버리스 위치 기반 앱 구현
created: 2023-03-09 10:00
modified: 2023-03-09 15:10
---

# 문제

3년 전, 위치 기반 찾기·제보 앱을 만들고 있었다. 지도에서 특정 구역을 찾고, 새 장소를 제보하며, 실내/실외·부가 시설·청결도 같은 상세 정보를 확인하는 서비스다. 처음엔 직접 EC2에 REST API를 올리는 쪽을 고민했는데, 야근 끝에 로그를 뒤지다 보니 "굳이 서버를 굴려야 하나?"라는 생각이 확 스쳤다. 사용자 제보, 공공데이터, 이미지 업로드까지 모두 실시간으로 받아야 하는데 운영 인력은 혼자였다. Firebase 조합으로 완전 서버리스하게 가도 되겠다는 확신이 들었다. 지금은 SDK도 많이 바뀌었지만, 당시의 선택과 삽질은 여전히 아키텍처 판단 기준이 되어 주고 있다.

# 설계

1. Firestore 컬렉션을 역할별로 나눠 서버리스 환경에서도 데이터 무결성을 확보했다.
2. `@react-native-firebase` SDK가 제공하는 오프라인 캐시를 활용해 네트워크가 불안한 상황에서도 지도가 버티도록 설계했다.
3. 인증·권한·스토리지를 Firebase 매니지드 서비스에 위임해 1인 개발자의 운영 부담을 최소화했다.

# 구현

Expo bare 워크플로에 `@react-native-firebase/app`, `auth`, `firestore`, `storage` 모듈을 붙여 네이티브 성능과 Firebase 생태계를 동시에 챙겼다. Firestore는 위치 기반 데이터처럼 쓰기 빈도가 높고 스키마가 자주 바뀌는 케이스에 잘 맞았고, 실시간 동기화가 기본이라 선택했다. 역할 기반 제어가 필요해 문서 단위의 `role` 필드와 커스텀 보안 규칙(당시 Rules 버전 2)을 함께 설계했다.

### 컬렉션 스키마와 접근 헬퍼
Firestore 컬렉션을 한 곳에 모아두는 모듈을 만들었다. 서비스 레이어에서는 문자열 컬렉션 이름을 직접 건드리지 않게 해서 유지보수를 쉽게 했다.

```ts
import firestore from "@react-native-firebase/firestore";

export const locationsCollection = firestore().collection("Locations");
export const commentsCollection = firestore().collection("Comments");
export const usersCollection = firestore().collection("Users");
export const reportsCollection = firestore().collection("Reports");
export const locationImagesCollection =
  firestore().collection("LocationImages");
```

이렇게 해 두니 향후 스키마가 바뀌더라도 의존성을 한 곳에서만 조정하면 됐다.

### 문서 기본값 중앙 집중화
사용자 제보나 공공데이터를 받아 Firestore에 넣을 때, 필드가 빠지면 앱 곳곳에서 `undefined` 예외가 터졌다. 그래서 문서를 만들 때 기본값을 모두 세팅하는 헬퍼를 만들었다.

```ts
export const createLocationInfoHolder = (
  locationInfo: LocationInfo,
  currentUser: FirebaseAuthTypes.User,
  active: boolean
): LocationInfo => {
  const location: LocationInfo = {
    uid: currentUser.uid,
    active: active,
    createdAt:
      firestore.FieldValue.serverTimestamp() as FirebaseFirestoreTypes.Timestamp,
    updatedAt:
      firestore.FieldValue.serverTimestamp() as FirebaseFirestoreTypes.Timestamp,
    ...locationInfo,
    locationDetails: {
      ashtray: false,
      cleanScore: 3,
      commentIds: [],
      favoriteUids: [],
      indoor: Indoor.any,
      fireExtinguisher: false,
      placeType: PlaceType.any,
      locationImageIds: [],
      recommendUids: [],
      reportIds: [],
      ...locationInfo.locationDetails,
    },
  };
  return location;
};
```

이 함수 하나 덕분에 이후에는 문서 누락 때문에 생기는 크래시가 거의 사라졌다.

### 역할 기반 관리자 권한
공공데이터 일괄 업로드나 삭제 같은 민감한 작업은 관리자만 할 수 있어야 했다. 그래서 모든 핸들러에서 재사용할 수 있는 `checkAdmin`을 만들었다.

```ts
export const checkAdmin = async (
  currentUser: FirebaseAuthTypes.User
): Promise<CommonOutput<undefined>> => {
  try {
    const { ok, data: userInfo } = await getUserInfo(currentUser);

    if (!ok || !userInfo) return { ok: false };

    if (userInfo.role !== UserRole.admin) return { ok: false };

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.name + ": " + e.message };
  }
};
```

덕분에 대량 업로드 API나 비활성화 관리 기능에서 권한 검사를 빠뜨릴 일이 없었고, Firestore 보안 규칙도 단순하게 유지했다.

### 오프라인 퍼스트 캐시 전략
위치 기반 서비스는 지도가 바로 뜨지 않으면 사용자가 금세 이탈한다. 그래서 Firestore 조회는 모두 `source: "cache"` 옵션을 활용해 로컬 데이터를 먼저 보여주고, 백그라운드에서 네트워크 동기화를 기다렸다.

```ts
export const getBoundaryLocations = async (
  mapBoundary: MapBoundary
): Promise<CommonOutput<LocationInfo[]>> => {
  try {
    const { east, north, south, west } = mapBoundary;
    const locations: LocationInfo[] = [];
    const snapshot = await locationsCollection
      .where("latlng.latitude", "<=", north)
      .where("latlng.latitude", ">=", south)
      .get({ source: "cache" });

    snapshot.forEach((doc) => {
      const location = doc.data() as LocationInfo;
      if (
        location.latlng.longitude <= east &&
        location.latlng.longitude >= west
      ) {
        locations.push({ id: doc.id, ...location });
      }
    });
    return { ok: true, data: locations };
  } catch (e) {
    return { ok: false, error: e.name + ": " + e.message };
  }
};
```

장점은 오프라인에서도 마지막 결과가 곧바로 노출된다는 점이었고, 캐시 만료 시에는 `storeCacheLocations`로 최신 수정 시간만 체크해 전체 싱크 비용을 줄였다.

# 예상 밖 이슈와 해결

Firebase의 `serverTimestamp()`는 비동기로 채워지기 때문에, 문서를 작성하자마자 읽으면 `null`이 반환되곤 했다. UI가 즉시 시간을 필요로 할 때는 클라이언트에서 임시로 `Date.now()`를 써 두고, Firestore가 갱신되면 상태 관리를 통해 UI를 다시 갱신했다. 또 Firebase Auth 초기화가 느릴 때 앱이 흰 화면에 멈추는 일이 있어, Firebase 모듈을 전역에서 초기화하지 않고 각 핸들러 내부에서 지연 로딩하도록 조정했다.

# 결과

당시에는 공공데이터 약 1,700건과 사용자 제보 200건 정도를 Firestore로 처리하면서도 운영비는 0원대에 머물렀다. Cloud Functions로 자동 승인 워크플로를 붙이려다 보안 규칙 개편 이슈 때문에 중단하긴 했지만, 서버 없이도 여기까지 버틴 경험이 큰 자신감이 되었다. 3년이 지난 지금은 Firebase 콘솔 UI도 달라지고 요금제도 개편됐지만, "서버를 추가하기 전에 먼저 서버리스 구성을 검토한다"는 원칙은 여전히 유효하다고 생각한다.

# Reference
- https://rnfirebase.io/
- https://firebase.google.com/docs/firestore
- https://firebase.google.com/docs/auth

# 연결문서
- [[Firebase에서 Supabase로 기술 스택 전환]]
- [[S2 Geometry 기반 서버사이드 지도 클러스터링]]
- [[공공데이터 위치 정보 전처리]]
- [[Next.js App Router + Firebase Auth 관리자 인증]]
- [[Firestore에서 키워드 인덱싱으로 검색 구현하기]]
