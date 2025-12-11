---
tags:
  - PWA
  - S3
  - NextJS
  - Caching
  - Offline
  - Mobile
title: PWA로 모바일 사용성을 챙기며 S3 업로드와 오프라인 캐싱을 조율한 기록
created: 2025-02-14 10:15
modified: 2025-02-14 10:15
---

# Intro
현장에서 예약 현황을 확인해야 하는 운영자는 대부분 모바일 브라우저를 씁니다. 그런데 네트워크가 약한 체육관이나 지하층에서는 이미지가 느리게 뜨고, 파일 업로드도 꼭 실패했습니다. 그래서 PWA를 본격적으로 적용하고, S3 업로드와 오프라인 캐싱을 같이 다듬었습니다.

## 핵심 아이디어 요약
- `@ducanh2912/next-pwa` 플러그인으로 Workbox 기반 캐싱을 설정해 정적 리소스와 이미지 로딩 속도를 안정화했습니다.
- S3 업로드는 사전 서명 URL을 받아 multipart 폼으로 전송하고, Blob 업로드 API를 별도로 만들어 캔버스 데이터를 동일한 흐름으로 보냈습니다.
- Firebase Messaging 서비스 워커와 충돌하지 않도록 PWA 서비스 워커를 별도 파일로 유지했습니다.

## 준비와 선택
1. **캐싱 전략**  
   이미지 위주의 오프라인 경험이 필요했기 때문에 `StaleWhileRevalidate` 전략을 선택했습니다.
2. **업로드 일관성**  
   업로드 전후 로딩 상태와 예외 메시지를 통일하려고 `upload.ts`에 helper 함수를 모았습니다.
3. **환경 별 전환**  
   개발 환경에서는 PWA를 비활성화해 디버깅이 쉽도록 했습니다.

## 구현 여정
### Step 1: PWA 설정

```js
// next.config.js
const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  extendDefaultRuntimeCaching: true,
  disable: isDev,
  workboxOptions: {
    skipWaiting: true,
    disableDevLogs: true,
    exclude: [/api/, /_next/],
    runtimeCaching: [
      {
        urlPattern: /\.(?:png|jpg|jpeg|svg)$/,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'images',
          expiration: { maxEntries: 50, maxAgeSeconds: 86400 },
        },
      },
    ],
  },
});
```

앱 아이콘, manifest는 기본적으로 Next.js의 `public` 디렉터리에 두고, Workbox가 생성한 `sw.js`를 S3 및 CloudFront 캐시에 배포했습니다.

### Step 2: 업로드 모듈 정리

```ts
// src/shared/lib/upload.ts
export const uploadFile = async (file: File | null, folderName: string, fileSize: number) => {
  if (!file) {
    errorMessage('파일을 선택해주세요.');
    return { ok: false };
  }

  const { url, fields } = await getSignedUrl(file, folderName, fileSize);
  const uploadResponse = await uploadFileToS3(url, fields, file);
  return { ok: true, url: uploadResponse.url + fields.key };
};
```

Blob 업로드(`uploadBlob`)도 같은 형태로 통일해, 캔버스에서 생성한 이미지·PDF도 같은 토스트 메시지를 재사용하도록 했습니다.

### Step 3: 오프라인 대응
서비스 워커에서는 Firebase 메시징과 충돌하지 않도록 별도의 `firebase-messaging-sw.js`를 두고, PWA용 `sw.js`는 Workbox가 생성하는 파일을 그대로 사용했습니다. 캐시 스토리지에 남은 이미지 용량이 늘어났을 때는 `maxEntries`를 줄여 해결했고, 설치 이후 업데이트가 즉시 반영되도록 `skipWaiting`을 활성화했습니다.

### 예상치 못한 이슈
- 5MB 이상 파일을 올릴 때 S3에서 `EntityTooLarge`가 떨어졌습니다. Presigned POST 정책에 `content-length-range`를 추가하고, 업로드 전 로컬에서 파일 크기를 검사했습니다.
- Safari에서 PWA 설치 후 카메라 촬영 이미지를 업로드하면 MIME 타입이 `image/heic`로 들어와 처리하지 못했습니다. mime 패키지에서 `heic`을 지원하지 않아 임시로 `application/octet-stream`으로 업로드하고, 서버에서 이미지 매직으로 변환했습니다. 이 과정에서 Claude에게 HEIC 변환 전략을 비교 설명해 달라고 부탁하며 대안을 검토했습니다.

## 결과와 회고
운영자가 캐시 데이터를 기반으로 예약 목록을 확인할 수 있게 되어, 지하층에서도 업무가 끊기지 않는다고 합니다. 이미지 캐시 덕분에 첫 로딩 시간이 평균 1.8초에서 1.1초로 줄었고, 업로드 성공률도 60%대에서 95% 이상으로 올라갔습니다. 이제는 오프라인 상태에서 작성한 데이터를 어떻게 동기화할지 고민하려고 합니다. 여러분은 PWA와 업로드 경험을 어떻게 조율하고 계신가요?

# Reference
- https://developer.chrome.com/docs/workbox
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html

# 연결문서
- [[Next.js Fluid Computing으로 서버 리듬을 조율한 이야기]]
- [[App Router에서 Firebase Auth로 관리자 접근을 지키는 방법]]
- [[Firestore 장바구니 동기화에서 배운 방어적 패턴]]
