---
tags:
  - GitHubActions
  - Docker
  - ElasticBeanstalk
  - AWS
  - CI/CD
  - Monorepo
title: GitHub Actions와 Docker, Elastic Beanstalk로 통합 배포 자동화하기
created: 2023-05-21
modified: 2023-08-22
---

이전까지 백엔드는 EC2에 직접 배포하고, 프론트는 수동으로 S3에 올리는 방식이었다. 릴리스마다 SSH로 접속해 컨테이너를 재시작해야 했고, 실패하면 원복하기도 힘들었다. GitHub Actions와 Docker, Elastic Beanstalk를 묶어 자동 배포 파이프라인을 구축했다.

## Dockerfile과 이미지 경량화

모노레포에서 필요한 패키지만 설치·빌드하는 멀티 스테이지 Dockerfile로 이미지를 경량화했다. Node 20 slim 기반에 corepack으로 pnpm을 활성화했다. 빌드 스테이지에서만 전체 워크스페이스를 복사하고, 최종 이미지는 dist와 `node_modules`만 유지했다.

```dockerfile
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

## GitHub Actions 워크플로

`release.yml`은 master 브랜치에 변경이 들어오면 자동으로 빌드·배포한다. pnpm 캐시를 공유하고, ECR로 이미지를 푸시한 뒤 Beanstalk에 버전을 올렸다. `Dockerrun.aws.json`을 zip에 포함해 Elastic Beanstalk가 ECR 이미지를 끌어오도록 했다. AWS 자격 증명은 GitHub Secrets로 관리하고, Role 단위 접근 권한을 최소화했다.

```yaml
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
          version_label: docker-${{steps.current-time.outputs.formattedTime}}
```

프로젝트는 Elastic Beanstalk에서 ECS로 마이그레이션한 뒤 `release.yml`이 ECR → ECS 배포를 담당한다. `aws-actions/amazon-ecs-deploy-task-definition`에 `wait-for-service-stability: true`를 두어 헬스체크가 안정될 때까지 기다리게 했다.

```yaml
on:
  push:
    branches: [master]
    paths: ['packages/backend/**', 'packages/backend/prisma/**', 'Dockerfile', '.github/workflows/release.yml']

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_TO_ASSUME }}
          aws-region: ${{ secrets.AWS_REGION }}
      - uses: aws-actions/amazon-ecr-login@v2
      - run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG -t $ECR_REGISTRY/$ECR_REPOSITORY:latest .
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest
      - uses: aws-actions/amazon-ecs-render-task-definition@v1
        with:
          task-definition: task-definition.json
          container-name: ${{ env.ECS_CONTAINER_NAME }}
          image: ${{ steps.build-image.outputs.image }}
      - uses: aws-actions/amazon-ecs-deploy-task-definition@v2
        with:
          task-definition: ${{ steps.task-def.outputs.task-definition }}
          service: ${{ env.ECS_SERVICE }}
          cluster: ${{ env.ECS_CLUSTER }}
          wait-for-service-stability: true
```

배포 결과는 GitHub Checks로 확인하고, 실패 시 이전 태스크 정의로 롤백할 수 있다.

## 겪은 이슈

- Beanstalk 버전 라벨 한도: 1000개를 넘으면 더 이상 업로드가 안 됐다. `docker-YYYYMMDD_HH-mm-ss` 패턴을 쓰면서 주기적으로 오래된 버전을 지우는 Lambda를 붙여 해결했다.
- Prisma 바이너리 호환성: Docker 빌드 중 Prisma Client가 ARM 환경에서 native 바이너리를 요구해 실패했다. `apt-get install -y openssl`을 base 이미지에 추가하고, `pnpm prisma:generate`를 최종 스테이지가 아닌 build 스테이지에서 실행하도록 옮겼다. GPT에게 prisma 바이너리 호환성 정보를 확인하며 설정을 검증했다.

지금은 master에 머지되면 평균 7분 내에 새 버전이 Elastic Beanstalk에 올라가고, 실패하면 자동으로 이전 이미지로 롤백된다. 운영팀은 배포 로그를 추적하는 대신 릴리스 노트 작성에 더 집중할 수 있게 됐다. 다음으로는 blue/green 배포나 Canary 전략을 도입해볼 생각이다.

# Reference
- https://docs.github.com/en/actions
- https://docs.aws.amazon.com/elasticbeanstalk/
- https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/single-container-docker.html
- https://pnpm.io/filtering

# 연결문서
- [[pnpm 워크스페이스 모노레포 구성]]
- [[NestJS GraphQL Subscription으로 실시간 예약 구현]]
