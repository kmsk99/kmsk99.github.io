---
tags:
  - NextJS
  - Docker
  - HotReload
  - DevEnv
created: 2022-04-28 10:10
modified: 2022-04-28 10:27
title: NextJs와 도커 사용시 핫리로드 불가 문제
---

NextJS와 도커를 함께 사용 중에 코드를 수정해도 변경사항이 컨테이너에 반영되지 않았다. 기본적으로 docker-compose.yml에서 volume을 WORKDIR과 맞춰주면 실시간으로 반영되지만, NextJS는 뭔가 달랐다. CHOKIDAR_USEPOLLING=true를 사용하면 즉각 반영된다는 글도 있었는데, 적용해도 아무 반응이 없었다.

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
인터넷을 살펴보니 next.config.js를 수정하라고 한다. 만약 이 파일이 없다면 직접 생성하면 된다. 내부 파일이 비어있다면 다음과 같이 수정하면 해결된다.

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

이후 docker compose down으로 도커를 끄고 docker compose up으로 다시 실행시켜준다면 즉각적으로 반영되는 NextJS를 볼 수 있다.

# Reference
- https://jameschambers.co.uk/nextjs-hot-reload-docker-development
- https://www.codemochi.com/blog/2019-08-27-nextjs-hmr
- https://nextjs.org/docs/api-reference/next.config.js/custom-webpack-config

# 연결문서
- [[CLOVA OCR API와 PDF 페이지 분할로 학력 증빙 자동화]]
- [[비동기 체인 플래그로 긴 API 호출 처리하기]]
- [[AWS Elastic Beanstalk에서 AWS ECS로 docker 백엔드 마이그레이션하기]]
