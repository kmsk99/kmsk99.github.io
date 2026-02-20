---
tags:
  - Firebase
  - Supabase
  - Migration
  - Architecture
  - ReactNative
  - Expo
title: Firebase에서 Supabase로 기술 스택 전환
created: 2025-03-10 10:00
modified: 2025-03-10 15:00
---

# 배경

위치 기반 모바일 앱의 첫 버전은 Firebase 위에 구축했다. Firestore, Firebase Auth, Cloud Storage, Analytics를 사용했고 약 2년간 운영했다. 사용자와 데이터가 늘면서 Firebase의 한계가 보이기 시작했고, 새 버전을 만들면서 Supabase로 전환하기로 결정했다.

# 전환 이유

## Firestore의 쿼리 제한

가장 큰 불편은 Firestore의 쿼리 유연성 부족이었다. Firestore는 복합 쿼리에 제약이 많다. 위치 기반 범위 검색 + 카테고리 필터 + 정렬을 한 번에 수행할 수 없어서 클라이언트에서 후처리해야 했다.

```ts
// Firestore: 범위 쿼리 후 클라이언트에서 필터링
const snapshot = await locationsCollection
  .where('latlng.latitude', '>=', boundary.south)
  .where('latlng.latitude', '<=', boundary.north)
  .get({ source: 'cache' });

const filtered = snapshot.docs
  .filter(doc => doc.data().latlng.longitude >= boundary.west)
  .filter(doc => doc.data().latlng.longitude <= boundary.east)
  .filter(doc => mapFilter === 'all' || doc.data().placeType === mapFilter);
```

위도로만 범위 쿼리가 가능하고, 경도 필터링은 클라이언트에서 해야 했다. 데이터가 수만 건이 되자 불필요한 문서 전송이 비용과 성능 모두에 영향을 줬다.

Supabase(PostgreSQL)에서는 PostGIS RPC로 서버에서 모든 필터링을 처리할 수 있다.

```ts
const { data } = await supabase.rpc('get_zones_in_bbox', {
  west: bounds.west,
  south: bounds.south,
  east: bounds.east,
  north: bounds.north,
  kinds: ['SMOKING'],
  page_size: 100,
});
```

이 RPC의 SQL 내부에서는 `ST_MakeEnvelope`로 bbox를 geometry로 변환하고, `ST_Intersects`로 교차 판정한다.

```sql
CREATE FUNCTION get_zones_in_bbox(
  west double precision, south double precision,
  east double precision, north double precision,
  page_size integer DEFAULT 1000, offset_n integer DEFAULT 0,
  kinds text[] DEFAULT NULL
) RETURNS TABLE(id uuid, kind text, name text, display_point geometry, geom_area geometry, ...)
LANGUAGE sql STABLE AS $$
  WITH env AS (
    SELECT ST_MakeEnvelope(west, south, east, north, 4326) AS box
  )
  SELECT z.id, z.kind, z.name, z.display_point, z.geom_area, ...
  FROM zones z, env
  WHERE (kinds IS NULL OR z.kind = ANY(kinds))
    AND z.is_active = true
    AND ST_Intersects(z.geom_area, env.box)
  ORDER BY COALESCE(z.data_date::timestamp, z.created_at) DESC
  LIMIT LEAST(page_size, 1000) OFFSET offset_n;
$$;
```

Firestore에서는 위도 범위 쿼리 후 경도를 클라이언트에서 필터링해야 했지만, PostGIS는 `ST_Intersects`로 2D 공간 교차를 인덱스 기반으로 계산한다. GiST 인덱스가 있으면 수십만 건에서도 수 ms 내에 응답한다.

## 검색 기능의 한계

Firestore에는 풀텍스트 검색이 없어서 키워드 인덱싱을 직접 구현해야 했다. 문서 저장 시 n-gram으로 키워드 배열을 생성하고 `array-contains`로 검색하는 방식이었다. 동작은 했지만 인덱스 크기가 원본 데이터보다 커지고, 한글 초성 검색이나 유사어 매칭은 불가능했다.

Supabase에서는 PostgreSQL의 `ilike`, `to_tsvector`, 또는 pgvector를 활용한 시맨틱 검색까지 가능하다.

## 비용 구조

Firestore는 문서 읽기/쓰기 횟수로 과금된다. 지도를 움직일 때마다 수백 건의 읽기가 발생하니 비용이 예측하기 어려웠다. Supabase는 PostgreSQL 기반이라 행 수가 아닌 스토리지와 대역폭으로 과금되고, 같은 쿼리를 수천 번 해도 추가 비용이 거의 없다.

# 전환 내용

## 인증

Firebase Auth에서 Supabase Auth로 전환했다. Google/Apple 소셜 로그인 흐름은 거의 동일하다.

```ts
// Firebase Auth
const credential = auth.GoogleAuthProvider.credential(idToken);
await auth().signInWithCredential(credential);
```

```ts
// Supabase Auth
await supabase.auth.signInWithIdToken({
  provider: 'google',
  token: idToken,
});
```

Supabase Auth는 JWT 기반이라 Row Level Security(RLS)와 자연스럽게 연동된다. Firebase에서는 Security Rules를 별도로 작성해야 했던 것에 비해, RLS는 SQL 수준에서 권한을 제어하니 더 직관적이었다.

## 상태 관리

Firebase 버전에서는 `onUserChanged` 리스너를 React Context에 연결했다. Supabase 버전에서는 Zustand 스토어에 `onAuthStateChange` 리스너를 연결하는 방식으로 바꿨다.

```ts
// Firebase: React Context
function App() {
  const [user, setUser] = useState(null);
  useEffect(() => {
    return auth().onUserChanged(setUser);
  }, []);
  return <CurrentUserContext.Provider value={user}>...</CurrentUserContext.Provider>;
}
```

```ts
// Supabase: Zustand
const useUserStore = create((set) => ({
  user: null,
  initialize: () => {
    supabase.auth.onAuthStateChange((event, session) => {
      set({ user: session?.user ?? null });
    });
  },
}));
```

Zustand로 전환한 이유는 Context의 리렌더링 문제 때문이다. 인증 상태가 바뀔 때 Context를 사용하는 모든 컴포넌트가 리렌더링되는데, Zustand는 구독한 값이 바뀔 때만 리렌더링된다.

## 내비게이션

React Navigation의 수동 네비게이터 구성에서 Expo Router의 파일 기반 라우팅으로 전환했다.

```ts
// React Navigation: 수동 구성
function RootNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Tabs" component={TabsNavigator} />
      <Stack.Screen name="Detail" component={DetailScreen} />
      <Stack.Screen name="Report" component={ReportScreen} />
    </Stack.Navigator>
  );
}

function TabsNavigator() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Map" component={MapScreen} />
      <Tab.Screen name="Recommend" component={RecommendScreen} />
      <Tab.Screen name="Favorite" component={FavoriteScreen} />
      <Tab.Screen name="MyPage" component={MyPageScreen} />
    </Tab.Navigator>
  );
}
```

```
// Expo Router: 파일 구조
app/
├── _layout.tsx          # Root Stack
├── (tabs)/
│   ├── _layout.tsx      # Tab Navigator
│   ├── index.tsx        # Map
│   ├── recommend.tsx
│   ├── favorite.tsx
│   └── mypage.tsx
├── zone/
│   ├── _layout.tsx
│   └── [id].tsx         # Detail
└── signup/
    └── index.tsx
```

네비게이터 코드가 파일 구조로 대체되면서 라우팅 관련 보일러플레이트가 크게 줄었다. `useRouter`, `useLocalSearchParams` 같은 훅으로 타입 안전한 네비게이션도 가능해졌다.

## 스타일링

styled-components에서 twrnc(Tailwind for React Native)로 전환했다.

```ts
// styled-components
const Container = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.azure};
  padding: 16px;
`;
const Title = styled.Text`
  font-size: 18px;
  font-weight: bold;
  color: ${({ theme }) => theme.black};
`;
```

```ts
// twrnc
<View style={tw`flex-1 bg-primary-40 p-4`}>
  <Text style={tw`t-xl-sb text-gray-90`}>제목</Text>
</View>
```

컴포넌트 파일에서 스타일 정의가 분리되어 있던 것이 인라인으로 합쳐지면서 파일 수가 줄었다. 커스텀 타이포그래피(`t-xl-sb`)와 컬러 토큰(`primary-40`)을 `tailwind.config.js`에 정의해 디자인 시스템과의 일관성도 유지했다.

## 데이터 계층

Firestore의 컬렉션/문서 구조에서 PostgreSQL의 관계형 테이블로 전환했다. 가장 큰 차이는 조인이 가능해졌다는 점이다.

Firestore에서는 위치 데이터를 가져온 뒤 댓글, 이미지, 사용자 정보를 각각 별도 쿼리로 가져와야 했다. Supabase에서는 한 번의 쿼리로 관련 테이블을 조인해 가져올 수 있다.

# 전환 결과

| 항목 | Firebase 기반 | Supabase 기반 |
|------|-------------|-------------|
| 위치 쿼리 | 위도만 범위 검색, 클라이언트 필터링 | RPC로 서버사이드 bbox 쿼리 |
| 검색 | n-gram 키워드 인덱싱 | `ilike`, pgvector 시맨틱 검색 |
| 인증 | Firebase Auth + Security Rules | Supabase Auth + RLS |
| 상태 관리 | React Context | Zustand |
| 내비게이션 | React Navigation (수동 구성) | Expo Router (파일 기반) |
| 스타일링 | styled-components | twrnc (Tailwind RN) |
| 비용 | 읽기/쓰기 횟수 과금 | 스토리지/대역폭 과금 |
| 오프라인 | Firestore cache 기본 지원 | 별도 구현 필요 |

오프라인 지원은 Firebase가 더 나았다. Firestore는 `source: 'cache'` 옵션으로 오프라인 캐시를 기본 제공하지만, Supabase에서는 별도로 로컬 캐시를 구현해야 한다. 이 부분은 트레이드오프로 받아들였다.

전환 후 지도 초기 로딩이 체감상 빨라졌고, 복잡한 쿼리에서 클라이언트 후처리가 사라지면서 코드가 단순해졌다. RLS를 통한 데이터 접근 제어도 Security Rules보다 작성하기 편했다.

# Reference

- https://supabase.com/docs
- https://firebase.google.com/docs
- https://docs.expo.dev/router/introduction/
- https://github.com/jaredh159/twrnc

# 연결문서

- [[S2 Geometry 기반 서버사이드 지도 클러스터링]]
- [[react-native-clusterer로 지도 마커 클러스터링]]
- [[Firebase 서버리스 위치 기반 앱 구현]]
- [[Supabase + 카카오 OAuth 모바일 연동]]
- [[Firestore에서 키워드 인덱싱으로 검색 구현하기]]
- [[PostGIS RPC로 구역 저장과 공간 조회]]
- [[위치정보법 준수를 위한 감사 로깅 아키텍처]]
- [[Naver와 Google 지오코딩 API 통합]]
- [[PostGIS 폴리곤 병합 파이프라인 구축]]
