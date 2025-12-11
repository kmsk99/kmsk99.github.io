---
tags:
  - NextJS
  - Verification
  - Popup
  - Security
  - UX
title: NICE 본인인증 팝업을 Next.js에서 안전하게 다루기
created: 2025-10-09 14:06
modified: 2025-10-09 14:06
---

# Intro
저는 본인인증 팝업이 뜨자마자 브라우저가 멈추거나 갑자기 닫혀버리는 바람에 고객센터 전화가 폭주하던 시절을 아직도 기억합니다. 그래서 “팝업을 열고 닫는 과정, 그리고 후속 검증까지 모두 신뢰할 수 있게 만들자”는 목표로 Next.js 기반 인증 플로우를 다시 설계했습니다.

## 핵심 아이디어 요약
- React 훅으로 팝업을 제어하고 `postMessage`로 전달되는 결과만 필터링했습니다.
- Next.js API Route를 프록시로 두어 인증 토큰 발급과 결과 검증을 중앙에서 처리했습니다.
- 성공 시 사용자 프로필 정보를 즉시 업데이트해 중복 입력을 없앴습니다.

## 준비와 선택
1. **팝업 통신**: `postMessage`의 `source` 필드를 검증해 신뢰할 수 있는 메시지만 처리했습니다.
2. **토큰 발급**: Next.js API Route가 외부 인증 게이트웨이를 호출해 토큰을 받아오고, 로컬 개발 시에만 SSL 검증을 완화했습니다.
3. **결과 처리**: 인증 성공 시 프로필 정보를 서버 측에서 갱신하고, 실패하더라도 UI가 다시 시도할 수 있게 상태를 관리했습니다.

## 구현 여정
### Step 1: 팝업 열기와 폼 제출
훅의 `startVerification` 함수는 먼저 토큰 발급 API를 호출해 `token_version_id`, `enc_data`, `integrity_value`를 내려받습니다. 그런 다음 클릭 이벤트 안에서만 `window.open`을 호출해 팝업 차단을 피했습니다.

```ts
export async function startVerification(returnUrl?: string) {
  setIsLoading(true);
  const endpoint = returnUrl
    ? `/api/verify/checkplus?return_url=${encodeURIComponent(returnUrl)}`
    : '/api/verify/checkplus';
  const response = await fetch(endpoint);
  const { data } = await response.json();

  const popup = window.open(
    '',
    'checkPlusPopup',
    'width=480,height=812,top=100,left=100,noopener=yes',
  );
  if (!popup) throw new Error('팝업 차단이 감지되었습니다.');

  submitHiddenForm(popup, {
    m: 'service',
    token_version_id: data.token_version_id,
    enc_data: data.enc_data,
    integrity_value: data.integrity,
  });
}
```

팝업에 값을 전달할 때는 form 엘리먼트를 동적으로 만들어 제출했습니다.

```ts
function submitHiddenForm(targetWindow: Window, fields: Record<string, string>) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = 'https://nice.checkplus.co.kr/CheckPlusSafeModel/checkplus.cb';
  form.target = targetWindow.name;

  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}
```

### Step 2: 메시지 수신과 상태 관리
`isVerifying` 상태일 때만 `window.addEventListener('message')`를 등록해 인증 성공·실패 메시지를 구분했고, 1초 간격으로 팝업이 닫혔는지 감시하는 인터벌을 두었습니다.

### Step 3: 서버 프록시와 보안 조치
토큰 발급 API는 외부 인증 게이트웨이를 대신 호출해 응답을 검증한 뒤 클라이언트에 전달합니다. 이때 실패 메시지를 일관된 형식으로 감싸 프런트엔드가 쉽게 처리하도록 했습니다.

### Step 4: 결과 저장과 후속 처리
결과 처리 API는 인증 게이트웨이가 전달한 결과를 검증한 뒤 사용자 프로필을 업데이트합니다. 실패해도 결과값을 그대로 전달해 프런트가 재시도 버튼을 노출할 수 있게 했습니다.

## 겪은 이슈와 해결 과정
- **팝업 차단 이슈**: 사용자의 클릭 이벤트 안에서만 `window.open`을 호출하도록 강제했습니다. `startVerification`을 직접 버튼에 연결하니 대부분의 브라우저에서 허용되더군요.
- **SSL 검증 오류**: 개발 서버와 Express 프록시가 둘 다 로컬일 때 인증서가 맞지 않는 문제가 발생했습니다. 개발 모드에서만 `process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'`을 설정해 디버깅을 이어갔습니다.
- **재시도 UX**: 사용자가 팝업을 닫았다가 다시 열면 상태가 꼬였습니다. 메시지에서 `type === 'VERIFICATION_RETRY'`를 받아오면 `isVerifying`을 false로 돌리고 UI에 재시도 버튼을 노출했습니다.

## 결과와 회고
이제는 본인인증이 실패해도 사용자가 어디서 막혔는지 명확히 알게 되었고, 팝업이 닫혀도 UI가 정상으로 돌아갑니다. 무엇보다 성공 시 프로필 정보가 즉시 업데이트돼 다음 단계에서 다시 묻지 않아도 돼요. 다음에는 `/api/verify/check-already-registered`처럼 DI 중복 검사를 한 화면에서 보여주는 실험을 해볼 계획입니다.

여러분은 본인인증 팝업을 어떻게 제어하고 계신가요? 팁이 있다면 꼭 댓글로 공유해 주세요. 팝업 UX는 언제나 까다롭지만 같이 해법을 찾아가면 훨씬 덜 힘들더라고요.

# Reference
- https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
- https://nextjs.org/docs/app/building-your-application/routing/route-handlers

# 연결문서
- [[React Context로 가벼운 통화 로컬라이제이션 구축기]]
- [[공공데이터 대학 API 프록시를 만들며 챙긴 보안 옵션]]
- [[네트워크 흔들릴 때도 프로필 세션을 지키는 useProfileWithRetry 만들기]]
