---
tags:
  - HTTPS
  - AWS
  - ALB
  - NodeJS
  - DevOps
  - LocalDev
title: 로컬 HTTPS와 클라우드 로드밸런서를 함께 다루며 얻은 실전 노하우
created: 2024-11-28 10:00
modified: 2024-11-28 10:00
---

# Intro
- 저는 개발 환경에서 HTTPS가 안 되면 손이 꽁꽁 묶이는 타입입니다.
- 그런데 운영에서는 AWS ALB가 SSL을 끝단에서 맡고 있어서, 서버는 HTTP만 떠야 했어요.
- 두 세계를 넘나드는 서버 부팅 로직을 직접 짜보면서 얻은 팁을 공유하고 싶습니다.

## 핵심 아이디어 요약
- `NODE_ENV`를 기준으로 개발에서는 HTTP/HTTPS를 동시에 띄우고, 운영에서는 HTTP만 노출합니다.
- mkcert로 로컬에서 신뢰할 수 있는 셀프사인 인증서를 자동 생성하도록 스크립트를 붙였습니다.
- 로그로 현재 모드와 HTTPS 상태를 분명하게 남겨 팀원 혼란을 줄였습니다.

## 준비와 선택
- `package.json`에 `dev:https` 스크립트를 추가해 `mkcert`를 자동 호출하도록 만들었습니다.
- `.env`에는 인증서 경로를 오버라이드할 수 있는 `SSL_CERT_PATH`, `SSL_KEY_PATH`를 추가했습니다.
- ALB 뒤에서 동작할 땐 프록시를 신뢰해야 해서 `app.set('trust proxy', true)`를 활성화했습니다.

## 구현 여정
- **Step 1: 프로덕션 분기**  
  `startServer` 함수에서 `nodeEnv`가 `production`일 때는 HTTP만 열고 `0.0.0.0`에 바인딩합니다. SSL은 ALB가 맡으니 서버가 이중으로 하려 들 필요가 없었어요.
- **Step 2: 개발에서 HTTPS 시도**  
  개발 모드에서는 HTTP를 기본으로 띄우고, `ssl` 디렉터리에 인증서가 있으면 HTTPS 서버를 추가합니다. 인증서가 없으면 콘솔에 `npm run generate-cert` 힌트를 남기죠.

```ts
if (fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
  const httpsOptions = {
    key: fs.readFileSync(path.resolve(sslKeyPath)),
    cert: fs.readFileSync(path.resolve(sslCertPath))
  };
  https.createServer(httpsOptions, app).listen(httpsPort, () => {
    console.log(`🔒 HTTPS Server is running on https://localhost:${httpsPort}`);
  });
} else {
  console.log(`⚠️  SSL certificates not found. Running HTTP only.`);
}
```

- **Step 3: mkcert와 npm 스크립트**  
  `npm run generate-cert`는 `ssl` 폴더를 만들고 `mkcert localhost 127.0.0.1 ::1`을 실행합니다. 덕분에 팀원마다 반복되는 수동 명령을 줄였습니다.
- **Step 4: 로그 메시지 다듬기**  
  프로덕션 모드에서는 "AWS ALB will handle SSL termination"을, 개발 모드에서는 HTTPS 실행 여부를 로그로 남겼습니다. 배포 중에 "왜 HTTPS가 안 떠?"라는 질문이 오면 로그 한 줄로 답이 되더군요.
- **Step 5: 예외 처리**  
  HTTPS 서버가 실패하더라도 앱이 죽으면 안 되기 때문에 try/catch로 감쌌습니다. 인증서가 깨져도 HTTP 개발 서버는 계속 뜨도록 했습니다.
- 셀프사인 인증서를 브라우저가 믿어줄지 걱정돼서, 저는 mkcert 문서를 다시 읽고 GPT에게 적용 순서를 확인하는 습관이 생겼습니다. 덕분에 새 노트북에서도 시행착오가 줄었어요.

## 결과와 회고
- 프런트 팀은 로컬에서 HTTPS API를 안정적으로 써볼 수 있게 되었고, 운영에서는 ALB 설정만으로 SSL을 관리할 수 있었습니다.
- `npm run dev` 하나로 HTTP/HTTPS 두 환경이 동시에 살아나니 DX가 확실히 좋아졌습니다.
- 다음에는 HTTP/2 지원과 자동 인증서 갱신(예: `mkcert -install` 체크)을 자동화하고 싶습니다.
- 여러분은 로컬 HTTPS를 어떻게 관리하시나요? 로컬 인증서 배포 팁이 있다면 꼭 들려주세요.

# Reference
- https://github.com/FiloSottile/mkcert
- https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html

# 연결문서
- [[EC2 초기 세팅 스크립트를 만들며 자동화에 집착한 이유]]
- [[버전 관리의 신세계, HeadVer 도입기 - JavaScript 개발자를 위한 완벽 가이드]]
- [[스탬프 누적과 리워드를 자동화한 워크플로우]]
