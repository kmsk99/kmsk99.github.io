---
tags:
  - Engineering
  - IssueNote
  - Prisma
  - Backend
title: Prisma 개발 시 migration 기록 지우기
created: '2023-10-06 03:53'
modified: '2023-10-06 03:57'
slug: prisma-개발-시-migration-기록-지우기
---

# Intro

- orm 으로 prisma 를 함께 쓰다보면 개발 과정에서 스키마를 자주 바꾸어 마이그레이션 폴더가 많아지는 경험이 있을 것이다. 프로덕션 단계 전이라면 마이그레이션 히스토리를 굳이 보존할 필요는 없다.

# 해결방법

- 프리즈마 폴더 내의 migrations 폴더를 삭제 후, 다음 명령어를 실행한다.
```bash
mkdir -p prisma/migrations/0_init
```
- 이어서 실행한다.
```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql
```
- 이를 통해 깨끗한 sql 이 작성되었다.
- 데이터베이스에 적용하려면 아래 명령을 실행한다. 이는 환경에 따라 다르다.
```bash
npx prisma migrate resolve --applied 0_init
```

# Reference

- https://www.prisma.io/docs/getting-started/setup-prisma/add-to-existing-project/relational-databases/baseline-your-database-typescript-postgresql

# 연결문서
- [[Nestjs + Prisma에서 원자성을 지키는 방법]]
- [[AES-256과 Prisma Middleware로 개인정보 안전하게 돌리기]]
- [[역할 기반 승인 흐름 설계기 다단계 검증을 코드로 담다]]
