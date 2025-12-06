---
tags:
  - Engineering
  - IssueNote
  - React
  - UX
  - Frontend
title: React Quill에 서버 이미지 업로드 기능 추가하기
created: '2024-04-25 10:45'
modified: '2024-04-25 10:47'
---

## 리액트 퀼 에디터에서 이미지 업로드 기능 구현하기

웹 애플리케이션에서 리치 텍스트 편집기를 구현하는 것은 흔한 요구사항 중 하나입니다. `React-Quill` 은 리액트 기반 프로젝트에 풍부한 텍스트 편집 기능을 쉽게 통합할 수 있도록 도와주는 라이브러리입니다. 본 글에서는 `React-Quill` 을 사용하여 이미지 업로드 기능을 구현하는 방법에 대해 자세히 설명하겠습니다.

### 기본 설정

먼저 `React-Quill` 과 관련 스타일을 프로젝트에 추가합니다.

```javascript
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
```

### 이미지 업로드 핸들러 구현

이미지 업로드를 위한 핸들러는 사용자가 이미지 파일을 선택할 수 있도록 입력 요소를 동적으로 생성합니다. 파일이 선택되면, 해당 파일을 서버로 전송하고 반환된 URL 을 에디터에 삽입하는 과정을 포함합니다.

```javascript
const imageHandler = () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.setAttribute('accept', 'image/*');
    input.click();

    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;

        const url = await uploadEditorPhoto(file);  // 서버로 파일을 업로드하고 URL을 받아옴

        if (quillRef.current) {
            const quillEditor = quillRef.current.getEditor();
            const index = (quillEditor.getSelection() as RangeStatic).index;
            quillEditor.insertEmbed(index, 'image', url);  // 에디터의 현재 위치에 이미지 삽입
        }
    };
};
```

### 에디터 설정

`React-Quill` 의 `modules` 객체를 활용하여 툴바에 이미지 업로드 버튼을 추가하고, 위에서 작성한 `imageHandler` 를 연결합니다. 이렇게 하면 이미지 아이콘을 클릭할 때마다 이미지 업로드 핸들러가 호출됩니다.

```javascript
const modules = React.useMemo(() => ({
    toolbar: {
        container: [
            ['bold', 'italic', 'underline', 'strike'],  // 기본 텍스트 포맷팅 옵션
            ['image'],  // 이미지 업로드 버튼 추가
        ],
        handlers: {
            image: imageHandler
        }
    }
}), []);
```

### 전체 컴포넌트 구성

마지막으로 `ReactQuill` 컴포넌트를 사용하여 위에서 정의한 설정을 적용합니다.

```javascript
return (
    <div id="editor" className="w-full relative" style={{ height: '600px' }}>
        <ReactQuill
            className="w-full max-w-full"
            style={{ height: '600px' }}
            ref={quillRef}
            theme="snow"
            modules={modules}
            formats={formats}
            value={value}
            placeholder="내용을 입력하세요."
            onChange={(content, delta, source, editor) => {
                setValue(editor.getHTML());
            }}
        />
    </div>
);
```

### 정리

이러한 구현을 통해 사용자는 웹 기반 텍스트 에디터에서 직접 이미지를 업로드할 수 있으며, 선택한 이미지는 서버로부터 반환된 URL 을 통해 에디터 내에 즉시 반영됩니다. `React-Quill` 의 유연성과 자바스크립트의 동적 요소 처리 능력을 활용하여 풍부한 사용자 경험을 제공할 수 있습니다.

이 기능은 사용자가 컨텐츠를 보다 효과적으로 관리하게 도와주며, 복잡한 파일 업로드 로직을 클라이언트 사이드에서 쉽게 처리할 수 있도록 합니다. 따라서, 다양한 웹 애플리케이션에서 풍부한 콘텐츠 생성 도구로서의 역할을 훌륭히 수행할 수 있습니다.

# Reference

# 연결문서
- [[React Quill 에디터에서 YouTube 링크를 이용한 비디오 삽입 방법]]
- [[NICE 본인인증 팝업을 Next.js에서 안전하게 다루기]]
- [[React Context로 가벼운 통화 로컬라이제이션 구축기]]
