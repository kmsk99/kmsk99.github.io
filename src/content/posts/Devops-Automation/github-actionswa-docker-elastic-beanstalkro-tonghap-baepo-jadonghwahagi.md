---
tags:
  - GitHubActions
  - Docker
  - ElasticBeanstalk
  - AWS
  - CI/CD
  - Monorepo
title: 'GitHub Actions와 Docker, Elastic Beanstalk로 통합 배포 자동화하기'
created: '2025-02-14 10:20'
modified: '2025-02-14 10:20'
---

# Intro
저는 이전까지 백엔드를 EC2에 직접 배포하고, 프론트는 수동으로 S3에 올리는 방식으로 운영했습니다. 릴리스마다 사람이 SSH에 접속해 컨테이너를 재시작해야 했고, 실패하면 원복하기도 힘들었죠. 그래서 GitHub Actions와 Docker, Elastic Beanstalk를 묶어 자동 배포 파이프라인을 구축했습니다.

## 핵심 아이디어 요약
- 모노레포에서 필요한 패키지만 설치·빌드하는 멀티 스테이지 Dockerfile로 이미지를 경량화했습니다.
- GitHub Actions에서 pnpm 캐시를 공유하고, ECR로 이미지를 푸시한 뒤 Beanstalk에 버전을 올렸습니다.
- 배포 아티팩트를 Dockerrun ZIP으로 묶어 Beanstalk에 업로드해 롤백이 쉬운 구조를 만들었습니다.

## 준비와 선택
1. **Docker 이미지 경량화**  
   Node 20 slim 기반에 corepack으로 pnpm을 활성화했습니다.
2. **CI 파이프라인**  
   `release.yml`은 master 브랜치에 변경이 들어오면 자동으로 빌드·배포하도록 구성했습니다.
3. **권한 관리**  
   AWS 자격 증명은 GitHub Secrets로 관리하고, Role 단위 접근 권한을 최소화했습니다.

## 구현 여정
### Step 1: Dockerfile 정리

```dockerfile
# iloveclub-core/Dockerfile
FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
RUN npm install -g corepack@latest && corepack enable
RUN corepack prepare pnpm@9.15.5 --activate
WORKDIR /app
RUN apt-get update && apt-get install -y openssl

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm --filter @iloveclub-core/backend install --frozen-lockfile
RUN pnpm backend:build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm deploy --filter @iloveclub-core/backend --prod /prod/backend
WORKDIR /prod/backend
RUN pnpm prisma:generate

FROM base AS backend
COPY --from=build /prod/backend/dist ./dist
COPY --from=build /prod/backend/node_modules ./node_modules
COPY --from=build /prod/backend/package.json ./
EXPOSE 3000
CMD [ "pnpm", "start:prod" ]
```

빌드 스테이지에서만 전체 워크스페이스를 복사하고, 최종 이미지는 dist와 `node_modules`만 유지하도록 했습니다.

### Step 2: GitHub Actions 워크플로

```yaml
# .github/workflows/release.yml
on:
  push:
    branches: [master]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/cache@v3
        with:
          path: ${{ env.STORE_PATH }}
          key: ${{ runner.os }}-pnpm-store-${{ hashFiles('**/pnpm-lock.yaml') }}
      - run: pnpm install
      - run: pnpm backend:build
      - uses: aws-actions/configure-aws-credentials@v1
      - uses: aws-actions/amazon-ecr-login@v1
      - run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:latest .
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest
      - run: |
          mkdir -p deploy
          cp -r .ebextensions deploy/.ebextensions
          cp Dockerrun.aws.json deploy/Dockerrun.aws.json
          cd deploy && zip -r deploy.zip .
      - uses: einaregilsson/beanstalk-deploy@v14
        with:
          application_name: ${{ secrets.AWS_APPLICATION_NAME }}
          environment_name: ${{ secrets.AWS_ENVIRONMENT_NAME }}
          version_label: iloveclub-docker-${{steps.current-time.outputs.formattedTime}}
```

포인트는 `Dockerrun.aws.json`을 zip에 포함해 Elastic Beanstalk가 ECR 이미지를 끌어오도록 하는 부분입니다.

### Step 3: 배포 모니터링
`einaregilsson/beanstalk-deploy` 액션에서 `wait_for_environment_recovery: 360`을 설정해 헬스체크가 안정될 때까지 기다리게 했습니다. 배포 결과는 GitHub Checks와 Slack 웹훅으로 동시에 받아, 실패 시 바로 롤백 명령을 내릴 수 있게 했습니다.

### 예상치 못한 이슈
- Beanstalk 버전 라벨이 1000개를 넘으면 더 이상 업로드가 되지 않았습니다. `iloveclub-docker-YYYYMMDD_HH-mm-ss` 패턴을 쓰면서 주기적으로 오래된 버전을 지우는 Lambda를 붙여 해결했습니다.
- Docker 빌드 중 Prisma Client가 ARM 환경에서 native 바이너리를 요구해 실패했습니다. `apt-get install -y openssl`을 base 이미지에 추가하고, `pnpm prisma:generate`를 최종 스테이지가 아닌 build 스테이지에서 실행하도록 옮겼습니다. 이 과정에서 GPT에게 prisma 바이너리 호환성 정보를 확인하며 설정을 검증했습니다.

## 결과와 회고
지금은 master에 머지되면 평균 7분 내에 새로운 버전이 Elastic Beanstalk에 올라가고, 실패하면 자동으로 이전 이미지로 롤백됩니다. 운영팀은 배포 로그를 추적하는 대신 릴리스 노트 작성에 더 집중할 수 있게 됐습니다. 다음으로는 blue/green 배포나 Canary 전략을 도입해볼 생각입니다. 여러분 팀은 어떤 방식으로 AWS 배포 자동화를 구성하고 계신가요?

# Reference
- https://docs.github.com/actions
- https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/single-container-docker.html
- https://pnpm.io/filtering

# 연결문서
- [pnpm 모노레포로 여러 제품을 한 팀처럼 묶은 이유](/post/pnpm-monoreporo-yeoreo-jepumeul-han-timcheoreom-mukkeun-iyu)
- [NestJS GraphQL 예약 도메인에서 실시간성을 확보한 과정](/post/nestjs-graphql-yeyak-domeineseo-silsiganseongeul-hwakbohan-gwajeong)
- [Elastic Beanstalk 메모리 스왑하기](/post/elastic-beanstalk-memori-seuwapagi)
