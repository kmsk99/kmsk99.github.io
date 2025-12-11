---
tags:
  - Engineering
  - TechDeepDive
  - Supabase
  - Security
  - Performance
  - Backend
title: 갤럭시 기기까지 고려한 Supabase 첨부파일 업로드 안정화기
created: 2025-10-09 14:06
modified: 2025-10-09 14:06
uploaded: "false"
---

# Intro
저는 채팅에 이미지를 올리다가 갤럭시 단말에서만 실패한다는 제보를 받고 진땀을 뺐습니다. 똑같은 파일이 아이폰에서는 잘 올라가는데, 갤럭시에서는 50%에서 멈춰버리더군요. 그래서 Supabase 스토리지 업로드 흐름을 전면 점검하며 기기별 안정성을 높였습니다.

## 핵심 아이디어 요약
- 갤럭시 단말을 감지해서 업로드 전·후로 짧은 대기 시간을 주고, 재시도 횟수도 늘렸습니다.
- `createSignedUploadUrl`로 받은 URL에 PUT으로 업로드하고, DB 저장이 실패하면 Storage에서 파일을 즉시 삭제해 롤백했습니다.
- 실패한 업로드는 `__optimisticUpload` 메타로 UI에 표시하고, 끝내 모두 실패하면 메시지를 하드 딜리트했습니다.

## 준비와 선택
1. **디바이스 감지**: 업로드 유틸리티에서 모바일 디바이스를 감지하는 함수에 갤럭시 전용 정규식을 추가했습니다. 기기마다 네트워크 스택이 다르니 대응이 필요했어요.
2. **파일 검증**: 업로드 전에 `validateFile`로 100MB 제한과 빈 파일 여부를 확인했습니다. 오류 메시지는 사용자에게 바로 전달할 수 있도록 문자열로 남겼습니다.
3. **보안**: Supabase Public URL 대신 서명된 업로드 URL을 사용해, 인증된 사용자만 파일을 올릴 수 있도록 했습니다.

## 구현 여정
### Step 1: 고유 파일명과 유효성 검사
`generateUniqueFileName`은 `crypto.randomUUID()`를 기본으로 쓰되, 지원되지 않을 때를 대비해 Math.random 기반 UUID로 대체합니다. 업로드 전에는 `validateFile`이 용량과 빈 파일을 걸러내 사용자에게 친절한 오류를 보여줍니다.

### Step 2: 서명된 URL로 업로드
`getSignedUploadUrl`이 돌려준 URL에 `uploadFileWithSignedUrl`로 PUT 요청을 보냅니다. 모바일에서는 타임아웃을 60초로 늘리고, 재시도할 때마다 `exponentialBackoff`로 지연을 늘렸습니다. 갤럭시 단말이라면 업로드 전후에 100~150ms 정도 쉬어가게 해 리소스를 안정화했습니다.

```ts
import { exponentialBackoff } from './retry';
import { isMobileDevice } from './devices';

async function uploadFileWithSignedUrl(
  file: File,
  signedUrl: string,
  maxRetries = 5,
) {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = isMobileDevice() ? 60000 : 30000;
      setTimeout(() => controller.abort(), timeout);

      const response = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
        signal: controller.signal,
      });

      if (response.ok) return true;
      throw new Error(`Upload failed: ${response.status}`);
    } catch (error) {
      // 갤럭시 단말에서는 재시도 간 간격을 조금씩 늘려 네트워크를 안정화합니다.
      await exponentialBackoff(attempt);
      if (attempt === maxRetries) throw error;
    }
  }
}
```

### Step 3: DB 저장과 롤백
업로드가 성공하면 `attachment` 테이블에 메타데이터를 저장합니다. 여기서 실패하면 `deleteFileFromStorage`로 방금 올린 파일을 지워 Storage와 DB가 엇갈리지 않게 했습니다. 이미 업로드된 파일을 갱신할 때는 단순히 순서만 업데이트합니다.

### Step 4: Optimistic UI와 실패 처리
채팅에서는 `uploadFiles`가 메시지를 먼저 생성하고 `__optimisticUpload`에 전체/성공 개수를 기록합니다. 업로드가 전부 실패하면 `deleteChatMessageHard`로 메시지를 삭제해 빈 메시지가 남지 않도록 했습니다.

## 겪은 이슈와 해결 과정
- **콘텐츠 타입**: 일부 브라우저가 `Content-Length` 헤더를 강제로 넣으면 실패했습니다. 그래서 헤더에서 해당 값을 지우고 브라우저가 알아서 설정하도록 했습니다.
- **파일명 인코딩**: 한글 파일명이 URL에서 깨지길래 `sanitizeFileName`으로 한글을 `file`로 치환하고 영문, 숫자, 언더스코어만 남겼습니다.
- **모바일 네트워크 타임아웃**: LTE 환경에서 30초 타임아웃이 모자라 60초로 늘렸고, 그래도 실패하면 자동 재시도를 최대 5회까지 시도했습니다.

## 결과와 회고
지금은 갤럭시 단말에서도 업로드 성공률이 확 올라갔습니다. 실패해도 롤백이 깔끔하게 되니 데이터가 엉키지 않고, 사용자는 업로드 진행률을 눈으로 확인할 수 있게 됐습니다. 다음에는 백엔드에서 이미지 리사이즈를 비동기로 처리해 모바일 네트워크 부담을 더 줄여볼 생각입니다.

혹시 비슷한 업로드 문제를 겪으셨나요? 다른 기기에서의 삽질담이 있다면 댓글로 공유해 주세요. 서로의 케이스를 비교해 보면 의외의 해결책이 떠오르기도 하더라고요.

# Reference
- https://supabase.com/docs/guides/storage
- https://developer.mozilla.org/en-US/docs/Web/API/fetch
- https://developer.mozilla.org/en-US/docs/Web/API/Navigator/userAgent

# 연결문서
- [[AWS KMS와 AES-GCM으로 서버 사이드 암호화 업로드 구축기]]
- [[Supabase RPC로 포인트 적립·차감을 안전하게 처리한 방법]]
- [[mapWithConcurrencyLimit로 Supabase 병렬 호출을 조율한 이유]]
