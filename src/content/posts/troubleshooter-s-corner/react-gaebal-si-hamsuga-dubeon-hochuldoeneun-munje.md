---
tags:
  - Engineering
  - IssueNote
  - React
  - Frontend
title: React 개발 시 함수가 두번 호출되는 문제
created: '2023-01-17 01:47'
modified: '2023-01-17 01:55'
slug: react-gaebal-si-hamsuga-dubeon-hochuldoeneun-munje
---

# Intro

- react 개발 시 함수가 두번씩 호출되어 useEffect등의 함수를 썼을 때, 문자열이 두번 저장되는 등의 오류가 있다

# 해결 방법

- 간단히 index.js내에서
``` js
root.render(
<React.StrictMode>
	<App />
</React.StrictMode>
);
```
React.StrictMode를 주석처리해준다
``` js
root.render(
// <React.StrictMode>
<App />
// </React.StrictMode>
);
```
Strictmode는 Side effect를 줄이기 위해 함수를 두번씩 실행한다.
이는 dev환경에서만 두번씩 호출되고 Production에서는 무시된다.

# Reference

- https://reactjs.org/docs/strict-mode.html#detecting-unexpected-side-effects

# 연결문서
- [[React Quill 에디터에서 YouTube 링크를 이용한 비디오 삽입 방법]]
- [[React Quill에 서버 이미지 업로드 기능 추가하기]]
- [[React 에서 인앱브라우저에서 외부브라우저 띄우기]]
