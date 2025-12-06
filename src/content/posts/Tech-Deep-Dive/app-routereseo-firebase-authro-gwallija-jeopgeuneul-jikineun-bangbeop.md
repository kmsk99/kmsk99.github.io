---
tags:
  - Engineering
  - TechDeepDive
  - Firestore
  - Firebase
  - NextJS
  - React
  - Payment
  - Performance
title: App Router에서 Firebase Auth로 관리자 접근을 지키는 방법
created: '2025-10-09 09:00'
modified: '2025-10-09 09:00'
---

# Intro
- 고객용 페이지와 관리자 대시보드가 같은 Next.js 프로젝트 안에 엮여 있어서 역할 검증이 꼬이던 경험이 있나요? 저는 최근 프로젝트에서 그런 혼선을 겪었고, 덕분에 Firebase Auth와 App Router를 다시 뜯어보게 됐어요.
- 이메일·비밀번호 로그인과 SNS 로그인이 뒤섞인 환경이라, 단순히 `useEffect`로 비동기 체크를 걸어두는 것만으로는 미묘한 깜빡임과 접근 허용 타이밍 이슈가 해결되지 않았습니다.

## 핵심 아이디어 요약
- 서버 컴포넌트 루트에서 `AuthProvider`를 감싸 두고, 클라이언트 전용 컨텍스트로 인증 상태와 로딩을 한 번에 노출합니다.
- 관리자 레이아웃(`src/app/admin/layout.tsx`)이 컨텍스트를 바라보며 Firestore `userInfos` 컬렉션에서 역할을 조회하고, 역할이 맞지 않을 때는 즉시 가드합니다.
- `AdminTemplate`는 UI 레이어를 책임지고, 접근 거부 시 메시지와 현재 역할을 보여줘 운영자가 스스로 계정 상태를 파악하게 했습니다.

## 준비와 선택
- Next.js 13 App Router 구조를 쓰는 만큼, 서버 컴포넌트와 클라이언트 컴포넌트의 경계가 명확해야 했습니다. 저는 인증 상태가 페이지 전반에서 필요하다고 판단해 `src/app/layout.tsx`에서 컨텍스트를 미리 주입했어요.
- Firebase Auth는 `onAuthStateChanged`가 믿음직하지만, 초기 렌더 타이밍에 따라 레이아웃이 빈 화면을 보여줄 수 있습니다. 그래서 `loading` 플래그를 함께 다루고, 관리자 레이아웃에서는 로딩이 끝난 뒤에만 Firestore를 두드리도록 했습니다.
- 구현 초반에 GPT에게 “App Router에서 Firebase Auth 컨텍스트를 어디에 물리는 게 안전할까?”라고 묻고, SSR과 CSR 경계를 복기한 뒤로 방향을 확정했습니다.

## 구현 여정
1. **루트 레이아웃에서 인증 컨텍스트 주입**  
   `src/app/layout.tsx`에 `AuthProvider`와 환율 컨텍스트를 감싸 두면서, 모든 하위 라우트가 같은 인증 정보를 공유하게 만들었습니다.
   ```tsx
   // src/app/layout.tsx
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
   이렇게 해두니 페이지 전환 때마다 로그인 상태를 다시 확인할 필요가 없어졌고, 토스트 피드백도 일관되게 작동했어요.

2. **`AuthProvider`로 초기 로딩 제어**  
   Firebase SDK가 브라우저 전용이라는 점 때문에 컴포넌트를 `use client`로 선언하고, 로딩 플래그를 명시했습니다.
   ```tsx
   // src/utils/AuthProvider.tsx
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
   로딩 상태를 분리해 두면 관리자 라우트에서는 `loading`이 false일 때만 Firestore를 조회하도록 분기할 수 있고, 깜빡임이 확실히 줄어듭니다.

3. **관리자 레이아웃에서 역할 확인**  
   `src/app/admin/layout.tsx`는 `useAuth()`를 호출해 로그인 상태를 감지하고, Firestore에서 역할을 확인한 뒤에만 `AdminTemplate`을 렌더링합니다.
   ```tsx
   // src/app/admin/layout.tsx
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
   저는 여기서 “권한 없어요” 같은 딱딱한 메시지 대신, 실제로 감지한 역할을 함께 보여주도록 했습니다. 운영자가 잘못된 계정으로 로그인했을 때 즉시 파악할 수 있었고, 헉- 하는 상황을 줄였어요.

4. **가드 UI 정리**  
   `AdminTemplate`는 `isAdmin`이 false일 때 전체 화면 안내를 띄워줍니다. 뷰 레벨에서 접근을 한 번 더 차단하면, 네트워크 지연으로 `isAdmin` 값이 늦게 설정되더라도 사용자가 페이지 내부를 엿보는 걸 막을 수 있습니다.

5. **보너스: 라우터 전환 처리**  
   `loginUser`와 `googleLogin`에서 인증 성공 후 `router.push("/")`를 실행하면서 동시에 `lastLoginAt`을 갱신하도록 했는데, 이 타이밍 덕분에 관리자 계정은 로그인 직후에 바로 Firestore 권한 확인으로 넘어갑니다.

## 결과와 회고
- 같은 코드베이스에 있는 퍼블릭 페이지와 관리자 도구가 서로 영향을 주지 않으면서도, 역할이 바뀌면 즉시 반영되는 경험을 제공할 수 있었습니다.
- `loading` 플래그를 따로 관리한 덕분에 “관리자 페이지에 들어왔는데 하얀 화면만 보인다”는 신고가 사라졌어요. 진짜로 마음이 편해지더라고요.
- 앞으로는 `React.Suspense`나 Next.js Middleware로 더 일찍 가드해 보는 실험도 해보고 싶습니다. 혹시 비슷한 문제를 겪는다면 어떤 접근을 쓰고 있는지 댓글로 남겨주세요.

# Reference
- https://nextjs.org/docs/app/building-your-application/routing
- https://firebase.google.com/docs/auth/web/start

# 연결문서
- [Firestore 장바구니 동기화에서 배운 방어적 패턴](/post/firestore-jangbaguni-donggihwaeseo-baeun-bangeojeok-paeteon)
- [Firebase에서 검색 기능 구현하기 - 삽질 끝에 찾은 해결책](/post/firebaseeseo-geomsaek-gineung-guhyeonhagi-sapjil-kkeute-chajeun-haegyeolchaek)
- [PWA로 모바일 사용성을 챙기며 S3 업로드와 오프라인 캐싱을 조율한 기록](/post/pwaro-mobail-sayongseongeul-chaenggimyeo-s3-eomnodeuwa-opeurain-kaesingeul-joyulhan-girok)
