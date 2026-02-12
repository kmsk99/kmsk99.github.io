---
tags:
  - Firebase
  - Firestore
  - Serverless
  - ReactNative
  - Maps
  - Backend
title: Firebase 서버리스 백엔드로 위치 기반 서비스를 굴리는 법
created: '2023-03-09 10:00'
modified: '2023-03-09 15:10'
---

# Intro
3년 전, 저는 서울 곳곳의 생활 편의 시설 데이터를 모아 위치 기반 앱을 만들고 있었습니다. 처음엔 직접 EC2에 REST API를 올리는 쪽을 고민했는데, 야근 끝에 로그를 뒤지다 보니 "굳이 서버를 굴려야 하나?"라는 생각이 확 스치더라고요. 사용자 제보, 공공데이터, 이미지 업로드까지 모두 실시간으로 받아야 하는데 운영 인력은 저 혼자. 그때 Firebase 조합으로 완전 서버리스하게 가도 되겠다는 확신이 들었습니다. 지금은 SDK도 많이 바뀌었지만, 당시의 선택과 삽질은 여전히 제 아키텍처 판단 기준이 되어 주고 있습니다.

## 핵심 아이디어 요약
1. Firestore 컬렉션을 역할별로 나눠 서버리스 환경에서도 데이터 무결성을 확보했습니다.
2. `@react-native-firebase` SDK가 제공하는 오프라인 캐시를 활용해 네트워크가 불안한 상황에서도 지도가 버티도록 설계했습니다.
3. 인증·권한·스토리지를 Firebase 매니지드 서비스에 위임해 1인 개발자의 운영 부담을 최소화했습니다.

## 준비와 선택
- Expo bare 워크플로에 `@react-native-firebase/app`, `auth`, `firestore`, `storage` 모듈을 붙여 네이티브 성능과 Firebase 생태계를 동시에 챙겼습니다.
- Firestore는 위치 기반 데이터처럼 쓰기 빈도가 높고 스키마가 자주 바뀌는 케이스에 잘 맞았고, 실시간 동기화가 기본이라 선택했습니다.
- 역할 기반 제어가 필요해 문서 단위의 `role` 필드와 커스텀 보안 규칙(당시 Rules 버전 2)을 함께 설계했습니다.

## 구현 여정

### Step 1. 컬렉션 스키마와 접근 헬퍼 정리
먼저 Firestore 컬렉션을 한 곳에 모아두는 모듈을 만들었습니다. 서비스 레이어에서는 문자열 컬렉션 이름을 직접 건드리지 않게 해서 유지보수를 쉽게 했죠.

```ts
// firebase/fbase.ts
export const locationsCollection = firestore().collection("Locations");
export const commentsCollection = firestore().collection("Comments");
```

이렇게 해 두니 향후 스키마가 바뀌더라도 의존성을 한 곳에서만 조정하면 됐습니다.

### Step 2. 문서 기본값 중앙 집중화
사용자 제보나 공공데이터를 받아 Firestore에 넣을 때, 필드가 빠지면 앱 곳곳에서 `undefined` 예외가 터졌습니다. 그래서 문서를 만들 때 기본값을 모두 세팅하는 헬퍼를 만들었습니다.

```ts
// firebase/locationHandler.ts
const location: LocationInfo = {
  uid: currentUser.uid,
  active: active,
  createdAt: firestore.FieldValue.serverTimestamp(),
  locationDetails: {
    ashtray: false,
    cleanScore: 3,
    commentIds: [],
    // ...기본값 덕분에 프론트에서도 타입 추론이 안정적입니다.
    ...locationInfo.locationDetails,
  },
};
```

이 함수 하나 덕분에 이후에는 문서 누락 때문에 생기는 크래시가 거의 사라졌습니다.

### Step 3. 역할 기반 관리자 권한
공공데이터 일괄 업로드나 삭제 같은 민감한 작업은 관리자만 할 수 있어야 했습니다. 그래서 모든 핸들러에서 재사용할 수 있는 `checkAdmin`을 만들었습니다.

```ts
// firebase/authHandler.ts
const { ok, data: userInfo } = await getUserInfo(currentUser);
if (!ok || userInfo.role !== UserRole.admin) return { ok: false };
```

덕분에 대량 업로드 API나 비활성화 관리 기능에서 권한 검사를 빠뜨릴 일이 없었고, Firestore 보안 규칙도 단순하게 유지했습니다.

### Step 4. 오프라인 퍼스트 캐시 전략
위치 기반 서비스는 지도가 바로 뜨지 않으면 사용자가 금세 이탈합니다. 그래서 Firestore 조회는 모두 `source: "cache"` 옵션을 활용해 로컬 데이터를 먼저 보여주고, 백그라운드에서 네트워크 동기화를 기다렸습니다.

```ts
// firebase/locationHandler.ts
const snapshot = await locationsCollection
  .where("latlng.latitude", "<=", north)
  .where("latlng.latitude", ">=", south)
  .get({ source: "cache" });
```

장점은 오프라인에서도 마지막 결과가 곧바로 노출된다는 점이었고, 캐시 만료 시에는 `storeCacheLocations`로 최신 수정 시간만 체크해 전체 싱크 비용을 줄였습니다.

### 예상 밖 이슈와 해결
Firebase의 `serverTimestamp()`는 비동기로 채워지기 때문에, 문서를 작성하자마자 읽으면 `null`이 반환되곤 했습니다. UI가 즉시 시간을 필요로 할 때는 클라이언트에서 임시로 `Date.now()`를 써 두고, Firestore가 갱신되면 상태 관리를 통해 UI를 다시 갱신했습니다. 또 Firebase Auth 초기화가 느릴 때 앱이 흰 화면에 멈추는 일이 있어, Firebase 모듈을 전역에서 초기화하지 않고 각 핸들러 내부에서 지연 로딩하도록 조정했습니다.

## 결과와 회고
당시에는 공공데이터 약 1,700건과 사용자 제보 200건 정도를 Firestore로 처리하면서도 운영비는 0원대에 머물렀습니다. Cloud Functions로 자동 승인 워크플로를 붙이려다 보안 규칙 개편 이슈 때문에 중단하긴 했지만, 서버 없이도 여기까지 버틴 경험이 큰 자신감이 되었습니다. 3년이 지난 지금은 Firebase 콘솔 UI도 달라지고 요금제도 개편됐지만, "서버를 추가하기 전에 먼저 서버리스 구성을 검토한다"는 원칙은 여전히 유효하다고 생각합니다. 여러분은 위치 기반 서비스를 서버리스로 굴려 본 경험이 있으신가요? 댓글로 노하우를 나눠주시면 감사하겠습니다.

# Reference
- https://rnfirebase.io/
- https://firebase.google.com/docs/firestore
- https://firebase.google.com/docs/auth

# 연결문서
- [공공기관 위치 데이터를 우리가 쓰는 방식으로 정제하기](/post/gonggonggigwan-wichi-deiteoreul-uriga-sseuneun-bangsigeuro-jeongjehagi)
- [App Router에서 Firebase Auth로 관리자 접근을 지키는 방법](/post/app-routereseo-firebase-authro-gwallija-jeopgeuneul-jikineun-bangbeop)
- [Firebase에서 검색 기능 구현하기 - 삽질 끝에 찾은 해결책](/post/firebaseeseo-geomsaek-gineung-guhyeonhagi-sapjil-kkeute-chajeun-haegyeolchaek)
