---
tags:
  - Engineering
  - TechDeepDive
  - ReactNative
  - Expo
  - Automation
  - Frontend
  - Mobile
title: Deep Link Friendly Redirect Validation을 구현하며 배운 보안 체크리스트
created: '2024-11-28 09:00'
modified: '2024-11-28 09:00'
slug: >-
  deep-link-friendly-redirect-validationeul-guhyeonhamyeo-baeun-boan-chekeuriseuteu
---

# Intro
- 저는 인증 콜백을 띄울 때마다 마음 한구석에서 "혹시나" 하는 불안을 느꼈어요.
- 모바일 딥링크와 웹 브라우저를 동시에 지원해야 했고, return_url을 잘못 열어주면 순식간에 오픈 리다이렉트가 될 수 있다는 걸 알았죠.
- 그래서 Express 미들웨어 앞단에 방어막을 치기 시작했고, 그 과정을 정리해봤습니다.

## 핵심 아이디어 요약
- URL을 무턱대고 믿지 말고, 프로토콜·호스트·패턴을 순차적으로 검증합니다.
- 모바일 딥링크는 화이트리스트 스킴으로, 웹은 도메인 화이트리스트로 필터링합니다.
- 정규식으로 의심스러운 문자열을 한 번 더 걸러내며, 환경 변수로 운영/개발 조건을 분리합니다.

## 준비와 선택
- 우선 `.env`에서 `ALLOWED_RETURN_DOMAINS`를 관리해 팀원과 공유 가능한 단일 소스를 만든다고 결정했습니다.
- 모바일 앱 팀과 협의해 허용할 스킴 목록을 정했고, 급하게 늘릴 수 있도록 배열에 선언해두었습니다.
- 프로덕션에서는 `localhost`를 차단해야 했기에 `NODE_ENV`를 함께 확인하도록 설계했습니다.

## 구현 여정
- **Step 1: URL 파싱으로 예외 케이스 잡기**  
  `new URL(returnUrl)`이 실패하면 바로 차단하도록 두었습니다. 여기서 예외가 던져지는 덕분에 엉뚱한 문자열도 잡아냅니다.
- **Step 2: 모바일 딥링크 화이트리스트**  
  아래처럼 모바일 스킴 배열을 만들고, 해당 스킴으로 시작하면 웹 규칙을 건너뛰고 바로 허용합니다. React Native, Expo, Capacitor처럼 커스텀 스킴이 흔하기 때문에 필수였어요.

```ts
const mobileSchemes = ['schoolmeets', 'myapp', 'yourapp']; // 앱 팀과 합의한 스킴만 허용
if (mobileSchemes.some(scheme => returnUrl.startsWith(`${scheme}://`))) {
  return true;
}
```

- **Step 3: 프로토콜과 환경 별 필터**  
  http/https만 허용하고, 프로덕션에서는 `localhost`가 들어오면 즉시 경고를 남깁니다. 수동 테스트하다가 깜빡하고 실서버로 던지는 위험을 막아주더군요.
- **Step 4: 의심 패턴 정규식**  
  배포 직전, `javascript:`나 `data:` 스킴을 편법으로 사용하는 공격 시나리오를 발견했습니다. 아래 정규식 배열로 간단히 막았습니다.

```ts
const suspiciousPatterns = [
  /\.(exe|bat|sh|cmd)$/i,      // 실행 파일을 노린 다운로드 유도 차단
  /javascript:/i,              // 스킴 기반 XSS 공격 방지
  /data:/i,                    // data URI로 인한 인젝션 차단
  /file:/i,
  /[<>"']/                     // HTML/JS 인젝션 문자 필터
];
```

- **Step 5: 도메인 화이트리스트**  
  마지막으로 `allowedReturnDomains` 배열과 일치하는지 검사하고, 실패하면 로그에 허용 목록을 함께 남깁니다. 덕분에 프런트 팀이 에러 로그만 봐도 원인을 바로 파악하더라고요.
- 예상치 못한 이슈는 React Native 환경이 origin을 비워서 보내는 경우였습니다. 덕분에 CORS와 return_url 검증을 분리해야 한다는 교훈을 얻었습니다.
- 정규식을 너무 빡빡하게 짠 건 아닌지 확인하려고 GPT에게 몇 가지 URL 샘플을 물어보기도 했습니다. 의심 스킴을 더 찾아주는 데 꽤 도움이 됐어요.

## 결과와 회고
- 오픈 리다이렉트를 걱정하던 밤샘은 줄었고, 로그에는 차단된 URL과 원인이 깔끔히 남았습니다.
- 모바일과 웹이 같은 API를 공유하면서도 서로 다른 규칙을 적용할 수 있게 된 게 가장 큰 수확입니다.
- 다음에는 정규식 대신 URL 스캐너 라이브러리를 붙여보고, 허용 스킴을 관리자 페이지에서 수정할 수 있도록 자동화해볼 생각이에요.
- 여러분은 하이브리드 앱에서 redirect 검증을 어떻게 하고 계신가요? 댓글로 팁을 공유해주시면 저도 따라 해보고 싶습니다.

# Reference
- https://developer.mozilla.org/en-US/docs/Web/API/URL/URL
- https://expressjs.com/en/guide/error-handling.html

# 연결문서
- [[ActionSheet를 안전하게 감싸는 훅을 만든 이유]]
- [[Android 더블백 종료 규칙을 직접 다듬으며 배운 것]]
- [[공공기관 위치 데이터를 우리가 쓰는 방식으로 정제하기]]
