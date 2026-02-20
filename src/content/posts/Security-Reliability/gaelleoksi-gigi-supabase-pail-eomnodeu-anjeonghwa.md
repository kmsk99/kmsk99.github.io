---
tags:
  - Supabase
  - Uploads
  - Android
  - Mobile
  - Reliability
title: 갤럭시 기기 Supabase 파일 업로드 안정화
created: '2025-07-03'
modified: '2025-07-03'
---

채팅에 이미지를 올리다가 갤럭시 단말에서만 실패한다는 제보를 받았다. 똑같은 파일이 아이폰에서는 잘 올라가는데, 갤럭시에서는 50%에서 멈춰버렸다. Supabase 스토리지 업로드 흐름을 전면 점검하며 기기별 안정성을 높였다.

## 갤럭시 대응 전략
- 갤럭시 단말을 감지해서 업로드 전·후로 짧은 대기 시간을 주고, 재시도 횟수도 늘렸다.
- `createSignedUploadUrl`로 받은 URL에 PUT으로 업로드하고, DB 저장이 실패하면 Storage에서 파일을 즉시 삭제해 롤백했다.
- 실패한 업로드는 `__optimisticUpload` 메타로 UI에 표시하고, 끝내 모두 실패하면 메시지를 하드 딜리트했다.

## 디바이스 감지와 파일 검증
업로드 유틸리티에서 모바일 디바이스를 감지하는 함수에 갤럭시 전용 정규식을 추가했다. `navigator.userAgent`로 Android, webOS, iPhone 등을 검사하고, 기기마다 네트워크 스택이 다르니 대응이 필요했다. 업로드 전에는 `validateFile`로 100MB 제한과 빈 파일 여부를 확인했다. 오류 메시지는 사용자에게 바로 전달할 수 있도록 문자열로 남겼다. Supabase Public URL 대신 `createSignedUploadUrl`로 서명된 업로드 URL을 받아, 인증된 사용자만 파일을 올릴 수 있게 했다.

## 고유 파일명과 유효성 검사
`generateUniqueFileName`은 `crypto.randomUUID()`를 기본으로 쓰되, 갤럭시 등 지원되지 않는 기기를 대비해 `Math.random().toString(36)` 기반 UUID로 대체한다. `sanitizeFileName`은 한글을 `file`로 치환하고 영문·숫자·언더스코어만 남겨 URL-safe하게 만든다. 업로드 전에는 `validateFile`이 용량과 빈 파일을 걸러내 사용자에게 친절한 오류를 보여준다.

## 서명된 URL로 업로드
`getSignedUploadUrl`이 돌려준 URL에 `uploadFileWithSignedUrl`로 PUT 요청을 보낸다. 모바일에서는 타임아웃을 60초로 늘리고, 재시도할 때마다 `exponentialBackoff`로 지연을 늘렸다. 갤럭시 단말이라면 첫 시도 전에 50ms 대기하고, 재시도 간격에 1.5배 배수를 적용해 리소스를 안정화했다. Content-Length 헤더는 갤럭시 브라우저 호환성을 위해 명시하지 않고 브라우저가 자동 설정하도록 했다.

```ts
const isMobileDevice = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
};

const exponentialBackoff = (attempt: number): Promise<void> => {
  const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
  return new Promise(resolve => setTimeout(resolve, delay));
};

const uploadFileWithSignedUrl = async (
  file: File,
  signedUrl: string,
  maxRetries: number = 3,
): Promise<boolean> => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const timeoutMs = isMobileDevice() ? 60000 : 30000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const headers: Record<string, string> = {
        'Content-Type': file.type || 'application/octet-stream',
      };
      // Content-Length 명시 시 갤럭시에서 오류 발생 가능 → 생략

      const response = await fetch(signedUrl, {
        method: 'PUT',
        headers,
        body: file,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) return true;
      throw new Error(`업로드 실패: ${response.status}`);
    } catch (error) {
      if (attempt === maxRetries) return false;
      await exponentialBackoff(attempt);
    }
  }
  return false;
};
```

## DB 저장과 롤백
업로드가 성공하면 `attachment` 테이블에 메타데이터를 저장한다. 여기서 실패하면 `deleteFileFromStorage`로 방금 올린 파일을 지워 Storage와 DB가 엇갈리지 않게 했다. 이미 업로드된 파일을 갱신할 때는 단순히 순서만 업데이트한다.

## Optimistic UI와 실패 처리
채팅에서는 `uploadFiles`가 메시지를 먼저 생성하고 `__optimisticUpload`에 전체/성공 개수를 기록한다. 업로드가 전부 실패하면 `deleteChatMessageHard`로 메시지를 삭제해 빈 메시지가 남지 않도록 했다.

## 겪은 이슈와 해결
- 콘텐츠 타입: 일부 브라우저가 `Content-Length` 헤더를 강제로 넣으면 실패했다. 그래서 헤더에서 해당 값을 지우고 브라우저가 알아서 설정하도록 했다.
- 파일명 인코딩: 한글 파일명이 URL에서 깨지길래 `sanitizeFileName`으로 한글을 `file`로 치환하고 영문, 숫자, 언더스코어만 남겼다.
- 모바일 네트워크 타임아웃: LTE 환경에서 30초 타임아웃이 모자라 60초로 늘렸고, 그래도 실패하면 자동 재시도를 최대 5회까지 시도했다.

지금은 갤럭시 단말에서도 업로드 성공률이 확 올라갔다. 실패해도 롤백이 깔끔하게 되니 데이터가 엉키지 않고, 사용자는 업로드 진행률을 눈으로 확인할 수 있게 됐다. 다음에는 백엔드에서 이미지 리사이즈를 비동기로 처리해 모바일 네트워크 부담을 더 줄여볼 생각이다.

# Reference
- https://supabase.com/docs/guides/storage/uploads/signed-urls

# 연결문서
- [파일 암호화 파이프라인 구현](/post/pail-amhohwa-paipeurain-guhyeon)
- [Supabase 병렬 호출 제한 유틸 구현](/post/supabase-byeongnyeol-hochul-jehan-yutil-guhyeon)
