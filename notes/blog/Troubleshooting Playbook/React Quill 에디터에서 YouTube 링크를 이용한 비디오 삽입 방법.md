---
tags:
  - Engineering
  - IssueNote
  - React
  - UX
  - Frontend
title: React Quill 에디터에서 YouTube 링크를 이용한 비디오 삽입 방법
created: 2024-04-25 10:49
modified: 2024-04-25 10:59
uploaded: "false"
---

## React-Quill 에디터에서 YouTube 비디오 삽입 확장 기능 상세 구현

웹 개발에서 사용자에게 풍부한 컨텐츠 편집 기능을 제공하는 것은 웹사이트의 인터랙티비티와 사용자 만족도를 높이는 중요한 요소입니다. `React-Quill` 은 이러한 목적에 맞게 다양한 커스텀 콘텐츠를 쉽게 통합할 수 있는 리치 텍스트 에디터입니다. 여기서는 YouTube 비디오를 삽입하는 기능의 상세 구현 방법을 살펴보겠습니다.

### YouTube 비디오 삽입 기능의 구현

#### Custom Blot 정의

Quill 에디터의 확장성을 이용해 YouTube 비디오를 삽입할 수 있는 Custom Blot 을 생성합니다. `MediaBlot` 클래스는 `BlockEmbed` 를 상속받아 `iframe` 태그를 동적으로 생성하고 관리합니다.

```javascript
const BlockEmbed = Quill.import('blots/block/embed');

class MediaBlot extends BlockEmbed {
  static blotName = 'iframe';
  static tagName = 'iframe';

  static create(value) {
    let node = super.create();
    node.setAttribute('src', value);
    node.setAttribute('frameborder', '0');
    node.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
    node.setAttribute('allowfullscreen', true);
    node.setAttribute('width', '1024px');
    node.setAttribute('height', '576px');
    return node;
  }

  static value(node) {
    return node.getAttribute('src');
  }
}

Quill.register(MediaBlot);
```

#### YouTube URL 입력 및 처리

사용자가 유효한 YouTube URL 을 입력하면 해당 URL 을 분석하여 iframe 으로 변환하고 에디터에 삽입하는 로직을 구현합니다. 팝업 형태로 URL 을 입력받고, Enter 키를 누르면 비디오를 삽입합니다.

```javascript
function createYoutubePopup() {
  const popupContainer = document.createElement('div');
  popupContainer.style.position = 'absolute';
  popupContainer.style.top = '50%';
  popupContainer.style.left = '50%';
  popupContainer.style.transform = 'translate(-50%, -50%)';
  popupContainer.style.zIndex = '1000';
  popupContainer.style.padding = '20px';
  popupContainer.style.backgroundColor = 'white';
  popupContainer.style.border = '1px solid #ccc';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'YouTube URL을 입력하세요';
  popupContainer.appendChild(input);

  document.body.appendChild(popupContainer);
  input.focus();

  input.onkeyup = (event) => {
    if (event.key === 'Enter') {
      handleYoutubeInput(input.value);
      document.body.removeChild(popupContainer);
    }
  };
}

function handleYoutubeInput(url) {
  const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(youtubeRegex);
  if (match) {
    const embedUrl = `https://www.youtube-nocookie.com/embed/${match[2]}`;
    const quillEditor = quillRef.current.getEditor();
    const index = quillEditor.getSelection(true).index;
    quillEditor.insertEmbed(index, 'iframe', embedUrl);
  }
}
```

### Editor Formats 설정

`React-Quill` 의 `formats` 배열은 에디터가 지원하는 모든 포맷을 정의합니다. 여기에 `iframe` 을 추가하여 YouTube 비디오 삽입 기능을 활성화합니다.

```javascript
const formats = [
  'header', 'bold', 'italic', 'underline', 'strike', 'blockquote', 'code-block', 
  'formula', 'list', 'bullet', 'indent', 'link', 'image', 'align', 'color', 
  'background', 'video', 'iframe'  // iframe 포맷 추가
];
```

### 정리

이렇게 상세하게 YouTube 비디오 삽입 기능을 구현함으로써, 사용자는 URL 만 입력하면 손쉽게 비디오를 에디터 내에 삽입할 수 있습니다. 이 기능은 다양한 멀티미디어 콘텐츠를 통합하여 풍부한 사용자 경험을 제공하는 데 큰 도움이 됩니다.

# Reference

# 연결문서
- [[React Quill에 서버 이미지 업로드 기능 추가하기]]
- [[NICE 본인인증 팝업을 Next.js에서 안전하게 다루기]]
- [[React Context로 가벼운 통화 로컬라이제이션 구축기]]
