---
tags:
  - React
  - Canvas
  - jsPDF
  - PDF
  - Automation
  - Docs
title: Canvas + jsPDF로 인증 문서 자동 생성
created: 2024-02-14 10:25
modified: 2024-02-14 10:25
---

대량의 인증서를 PDF로 발급해야 하는 업무를 맡았다. 디자인이 조금만 바뀌어도 Figma에서 다시 편집해 일일이 PDF로 내보내곤 했다. 이 반복 작업을 끝내고 싶어 Canvas와 jsPDF를 엮어 자동 생성 파이프라인을 만들었다.

## 가상 DOM과 domToPng

React 컴포넌트를 가상 DOM으로 렌더링하고, `modern-screenshot`의 `domToPng`로 고해상도 이미지를 만든 뒤 jsPDF에 삽입했다. 실제 화면에 보이지 않는 `CertificatePlusLiteVirtual` 컴포넌트를 만들고, `ref`로 접근해 캡처했다. 595x842px(A4) 기준으로 2배 스케일을 적용해 인쇄 품질을 유지했다.

```tsx
const pdf = new jsPDF('p', 'mm', 'a4', true);
for (let i = 0; i < certificatePluses.length; i++) {
  setProgress({ current: i + 1, total: certificatePluses.length });
  const dataUrl = await generatePreviewDataUrl(virtualA4Ref);
  if (!dataUrl) continue;
  if (i > 0) pdf.addPage();
  pdf.addImage(dataUrl, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
}
const blobPDF = new Blob([pdf.output('blob')], { type: 'application/octet-stream' });
saveAs(blobPDF, `${filename}.pdf`);
```

`jsPDF`에 직접 이미지를 넣되, `FAST` 모드를 사용해 생성 시간을 줄였다.

## domToPng 헬퍼

이미지가 모두 로드되기 전 캡처하면 빈 공간이 생겼다. 로딩 확인 루프를 돌도록 했다.

```ts
export async function generatePreviewDataUrl(virtualA4Ref: React.RefObject<HTMLDivElement | null>) {
  if (!virtualA4Ref.current) return null;
  await Promise.all(
    Array.from(virtualA4Ref.current.getElementsByTagName('img')).map(
      img =>
        new Promise(resolve => {
          const checkImage = () => {
            if (img.complete && img.naturalWidth !== 0) resolve(null);
            else setTimeout(checkImage, 100);
          };
          img.onload = () => resolve(null);
          img.onerror = () => resolve(null);
          checkImage();
        }),
    ),
  );

  return domToPng(virtualA4Ref.current, {
    width: 595.28,
    height: 841.89,
    scale: 2,
    style: { transform: 'none' },
  });
}
```

## 진행 피드백

100장 이상 생성할 때도 남은 시간을 보여주기 위해 `performance.now()`로 평균 처리 시간을 계산했다. 토스트 메시지는 진행률과 예상 남은 시간을 함께 보여줬다. "약 2분 30초 남음" 같은 메시지를 띄우니 사용자 만족도가 꽤 올라갔다.

## 겪은 이슈

- Safari 색상: `<canvas>`를 PNG로 변환할 때 색상이 흐릿해졌다. `domToPng` 옵션에 `style: { transform: 'none' }`을 넣고, CSS에 `image-rendering: crisp-edges`를 적용해 해결했다.
- 메모리 부족: 50장마다 `await new Promise(resolve => setTimeout(resolve, 100))`으로 휴지 시간을 두었다. Claude에게 브라우저 메모리 추이를 확인하는 devtools 스크립트를 부탁해 병목 지점을 파악했다.

자동화 이후로 인증서 디자인이 바뀌어도 React 컴포넌트만 수정하면 그대로 반영된다. 한 번에 200장 이상을 생성해도 3분 안팎이면 끝나고, PDF 용량도 40%가량 줄었다. 다음엔 텍스트 추출용 메타데이터를 PDF에 삽입하는 기능도 고민 중이다.

# Reference
- https://github.com/parallax/jsPDF
- https://developer.mozilla.org/docs/Web/API/Canvas_API

# 연결문서
- [[크롬 확장프로그램으로 만든 다국어 로렘 입숨 생성기 - 개발부터 배포까지]]
- [[Next.js App Router + Firebase Auth 관리자 인증]]
- [[ESLint + Prettier + Husky 자동화 구성]]
