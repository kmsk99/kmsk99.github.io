---
tags:
  - PWA
  - S3
  - NextJS
  - Caching
  - Offline
  - Mobile
title: Next.js PWA와 S3 업로드 구현
created: 2024-02-14 10:15
modified: 2024-02-14 10:15
---

# 문제

현장에서 예약 현황을 확인해야 하는 운영자는 대부분 모바일 브라우저를 쓴다. 그런데 네트워크가 약한 체육관이나 지하층에서는 이미지가 느리게 뜨고, 파일 업로드도 꼭 실패했다. PWA를 본격적으로 적용하고, S3 업로드와 오프라인 캐싱을 같이 다듬었다.

# 설계

- `@ducanh2912/next-pwa` 플러그인으로 Workbox 기반 캐싱을 설정해 정적 리소스와 이미지 로딩 속도를 안정화했다.
- S3 업로드는 사전 서명 URL을 받아 multipart 폼으로 전송하고, Blob 업로드 API를 별도로 만들어 캔버스 데이터를 동일한 흐름으로 보냈다.
- Firebase Messaging 서비스 워커와 충돌하지 않도록 PWA 서비스 워커를 별도 파일로 유지했다.

# 구현

### 캐싱 전략
이미지 위주의 오프라인 경험이 필요했기 때문에 `StaleWhileRevalidate` 전략을 선택했다.

### 업로드 일관성
업로드 전후 로딩 상태와 예외 메시지를 통일하려고 `upload.ts`에 helper 함수를 모았다.

### 환경 별 전환
개발 환경에서는 PWA를 비활성화해 디버깅이 쉽도록 했다.

### PWA 설정

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

앱 아이콘, manifest는 기본적으로 Next.js의 `public` 디렉터리에 두고, Workbox가 생성한 `sw.js`를 S3 및 CloudFront 캐시에 배포했다.

### 업로드 모듈 정리

Supabase Storage는 S3 호환 API를 제공한다. PreSigned URL로 업로드하는 패턴을 `uploadByFile`에 통일했다.

```ts
const getSignedUploadUrl = async (
  bucketName: string,
  filePath: string,
): Promise<{ signedUrl: string; token: string } | null> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage
    .from(bucketName)
    .createSignedUploadUrl(filePath, { upsert: true });
  if (error || !data?.signedUrl) return null;
  return { signedUrl: data.signedUrl, token: data.token };
};

export const uploadByFile = async (
  file: File,
  bucketName: string,
  userId?: string,
  maxRetries: number = 3,
): Promise<string | null> => {
  const fileName = generateUniqueFileName(file.name);
  const folderPath = userId || 'public';
  const filePath = `${folderPath}/${fileName}`;

  const signedData = await getSignedUploadUrl(bucketName, filePath);
  if (!signedData) return null;

  const uploadSuccess = await uploadFileWithSignedUrl(
    file,
    signedData.signedUrl,
    1,
  );
  if (!uploadSuccess) return null;

  const supabase = getSupabase();
  const { data: publicUrlData } = supabase.storage
    .from(bucketName)
    .getPublicUrl(filePath);
  return publicUrlData?.publicUrl ?? null;
};
```

Blob 업로드(`uploadBlob`)도 같은 형태로 통일해, 캔버스에서 생성한 이미지·PDF도 같은 토스트 메시지를 재사용하도록 했다.

### 오프라인 대응
서비스 워커에서는 Firebase 메시징과 충돌하지 않도록 별도의 `firebase-messaging-sw.js`를 두고, PWA용 `sw.js`는 Workbox가 생성하는 파일을 그대로 사용했다. 캐시 스토리지에 남은 이미지 용량이 늘어났을 때는 `maxEntries`를 줄여 해결했고, 설치 이후 업데이트가 즉시 반영되도록 `skipWaiting`을 활성화했다.

# 예상치 못한 이슈

- 5MB 이상 파일을 올릴 때 S3에서 `EntityTooLarge`가 떨어졌다. Presigned POST 정책에 `content-length-range`를 추가하고, 업로드 전 로컬에서 파일 크기를 검사했다.
- Safari에서 PWA 설치 후 카메라 촬영 이미지를 업로드하면 MIME 타입이 `image/heic`로 들어와 처리하지 못했다. mime 패키지에서 `heic`을 지원하지 않아 임시로 `application/octet-stream`으로 업로드하고, 서버에서 이미지 매직으로 변환했다. 이 과정에서 Claude에게 HEIC 변환 전략을 비교 설명해 달라고 부탁하며 대안을 검토했다.

# 결과

운영자가 캐시 데이터를 기반으로 예약 목록을 확인할 수 있게 되어, 지하층에서도 업무가 끊기지 않는다고 한다. 이미지 캐시 덕분에 첫 로딩 시간이 평균 1.8초에서 1.1초로 줄었고, 업로드 성공률도 60%대에서 95% 이상으로 올라갔다. 이제는 오프라인 상태에서 작성한 데이터를 어떻게 동기화할지 고민하려고 한다.

# Reference
- https://ducanh2912.github.io/next-pwa/
- https://developer.chrome.com/docs/workbox
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html

# 연결문서
- [[Next.js Fluid Computing과 maxDuration 적용]]
- [[Next.js App Router + Firebase Auth 관리자 인증]]
- [[Firestore 장바구니 동기화와 수량 보정]]
- [[Intersection Observer로 스크롤 기반 애니메이션 구현]]
