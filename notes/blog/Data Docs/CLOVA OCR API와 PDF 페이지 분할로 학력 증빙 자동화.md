---
tags:
  - OCR
  - CLOVA
  - PDF
  - NextJS
  - Automation
  - Concurrency
title: CLOVA OCR API와 PDF 페이지 분할로 학력 증빙 자동화
created: 2025-09-05
modified: 2025-09-09
---

학교 기록을 검증하려고 직접 PDF를 열어 정보를 옮겨 적다가 손목이 남아나지 않았다. Next.js API Route에서 CLOVA OCR API를 호출해 텍스트를 자동으로 추출하는 파이프라인을 만들었다. PDF를 페이지별로 쪼개고, 안전한 동시성으로 요청을 보내는 부분이 핵심이었다.

## PDF 페이지 분할

`PDFDocument.load`로 업로드된 PDF를 읽고, `copyPages`로 한 페이지씩 새 PDF를 만들어 Base64로 변환했다. schoolmeets의 `ocr.server.ts`에서는 `pageLimit` 파라미터를 받아 최대 처리 페이지 수도 제어한다. 확장자가 pdf/jpg/jpeg/png인지 체크해 잘못된 파일은 400으로 막았다.

```ts
// schoolmeets/src/shared/supabase/servers/ocr.server.ts
if (fileExtension === 'pdf') {
  const pdfDoc = await PDFDocument.load(decryptedBytes);
  const pageCount = pdfDoc.getPageCount();

  const requestedPageLimit = Math.max(1, Math.floor(pageLimit ?? pageCount));
  const effectivePageLimit = Math.min(requestedPageLimit, pageCount);

  for (let pageIndex = 0; pageIndex < effectivePageLimit; pageIndex++) {
    const singlePagePdf = await PDFDocument.create();
    const [page] = await singlePagePdf.copyPages(pdfDoc, [pageIndex]);
    singlePagePdf.addPage(page);

    const pdfBytes = await singlePagePdf.save();
    const base64Data = Buffer.from(pdfBytes).toString('base64');

    images.push({
      format: 'pdf',
      name: `page_${pageIndex + 1}`,
      data: base64Data,
      url: null,
    });
  }
} else {
  // JPG, PNG 이미지 파일
  const base64Data = Buffer.from(decryptedBytes).toString('base64');
  images.push({
    format: fileExtension === 'jpeg' ? 'jpg' : fileExtension,
    name: 'image',
    data: base64Data,
    url: null,
  });
}
```

## CLOVA 요청 구성

각 페이지/이미지마다 `{ format, name, data }` 구조를 만들고, CLOVA API에 `lang: 'ko'`, `resultType: 'string'`을 지정했다. schoolmeets에서는 CLOVA API 제한이 5개라서 안전하게 4개씩만 `mapWithConcurrencyLimit`으로 병렬 처리했다. 각 요청은 `fetchWithTimeout` 헬퍼로 60초 타임아웃을 붙였다.

```ts
// schoolmeets/src/shared/supabase/servers/ocr.server.ts
const maxConcurrentRequests = 4;

const ocrRequestBody = {
  images: [image],  // 항상 1개씩만 전송
  lang: 'ko',
  requestId: `ocr_${Date.now()}_${index}`,
  resultType: 'string',
  timestamp: Date.now(),
  version: 'V1',
};

const response = await fetchWithTimeout(
  process.env.OCR_INVOKE_URL!,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OCR-SECRET': process.env.X_OCR_SECRET!,
    },
    body: JSON.stringify(ocrRequestBody),
  },
  60000,  // 60초 타임아웃
);
```

## 병렬 처리와 결과 수집

`processImagesInBatches`가 4개씩 슬라이스로 끊어 비동기로 호출한다. `Promise.allSettled`로 실패한 요청은 빈 배열로 대체하고, 성공한 요청에서 `inferText`를 추출해 결과 배열에 넣었다.

## 겪은 이슈

- 대용량 PDF: 페이지가 많을수록 처리 시간이 길어졌다. `pageLimit` 기본값을 1로 두고, 필요할 때만 클라이언트에서 늘리도록 했다.
- 응답 파싱 오류: CLOVA에서 JSON 대신 에러 HTML을 반환하는 경우가 있었다. 모든 응답을 try/catch로 감싸고 실패 시 빈 배열을 반환해 전체 플로우가 끊기지 않게 했다.
- 타임아웃: 외부 API가 느릴 때를 대비해 fetch에 AbortController 타임아웃을 붙였다.

사용자가 학력 증빙 파일을 올리면 몇 초 내에 OCR 결과가 돌아온다. 운영자가 수동으로 입력하던 시간을 줄였고, 실패한 페이지만 골라 다시 시도할 수 있게 로그도 남겼다. 다음 목표는 OCR 결과를 정규식으로 파싱해 자동 검증 비율을 높이는 것이다.

# Reference
- https://clova.ai/ocr
- https://pdf-lib.js.org/
- https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API

# 연결문서
- [[비동기 체인 플래그로 긴 API 호출 처리하기]]
- [[Next.js Fluid Computing과 maxDuration 적용]]
- [[NextJs와 도커 사용시 핫리로드 불가 문제]]
