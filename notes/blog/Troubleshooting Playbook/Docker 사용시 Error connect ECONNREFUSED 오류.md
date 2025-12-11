---
tags:
  - Docker
  - Node
  - Networking
  - Troubleshooting
created: 2022-05-03 11:11
modified: 2022-05-03 11:15
title: Docker 사용시 Error connect ECONNREFUSED 오류
---

# Intro

```http
Error: connect ECONNREFUSED 127.0.01:5432
```

Docker로 데이터베이스와 백엔드를 동시에 사용할 때 위와 같은 오류가 지속적으로 발생하였다. 해결 방법은 간단했다.

`127.0.0.1`은 자신에게 연결하는 것이므로 컨테이너 내부에서 자신에게 연결하려 한다. 이를 수정하려면 `127.0.0.1`대신에 데이터베이스 콘테이너의 이름을 넣어주면 해결된다.

Change:

`127.0.0.1` to `CONTAINER_NAME` (e.g. `db`)

Example:

```perl
DATABASE_URL: postgres://username:pgpassword@127.0.0.1:5432/mydatabase
```

to

```perl
DATABASE_URL: postgres://username:pgpassword@db:5432/mydatabase
```

# Reference
- https://stackoverflow.com/questions/33357567/econnrefused-for-postgres-on-nodejs-with-dockers

# 연결문서
- [[NextJs와 도커 사용시 핫리로드 불가 문제]]
- [[Elastic Beanstalk Enviroment 끄기]]
- [[Elastic Beanstalk 메모리 스왑하기]]
