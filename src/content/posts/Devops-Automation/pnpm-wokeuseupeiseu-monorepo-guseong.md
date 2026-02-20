---
tags:
  - pnpm
  - Monorepo
  - Docker
  - CI/CD
  - Prisma
  - NextJS
title: pnpm 워크스페이스 모노레포 구성
created: '2024-10-25'
modified: '2024-10-28'
---

한동안 프론트, 백엔드, 테스트 프로젝트가 제각각인 상태에서 새 기능을 동시에 출시해야 했다. npm과 yarn이 섞인 채로 서로 다른 버전의 Node를 요구하다 보니 새 작업보다 의존성 정리가 더 힘들었다. "같은 팀이니까 코드도 한 팀이 되자"는 마음으로 pnpm 기반 모노레포를 도입했다.

## 워크스페이스 설계

루트에 `pnpm-workspace.yaml`을 두고 서비스를 `packages/*`로 모았다. dlx로만 호출해도 기존 잠금파일을 건드리지 않아 안정적이었고, 하드링크 기반 저장소 덕분에 수백 MB씩 나가던 설치 시간을 크게 줄였다. `packages/backend`, `packages/frontend`, `packages/integration-test` 세 축으로 나누고, 공용 유틸은 추후 `packages/shared`로 확장 가능하도록 비워뒀다.

```yaml
# iloveclub-core/pnpm-workspace.yaml
packages:
  - "packages/*"
```

이 한 줄로 설치 시간이 40% 가까이 줄었고, `node_modules` 중복이 사라졌다. Prisma 스키마 같은 빌드 산출물이 패키지마다 필요해서 postinstall 훅 대신 패키지별 `prebuild` 스크립트에 `prisma generate`를 넣어 의존성을 명시했다.

루트 `package.json`에서 각 패키지의 대표 스크립트를 `pnpm --filter`로 래핑했다.

```jsonc
// iloveclub-core/package.json
{
  "workspaces": { "packages": ["packages/*"] },
  "scripts": {
    "backend:build": "pnpm --filter @iloveclub-core/backend build",
    "backend:dev": "pnpm --filter @iloveclub-core/backend dev",
    "frontend:dev": "pnpm --filter @iloveclub-core/frontend dev",
    "backend:prisma:generate": "pnpm --filter @iloveclub-core/backend prisma:generate",
    "lint": "pnpm -r run lint",
    "build": "pnpm -r run build"
  }
}
```

## 캐싱 전략

처음에는 Docker 빌드가 15분 이상 걸렸다. `iloveclub-core/Dockerfile`에 `--mount=type=cache,id=pnpm,target=/pnpm/store` 옵션을 붙여 pnpm 스토어를 레이어로 고정하니 5분 미만으로 떨어졌다.

```dockerfile
# iloveclub-core/Dockerfile
FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
RUN npm install -g corepack@latest && corepack enable
RUN corepack prepare pnpm@9.15.5 --activate
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
``` GitHub Actions에도 같은 전략을 적용했는데, 캐시 키를 `hashFiles('**/pnpm-lock.yaml')`로 잡으니 락 파일을 수정한 패키지만 정확히 무효화됐다.

## 팀 온보딩

패키지마다 Node 버전이 미묘하게 달라서 새 팀원이 로컬 환경을 띄우는데 반나절이 걸리곤 했다. `package.json`의 `engines` 필드와 루트 `.nvmrc`를 pnpm과 맞춰두고, README 최상단에 `corepack enable && pnpm install`만 실행하면 된다고 명시했다. 이후에는 환경 설정 질문이 먼저 사라졌다.

## 겪은 이슈

- Prisma 경로: 워크스페이스 경로를 상대 경로로 인식하지 못해 `schema.prisma`의 `datasource` 경로를 절대 경로로 바꿔야 했다. GPT에게 `prisma generate` 실패 로그를 던져 해결 방식을 검증받았다.
- Husky 중복 실행: `pnpm install` 직후 Git hook이 중복 실행되던 문제는 Husky를 루트에서만 설치하고 패키지별 `prepare` 훅을 제거하는 것으로 정리했다.

모노레포 이전에는 릴리스 브랜치가 서비스마다 따로 움직이며 "백엔드가 사용자 API를 배포했나요?" 같은 확인이 필수였다. 지금은 한 PR에서 GraphQL 스키마와 Next.js UI를 함께 검증하고, `pnpm test && pnpm build`만 통과하면 릴리스 파이프라인이 알아서 Docker 이미지를 만들고 배포한다. 새 기능 실험을 위해 패키지를 추가할 때 "이번엔 저장소를 또 만들어야 하나"라는 고민이 사라졌다. 다음에는 Turborepo 같은 태스크 러너와 비교해 빌드 그래프를 더 최적화해볼 생각이다.

# Reference
- https://pnpm.io/workspaces
- https://docs.github.com/actions/using-workflows/caching-dependencies-to-speed-up-workflows
- https://docs.docker.com/build/cache/

# 연결문서
- [GitHub Actions와 Docker, Elastic Beanstalk로 통합 배포 자동화하기](/post/github-actionswa-docker-elastic-beanstalkro-tonghap-baepo-jadonghwahagi)
- [NestJS GraphQL Subscription으로 실시간 예약 구현](/post/nestjs-graphql-subscriptioneuro-silsigan-yeyak-guhyeon)
- [CLOVA OCR API와 PDF 페이지 분할로 학력 증빙 자동화](/post/clova-ocr-apiwa-pdf-peiji-bunhallo-hangnyeok-jeungbing-jadonghwa)
