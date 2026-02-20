---
tags:
  - TipTap
  - Tentap
  - RichText
  - React
  - ReactNative
title: TipTap과 Tentap으로 웹-모바일 리치 텍스트 에디터 구현
created: 2025-03-19
modified: 2025-07-03
---

# 배경

웹과 모바일 앱에서 동일한 게시글 작성/조회 경험을 제공해야 했다. 마크다운이 아닌 WYSIWYG 에디터가 필요했고, 작성된 HTML을 양쪽 플랫폼에서 일관되게 렌더링해야 했다. 웹에서는 TipTap(ProseMirror 기반), 모바일에서는 Tentap(@10play/tentap-editor)을 선택했다.

# 웹: TipTap 에디터

## 확장 구성

TipTap은 StarterKit으로 기본 마크다운 기능(제목, 목록, 코드 블록 등)을 제공하고, 필요한 기능을 Extension으로 추가하는 구조다.

```ts
import { Extension } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';

const KoreanIMEFixExtension = Extension.create({
  name: 'koreanIMEFix',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            compositionstart: () => { /* IME 입력 시작 */ },
            compositionend: (view) => {
              // 한글 조합 완료 후 에디터 상태 동기화
              const { state } = view;
              view.dispatch(state.tr);
            },
          },
        },
      }),
    ];
  },
});

export function createTiptapExtensions(placeholder?: string) {
  return [
    StarterKit,
    Image,
    Link.configure({ openOnClick: false }),
    Placeholder.configure({ placeholder: placeholder ?? '내용을 입력하세요' }),
    KoreanIMEFixExtension,
  ];
}
```

한글 IME 문제는 TipTap(ProseMirror)에서 자주 발생한다. 한글 자모 조합 중에 에디터가 중간 상태를 인식하지 못해 글자가 깨지거나 중복된다. `compositionend` 이벤트에서 트랜잭션을 강제 dispatch해 에디터 상태를 동기화한다.

## 에디터 컴포넌트

```tsx
import { EditorContent, useEditor } from '@tiptap/react';
import { getTiptapEditorOptions } from '../libs';

function Editor({ content, onChange, placeholder }: EditorProps) {
  const editor = useEditor({
    ...getTiptapEditorOptions(placeholder),
    content,
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
  });

  return <EditorContent editor={editor} className="prose max-w-none" />;
}
```

`getHTML()`로 에디터 내용을 HTML 문자열로 추출한다. 이 HTML이 DB에 저장되고 웹/모바일 양쪽에서 렌더링된다.

## 스타일링

TipTap의 Placeholder 확장은 CSS의 `::before` 의사 요소를 사용한다.

```css
.tiptap .is-editor-empty:first-child::before {
  @apply text-gray-60;
  @apply content-[attr(data-placeholder)];
  @apply float-left;
  @apply pointer-events-none;
  @apply h-0;
}
```

`float-left`와 `h-0`으로 placeholder가 공간을 차지하지 않으면서 에디터 영역에 표시되도록 했다. `data-placeholder` 속성에서 텍스트를 가져온다.

# 모바일: Tentap 에디터

## 설정

Tentap은 `@10play/tentap-editor`로, WebView 기반 TipTap 에디터를 React Native에서 사용할 수 있게 해준다.

```tsx
import {
  CoreBridge,
  PlaceholderBridge,
  RichText,
  TenTapStartKit,
  useEditorBridge,
  useEditorContent,
} from '@10play/tentap-editor';

function Editor({ content, placeholder }: EditorProps) {
  const editor = useEditorBridge({
    autofocus: false,
    bridgeExtensions: [
      ...TenTapStartKit,
      CoreBridge.configureCSS(editorCSS),
      PlaceholderBridge.configureExtension({ placeholder }),
    ],
    initialContent: content,
  });

  const html = useEditorContent(editor, { type: 'html' });

  return (
    <RichText
      editor={editor}
      allowsFullscreenVideo={false}
      androidLayerType="software"
    />
  );
}
```

`TenTapStartKit`은 TipTap의 StarterKit에 대응하는 브릿지 확장 세트다. `CoreBridge.configureCSS`로 WebView 내부의 에디터 스타일을 커스텀 CSS로 주입할 수 있다.

`androidLayerType: 'software'`는 Android에서 WebView 렌더링 이슈를 방지하기 위한 설정이다. 하드웨어 가속이 텍스트 입력과 충돌하는 경우가 있다.

## 커스텀 폰트 주입

모바일 에디터에서 앱과 동일한 폰트를 사용하기 위해 CSS에 Pretendard 폰트를 base64로 인코딩해 주입했다.

```ts
export const editorCSS = `
  @font-face {
    font-family: 'Pretendard';
    src: url(data:font/ttf;base64,...) format('truetype');
    font-weight: 400;
  }
  body {
    font-family: 'Pretendard', -apple-system, sans-serif;
    font-size: 16px;
    line-height: 1.6;
  }
`;
```

WebView는 앱의 폰트를 자동으로 참조하지 못하므로, base64 인라인 폰트로 일관된 타이포그래피를 보장한다.

# 컨텐츠 렌더링

## 웹

저장된 HTML을 `dangerouslySetInnerHTML` 대신 Tailwind의 `prose` 클래스로 스타일링한다. TipTap이 생성하는 HTML은 시맨틱하므로 `prose` 클래스만으로 충분한 스타일이 적용된다.

## 모바일

React Native에서는 HTML을 네이티브 컴포넌트로 변환해야 한다.

```tsx
import RenderHtml from 'react-native-render-html';

function PostContent({ content }: { content: string }) {
  const { width } = useWindowDimensions();

  const tagsStyles = useMemo(() => ({
    body: { color: '#1a1a1a', fontSize: 16, lineHeight: 24 },
    a: { color: '#2563eb', textDecorationLine: 'none' },
    img: { borderRadius: 8 },
    p: { marginTop: 0, marginBottom: 12 },
  }), []);

  return (
    <RenderHtml
      contentWidth={width}
      source={{ html: content || '' }}
      tagsStyles={tagsStyles}
    />
  );
}
```

`react-native-render-html`은 HTML 태그를 React Native의 `Text`, `View`, `Image` 등으로 매핑한다. `tagsStyles`로 각 태그의 네이티브 스타일을 지정한다.

# 웹-모바일 일관성

| 항목 | 웹 (TipTap) | 모바일 (Tentap) |
|------|-------------|----------------|
| 저장 형식 | HTML | HTML |
| 에디터 엔진 | ProseMirror (네이티브 DOM) | ProseMirror (WebView) |
| 확장 방식 | `Extension.create()` | `Bridge` 패턴 |
| 스타일 주입 | Tailwind `prose` | `CoreBridge.configureCSS()` |
| 한글 IME | 커스텀 Extension | WebView가 처리 |
| 렌더링 | `dangerouslySetInnerHTML` / prose | `react-native-render-html` |

저장 형식을 HTML로 통일한 것이 핵심이다. 마크다운으로 저장하면 양쪽에서 각각 파싱/렌더링 차이가 생기지만, HTML이면 웹에서는 그대로 렌더링하고 모바일에서는 HTML 파서가 처리한다.

# Reference

- https://tiptap.dev/docs
- https://github.com/nicksrandall/10play-tentap-editor
- https://meliorence.github.io/react-native-render-html/
- https://prosemirror.net/

# 연결문서

- [[ActionSheet 래퍼 훅 구현]]
- [[웹뷰 메시지 브릿지 패턴]]
