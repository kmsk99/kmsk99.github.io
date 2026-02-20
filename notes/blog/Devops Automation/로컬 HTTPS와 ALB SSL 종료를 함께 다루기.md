---
tags:
  - HTTPS
  - AWS
  - ALB
  - NodeJS
  - DevOps
  - LocalDev
title: 로컬 HTTPS와 ALB SSL 종료를 함께 다루기
created: 2024-11-28 10:00
modified: 2024-11-28 10:00
---

개발 환경에서 HTTPS가 안 되면 손이 꽁꽁 묶인다. 그런데 운영에서는 AWS ALB가 SSL을 끝단에서 맡고 있어서, 서버는 HTTP만 떠야 했다. 두 세계를 넘나드는 서버 부팅 로직을 직접 짜보면서 얻은 팁을 정리했다.

## NODE_ENV 기준 분기

`NODE_ENV`를 기준으로 개발에서는 HTTP/HTTPS를 동시에 띄우고, 운영에서는 HTTP만 노출한다. `package.json`에 `dev:https` 스크립트를 추가해 `mkcert`를 자동 호출하도록 만들었다. `.env`에는 인증서 경로를 오버라이드할 수 있는 `SSL_CERT_PATH`, `SSL_KEY_PATH`를 넣었다. ALB 뒤에서 동작할 땐 프록시를 신뢰해야 해서 `app.set('trust proxy', true)`를 활성화했다.

`startServer` 함수에서 `nodeEnv`가 `production`일 때는 HTTP만 열고 `0.0.0.0`에 바인딩한다. SSL은 ALB가 맡으니 서버가 이중으로 하려 들 필요가 없다. 개발 모드에서는 HTTP를 기본으로 띄우고, `ssl` 디렉터리에 인증서가 있으면 HTTPS 서버를 추가한다. 인증서가 없으면 콘솔에 `npm run generate-cert` 힌트를 남긴다.

```js
const httpsOptions = {
  key: fs.readFileSync('./localhost-key.pem'),
  cert: fs.readFileSync('./localhost.pem'),
};

app.prepare().then(() => {
  http.createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(PORT, err => {
    if (err) throw err;
    console.log(`> Ready on http://localhost:${PORT}`);
  });

  https.createServer(httpsOptions, (req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(PORT + 1, err => {
    if (err) throw err;
    console.log(`> HTTPS: Ready on https://localhost:${PORT + 1}`);
  });
});
```

인증서가 없으면 `pnpm init-https`를 먼저 실행하라는 안내를 README에 적어두었다.

## mkcert와 스크립트

mkcert로 로컬에서 신뢰할 수 있는 셀프사인 인증서를 자동 생성하도록 스크립트를 붙였다. 프로젝트에서는 `pnpm init-https`로 `scripts/init-https.sh`를 실행한다.

```bash
#!/bin/bash

MKCERT_INSTALLED=$(which mkcert)

if [ -z $MKCERT_INSTALLED ]; then
    brew install mkcert
fi

mkcert -install
mkcert localhost
```

실행 후 프로젝트 루트에 `localhost-key.pem`, `localhost.pem`이 생성된다. 팀원마다 반복되는 수동 명령을 줄였다.

프로덕션 모드에서는 "AWS ALB will handle SSL termination"을, 개발 모드에서는 HTTPS 실행 여부를 로그로 남겼다. 배포 중에 "왜 HTTPS가 안 떠?"라는 질문이 오면 로그 한 줄로 답이 됐다. HTTPS 서버가 실패하더라도 앱이 죽으면 안 되니 try/catch로 감쌌다. 인증서가 깨져도 HTTP 개발 서버는 계속 뜨도록 했다. mkcert 문서를 다시 읽고 GPT에게 적용 순서를 확인하는 습관이 생겼다. 덕분에 새 노트북에서도 시행착오가 줄었다.

프론트 팀은 로컬에서 HTTPS API를 안정적으로 써볼 수 있게 됐고, 운영에서는 ALB 설정만으로 SSL을 관리할 수 있었다. `npm run dev` 하나로 HTTP/HTTPS 두 환경이 동시에 살아나니 DX가 확실히 좋아졌다. 다음에는 HTTP/2 지원과 자동 인증서 갱신(예: `mkcert -install` 체크)을 자동화하고 싶다.

# Reference
- https://github.com/FiloSottile/mkcert
- https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html

# 연결문서
- [[EC2 초기 세팅 자동화 스크립트]]
- [[HeadVer 버저닝 시스템을 JS 프로덕트에 적용하기]]
- [[스탬프 적립과 자동 리워드 생성 구현]]
