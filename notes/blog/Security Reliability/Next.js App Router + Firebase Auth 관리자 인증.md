---
tags:
  - NextJS
  - Firebase
  - Auth
  - RBAC
  - Security
title: Next.js App Router + Firebase Auth 관리자 인증
created: 2023-08-28
modified: 2024-05-02
---

# Intro

고객용 페이지와 관리자 대시보드가 같은 Next.js 프로젝트 안에 있다 보니 역할 검증이 꼬이는 일이 있었다. 이메일·비밀번호 로그인과 SNS 로그인이 뒤섞인 환경이라, 단순히 `useEffect`로 비동기 체크를 거는 것만으로는 깜빡임과 접근 허용 타이밍 이슈가 해결되지 않았다. Firebase Auth와 App Router를 다시 뜯어보면서 정리한 내용이다.

# 인증 컨텍스트 구조

서버 컴포넌트 루트에서 `AuthProvider`를 감싸 두고, 클라이언트 전용 컨텍스트로 인증 상태와 로딩을 한 번에 노출한다. 관리자 레이아웃이 컨텍스트를 바라보며 Firestore `userInfos` 컬렉션에서 역할을 조회하고, 역할이 맞지 않을 때는 즉시 가드한다.

# 루트 레이아웃에서 컨텍스트 주입

`src/app/layout.tsx`에 `AuthProvider`와 환율 컨텍스트를 감싸서 모든 하위 라우트가 같은 인증 정보를 공유하게 만들었다.

```tsx
<html lang="ko">
  <AuthProvider>
    <LocalizationProvider>
      <body className={cls(montserrat.className)}>
        {children}
        <ToastContainer />
      </body>
    </LocalizationProvider>
  </AuthProvider>
</html>
```

페이지 전환 때마다 로그인 상태를 다시 확인할 필요가 없어졌고, 토스트 피드백도 일관되게 작동했다.

# AuthProvider로 초기 로딩 제어

Firebase SDK가 브라우저 전용이라 컴포넌트를 `use client`로 선언하고, 로딩 플래그를 명시했다.

```tsx
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
```

로딩 상태를 분리해 두면 관리자 라우트에서는 `loading`이 false일 때만 Firestore를 조회하도록 분기할 수 있고, 깜빡임이 확실히 줄어든다.

# 관리자 레이아웃에서 역할 확인

`src/app/admin/layout.tsx`는 `useAuth()`를 호출해 로그인 상태를 감지하고, Firestore `userInfos` 컬렉션에서 `getUserInfo(currentUser.uid)`로 역할을 조회한 뒤에만 `AdminTemplate`을 렌더링한다. `loading`이 false일 때만 Firestore를 조회해 깜빡임을 줄였다.

```tsx
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [role, setRole] = useState("");

  useEffect(() => {
    if (!currentUser) return;
    getUserInfo(currentUser.uid).then((userInfo) => {
      setRole(userInfo?.role || "로그인 필요");
      if (userInfo?.role === "ADMIN") setIsAdmin(true);
    });
  }, [currentUser]);

  return (
    <AdminTemplate
      isAdmin={isAdmin}
      role={role}
      Header={<AdminHeader title="시스템 관리자 대시보드" />}
      Navigation={<AdminNavigation navList={navList} />}
    >
      {children}
    </AdminTemplate>
  );
}
```

"권한 없어요" 같은 딱딱한 메시지 대신, 실제로 감지한 역할을 함께 보여주도록 했다. 운영자가 잘못된 계정으로 로그인했을 때 즉시 파악할 수 있다. `loginUser`와 `googleLogin`에서 인증 성공 후 `router.push("/")`와 `lastLoginAt` 갱신을 동시에 수행하면, 관리자 계정은 로그인 직후 Firestore 권한 확인으로 넘어간다.

# 가드 UI와 라우터 전환

`AdminTemplate`는 `isAdmin`이 false일 때 전체 화면 안내를 띄운다. 뷰 레벨에서 접근을 한 번 더 차단하면, 네트워크 지연으로 `isAdmin` 값이 늦게 설정되더라도 페이지 내부가 노출되는 것을 막을 수 있다.

`loginUser`와 `googleLogin`에서 인증 성공 후 `router.push("/")`를 실행하면서 동시에 `lastLoginAt`을 갱신하도록 했는데, 이 타이밍 덕분에 관리자 계정은 로그인 직후 바로 Firestore 권한 확인으로 넘어간다.

# 결과

같은 코드베이스에 있는 퍼블릭 페이지와 관리자 도구가 서로 영향을 주지 않으면서도, 역할이 바뀌면 즉시 반영되는 경험을 제공할 수 있었다. `loading` 플래그를 따로 관리한 덕분에 "관리자 페이지에 들어왔는데 하얀 화면만 보인다"는 신고도 사라졌다.

# Reference
- https://firebase.google.com/docs/auth
- https://nextjs.org/docs/app/building-your-application/routing/middleware

# 연결문서
- [[Firestore 장바구니 동기화와 수량 보정]]
- [[Firestore에서 키워드 인덱싱으로 검색 구현하기]]
- [[Next.js PWA와 S3 업로드 구현]]
