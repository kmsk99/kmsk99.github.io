---
created: '2022-04-28 10:10'
modified: '2022-04-28 10:27'
tags:
  - Engineering
  - IssueNote
  - NextJS
  - Docker
  - Performance
  - DevOps
  - Frontend
title: NextJs와 도커 사용시 핫리로드 불가 문제
slug: nextjswa-dokeo-sayongsi-hatrirodeu-bulga-munje
---

# Intro

NextJS와 도커를 함께 사용 중에 코드를 수정해도 변경사항이 컨테이너에 반영이 안되었다. 기본적으로 docker-compose.yml 파일에서 volume을 WORKDIR과 맞춰준다면 실시간으로 반영이 되나, NextJS는 뭔가가 달랐다.

인터넷을 살펴보니 CHOKIDAR_USEPOLLING=true를 사용하면 즉각적으로 수정이된다고 하는데 나에게는 아무런 반응이 없었다

```
version: '3.9'

  

services:

  app:

    build: .

    ports:

      - '3000:3000'

    volumes:

      - ./:/usr/src/app # Dockerfile의 WORKDIR와 맞추기

      - /usr/src/app/node_modules # 핫 리로드 성능 개선

    environment:

      - CHOKIDAR_USEPOLLING=true

  

    stdin_open: true
```

# 도커의 문제가 아니었다
아무리 살펴보아도 방법이 없자, 컨테이너 내부까지 확인하였다. 그리고 파일 수정시 즉각적으로 반영되는 컨테이너 내부 파일이 보였다. 이때 깨달았다. 아, 이건 도커문제가 아니라 NextJS문제였구나.
바로 구글링을 통해 방법을 찾아냈다.

# 원인은 next.config.js
인터넷을 살펴보니 next.config.js를 수정하라고 한다. 만약 이 파일이 없다면 직접 생성하도록 하자. 만일 내부 파일이 비어있다면 다음과 같이 수정함으로서 해결 가능하다.

```js
module.exports = {
  webpackDevMiddleware: config => {
    config.watchOptions = {
      poll: 1000,
      aggregateTimeout: 300,
    }
    return config
  },
}
```

그러나 나는 next.config.js의 내용물이 아래와 같이 차있는 상태였다.

```js
/** @type {import('next').NextConfig} */

const nextConfig = {
  reactStrictMode: true,
}

module.exports = nextConfig
```

내부 파일이 차있을때는 json 형식으로 묶어주자

```js
module.exports = {
  nextConfig: {
    reactStrictMode: true,
  },
  webpackDevMiddleware: config => {
    config.watchOptions = {
      poll: 1000,
      aggregateTimeout: 300,
    }
    return config
  },
}
```

이후 docker compose down으로 도커를 끄고 docker compose up으로 다시 실행시켜준다면 즉각적으로 반영되는 NextJS를 보실수 있을 것이다.

# Reference
- https://jameschambers.co.uk/nextjs-hot-reload-docker-development
- https://www.codemochi.com/blog/2019-08-27-nextjs-hmr

# 연결문서
- [[CLOVA OCR API와 PDF 페이지 분할로 학력 증빙 자동화]]
- [[Chain Flag로 긴 호출 시간을 견디는 법]]
- [[Docker 사용시 Error connect ECONNREFUSED 오류]]
