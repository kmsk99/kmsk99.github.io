---
tags:
  - OCR
  - CLOVA
  - PDF
  - NextJS
  - Automation
  - Concurrency
title: CLOVA OCR API와 PDF 페이지 분할로 학력 증빙 자동화
created: '2025-10-09 14:06'
modified: '2025-10-09 14:06'
---

# Intro
저는 학교 기록을 검증하려고 직접 PDF를 열어 정보를 옮겨 적다가 손목이 남아나지 않았습니다. 그래서 Next.js API Route에서 CLOVA OCR API를 호출해 텍스트를 자동으로 추출하는 파이프라인을 만들었습니다. PDF를 페이지별로 쪼개고, 안전한 동시성으로 요청을 보내는 부분이 핵심이었어요.

## 핵심 아이디어 요약
- PDF는 `pdf-lib`으로 페이지를 하나씩 잘라 Base64로 인코딩해 CLOVA OCR에 보냅니다.
- 이미지와 PDF 모두 `images` 배열에 담아 순차적으로 API를 호출하고, 최대 4개씩만 병렬로 처리합니다.
- OCR 결과에서 `inferText`를 모아 한 번에 반환해 후속 로직이 쉽게 활용할 수 있도록 했습니다.

## 준비와 선택
1. **입력 검증**: 확장자가 pdf/jpg/jpeg/png인지 체크해 잘못된 파일은 400으로 막았습니다.
2. **동시성 제어**: CLOVA API 제한이 5개라서 안전하게 4개씩만 Promise.allSettled로 병렬 처리했습니다.
3. **타임아웃**: 각 요청은 fetch에 기본 타임아웃이 없으니, 네트워크가 느릴 때를 대비해 별도 타임아웃까지 고려했습니다.

## 구현 여정
### Step 1: PDF 페이지 분할
`PDFDocument.load`로 업로드된 PDF를 읽고, `copyPages`로 한 페이지씩 새 PDF를 만들어 Base64로 변환했습니다. `pageLimit` 파라미터를 받아 최대 처리 페이지 수도 제어했습니다.

### Step 2: CLOVA 요청 구성
각 페이지/이미지마다 `{ format, name, data }` 구조를 만들고, CLOVA API에 `lang: 'ko'`, `resultType: 'string'`을 지정했습니다. `X-OCR-SECRET` 헤더와 `ocrInvokeUrl`은 환경 변수에서 가져옵니다.

```ts
import { PDFDocument } from 'pdf-lib';

interface OcrImagePayload {
  format: 'pdf' | 'jpg' | 'png';
  name: string;
  data: string; // Base64
}

export async function splitPdfIntoImages(
  pdfBytes: ArrayBuffer,
  pageLimit = 1,
): Promise<OcrImagePayload[]> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const totalPages = pdfDoc.getPageCount();
  const limit = Math.min(Math.max(pageLimit, 1), totalPages);

  const payloads: OcrImagePayload[] = [];
  for (let pageIndex = 0; pageIndex < limit; pageIndex += 1) {
    const singlePagePdf = await PDFDocument.create();
    const [page] = await singlePagePdf.copyPages(pdfDoc, [pageIndex]);
    singlePagePdf.addPage(page);

    const base64Data = Buffer.from(await singlePagePdf.save()).toString('base64');
    payloads.push({
      format: 'pdf',
      name: `page_${pageIndex + 1}`,
      data: base64Data,
    });
  }

  return payloads;
}
```

```ts
const ocrRequestBody = {
  images: [{ format: 'pdf', name: `page_${pageIndex}`, data: base64Data }],
  lang: 'ko',
  requestId: `ocr_${Date.now()}_${pageIndex}`,
  resultType: 'string',
  timestamp: Date.now(),
  version: 'V1',
};

const response = await fetch(process.env.OCR_INVOKE_URL!, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-OCR-SECRET': process.env.X_OCR_SECRET!,
  },
  body: JSON.stringify(ocrRequestBody),
});
```

### Step 3: 병렬 처리와 결과 수집
`processImagesInBatches`가 4개씩 슬라이스로 끊어 비동기로 호출합니다. `Promise.allSettled`로 실패한 요청은 빈 배열로 대체하고, 성공한 요청에서 `inferText`를 추출해 결과 배열에 넣었습니다.

## 겪은 이슈와 해결 과정
- **대용량 PDF**: 페이지가 많을수록 처리 시간이 길어졌습니다. `pageLimit` 기본값을 1로 두고, 필요할 때만 클라이언트에서 늘리도록 했습니다.
- **응답 파싱 오류**: CLOVA에서 JSON 대신 에러 HTML을 반환하는 경우가 있었습니다. 모든 응답을 try/catch로 감싸고 실패 시 빈 배열을 반환해 전체 플로우가 끊기지 않게 했습니다.
- **타임아웃**: 외부 API가 느릴 때를 대비해 fetch에 AbortController 타임아웃을 붙였습니다.

## 결과와 회고
이제 사용자가 학력 증빙 파일을 올리면 몇 초 내에 OCR 결과가 돌아옵니다. 운영자가 수동으로 입력하던 시간을 줄였고, 실패한 페이지만 골라 다시 시도할 수 있게 로그도 남겼습니다. 다음 목표는 OCR 결과를 정규식으로 파싱해 자동 검증 비율을 높이는 것입니다.

여러분은 문서 OCR을 어떻게 처리하고 계신가요? 다른 서비스나 최적화 팁이 있다면 꼭 알려주세요.

# Reference
- https://pdf-lib.js.org/
- https://clova.ai/en/ocr
- https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API

# 연결문서
- [Chain Flag로 긴 호출 시간을 견디는 법](/post/chain-flagro-gin-hochul-siganeul-gyeondineun-beop)
- [Next.js Fluid Computing으로 서버 리듬을 조율한 이야기](/post/next-js-fluid-computingeuro-seobeo-rideumeul-joyulhan-iyagi)
- [NextJs와 도커 사용시 핫리로드 불가 문제](/post/nextjswa-dokeo-sayongsi-hatrirodeu-bulga-munje)
