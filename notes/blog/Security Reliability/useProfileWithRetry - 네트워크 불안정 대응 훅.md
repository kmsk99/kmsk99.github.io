---
tags:
  - Supabase
  - React
  - Session
  - Retry
  - Reliability
title: useProfileWithRetry - 네트워크 불안정 대응 훅
created: 2025-03-31
modified: 2025-04-10
---

지하철에서 네트워크가 끊겨 프로필 API가 실패하면, 사용자가 강제로 로그아웃되는 걸 보며 좌절했다. 인증이 풀리면 다시 로그인해야 하는데, 사실 인터넷이 잠깐 끊긴 것뿐이다. `useProfileWithRetry`라는 훅을 만들어 세션을 안전하게 지키는 방법을 적용했다.

## 재시도와 안전 모드
- 네트워크나 일시적 Supabase 오류만 감지해서 최대 세 번까지 자동 재시도한다.
- 완전히 실패해도 사용자 세션을 유지하기 위해 프로필 상태를 "안전 모드"로 전환한다.
- `retryDelays`와 `onRetry` 등 커스텀 콜백을 받아 상황에 맞게 UX를 조정할 수 있다.

프로필 본문은 jotai `profileAtom`, 완료 여부는 `isProfileCompleteAtom`, 재시도 여부는 훅 내부 state로 나눴다. 메시지에 `network`, `timeout`, `503` 등이 포함되면 일시 오류로 보고 재시도하고, 그렇지 않으면 즉시 안전 모드로 전환한다. 재시도 대기 중 컴포넌트가 언마운트되면 아직 남아 있는 타이머 때문에 경고가 뜨므로, `useRef`로 타임아웃 핸들을 기억하고 깔끔하게 정리했다.

## 재시도 조건 정의
`isTemporaryError`는 `Failed to fetch`, `PGRST301`, `503`, `ECONNREFUSED` 같은 키워드를 검사해 일시 오류를 판별한다. 재시도 가능한 경우에만 `retryCount`를 올리고 `setTimeout`으로 다음 시도를 예약한다.

```ts
const isTemporaryError = (error: unknown) => {
  const errorMessage = (error as { message?: string }).message || '';
  const errorCode = (error as { code?: string }).code || '';
  const networkErrors = ['fetch', 'network', 'timeout', 'NETWORK_ERROR', 'Failed to fetch', 'ECONNREFUSED'];
  const temporarySupabaseErrors = ['PGRST301', 'PGRST001', '503', '502', '504'];
  return (
    networkErrors.some(err => errorMessage.toLowerCase().includes(err.toLowerCase())) ||
    temporarySupabaseErrors.some(err => errorMessage.includes(err) || errorCode.includes(err))
  );
};
```

## 온라인 상태 확인
`enableNetworkCheck` 옵션이 true이면 `navigator.onLine`을 확인한다. 오프라인이면 재시도를 중단하고 프로필을 `null`로 비워두되 `isProfileCompleteAtom`은 true로 설정해 자동 로그아웃을 막았다. `hasCheckedProfileCompleteAtom`이 true일 땐 추가 호출을 막아 중복 요청을 방지한다.

## 성공과 실패 처리
`getMyProfile`이 성공하면 jotai atom을 모두 최신값으로 갱신하고 `setHasChecked(true)`로 다른 컴포넌트가 의존할 수 있게 한다. 실패하면 `isProfileCompleteAtom`을 true로 켜서 "임시로 완성된 것처럼" 처리하고, `onError` 콜백을 호출한다. `isLoading`과 `isRetrying`을 분리해 스피너와 안내 문구를 다르게 보여준다.

```ts
export function useProfileWithRetry(options: UseProfileWithRetryOptions = {}) {
  const { maxRetries = 3, retryDelays = [1000, 2000, 3000], enableNetworkCheck = true } = options;
  const setProfile = useSetAtom(profileAtom);
  const setIsComplete = useSetAtom(isProfileCompleteAtom);
  const [hasChecked, setHasChecked] = useAtom(hasCheckedProfileCompleteAtom);
  const [retryCount, setRetryCount] = useState(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchProfile = async (isRetryAttempt = false) => {
    try {
      if (isRetryAttempt) setIsRetrying(true);
      else setIsLoading(true);
      const profileData = await getMyProfile();
      setProfile(profileData);
      setIsComplete(profileData?.is_complete ?? false);
      setHasChecked(true);
      setRetryCount(0);
      onSuccess?.(profileData);
    } catch (fetchError) {
      if (enableNetworkCheck && !navigator.onLine) {
        setProfile(null);
        setIsComplete(true); // 오프라인에서는 로그아웃 방지
        onError?.(fetchError);
        return;
      }
      if (isTemporaryError(fetchError) && retryCount < maxRetries) {
        const delay = retryDelays[retryCount] || 3000;
        setRetryCount(prev => prev + 1);
        onRetry?.(retryCount + 1, maxRetries);
        timeoutRef.current = setTimeout(() => fetchProfile(true), delay);
      } else {
        setProfile(null);
        setIsComplete(true); // 안전 모드
        onError?.(fetchError);
      }
    }
  };

  useEffect(() => {
    if (hasChecked || isLoading) return;
    fetchProfile();
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [hasChecked]);

  return { isLoading, isRetrying, retryCount, hasChecked, error };
}
```

## 클린업
컴포넌트가 언마운트되거나 재시도가 필요 없을 때는 `timeoutRef.current`를 확인해 clearTimeout으로 타이머를 정리했다. 이 부분을 놓치면 React가 "메모리 누수" 경고를 뿜는다.

## 겪은 이슈와 해결
- 무한 재시도: 오류 메시지가 애매할 때 재시도를 반복했다. 재시도 횟수를 `maxRetries`로 제한하고, 한 번이라도 성공하면 retryCount를 0으로 초기화했다.
- 동시 호출: 다른 컴포넌트가 동시에 훅을 호출하면 중복 요청이 생겼다. `hasCheckedProfileCompleteAtom`이 true일 땐 추가 호출을 막아 불필요한 API 호출을 줄였다.
- UI 피드백: 사용자는 로딩 중인지 재시도 중인지 헷갈려 했다. 그래서 `isLoading`과 `isRetrying`을 분리해 스피너와 안내 문구를 다르게 보여주게 했다.

이제는 네트워크가 잠깐 끊겨도 프로필이 사라지지 않고, 사용자가 다시 로그인할 필요도 없어졌다. "왜 갑자기 로그아웃됐죠?" 같은 문의가 줄어든 게 체감된다. 다음엔 재시도 로그를 수집해 어느 구간에서 실패가 잦은지 대시보드로 보여줄 계획이다.

# Reference
- https://developer.mozilla.org/en-US/docs/Web/API/NavigatorOnLine/onLine
- https://supabase.com/docs/reference/javascript/auth-getuser
- https://jotai.org/docs/introduction

# 연결문서
- [[React Native에서 Next.js API를 인증된 상태로 호출하기]]
- [[NICE 본인인증 API 서버 구현]]
- [[React Context로 통화 로컬라이제이션 구현]]
