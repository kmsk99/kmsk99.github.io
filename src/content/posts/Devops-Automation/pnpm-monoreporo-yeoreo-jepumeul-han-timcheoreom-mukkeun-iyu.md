---
tags:
  - pnpm
  - Monorepo
  - Docker
  - CI/CD
  - Prisma
  - NextJS
title: pnpm 모노레포로 여러 제품을 한 팀처럼 묶은 이유
created: '2024-02-14 10:00'
modified: '2024-02-14 10:00'
---

# Intro
저는 한동안 프론트, 백엔드, 테스트 프로젝트가 제각각인 상태에서 새 기능을 동시에 출시해야 했습니다. npm과 yarn이 섞인 채로 서로 다른 버전의 Node를 요구하다 보니 새 작업보다 의존성 정리가 더 힘들었죠. 그래서 "같은 팀이니까 코드도 한 팀이 되자"라는 마음으로 pnpm 기반 모노레포를 도입했습니다.

## 핵심 아이디어 요약
- 루트에 `pnpm-workspace.yaml`을 두고 서비스별 패키지를 `packages/*`로 모았습니다.
- `pnpm --filter`를 적극적으로 활용해 필요한 패키지만 빠르게 빌드하거나 테스트했습니다.
- 캐시 친화적인 멀티 스테이지 Dockerfile과 CI 파이프라인을 함께 정비해 배포 속도를 유지했습니다.

## 준비와 선택
1. **왜 pnpm이었나**  
   dlx로만 호출해도 기존 잠금파일을 건드리지 않아 안정적이었고, 하드링크 기반 저장소 덕분에 수백 MB씩 나가던 설치 시간을 크게 줄였습니다.
2. **워크스페이스 설계**  
   `packages/backend`, `packages/frontend`, `packages/integration-test` 세 축으로 나누고 공용 유틸은 추후 `packages/shared`로 확장 가능하도록 비워뒀습니다.
3. **스크립트 재정비**  
   루트 `package.json`에서 각 패키지의 대표 스크립트를 `pnpm --filter`로 래핑했습니다. 예를 들어 `pnpm backend:build`는 다음과 같이 정의했습니다.

```jsonc
// package.json
{
  "scripts": {
    "backend:build": "pnpm --filter @iloveclub-core/backend build",
    "frontend:dev": "pnpm --filter @iloveclub-core/frontend dev"
  }
}
```

## 구현 여정
### Step 1: 워크스페이스 선언
루트의 `pnpm-workspace.yaml`은 놀랍도록 단순했습니다.

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/*"
```

이 한 줄로 설치 시간이 40% 가까이 줄었고, `node_modules`의 중복이 사라졌습니다. 대신 Prisma 스키마 같은 빌드 산출물이 패키지마다 필요했기 때문에 postinstall 훅 대신 패키지별 `prebuild` 스크립트에 `prisma generate`를 넣어 의존성을 명시했습니다.

### Step 2: 캐싱 전략 손보기
처음에는 Docker 빌드가 늘 15분 이상 걸렸습니다. `iloveclub-core/Dockerfile`에 `--mount=type=cache,id=pnpm,target=/pnpm/store` 옵션을 붙여 pnpm 스토어를 레이어로 고정하니 5분 미만으로 떨어졌습니다. 같은 전략을 GitHub Actions에도 적용했는데, 캐시 키를 `hashFiles('**/pnpm-lock.yaml')`로 잡으니 락 파일을 수정한 패키지만 정확히 무효화되었습니다.

### Step 3: 팀 온보딩 자동화
패키지마다 Node 버전이 미묘하게 달랐던 탓에 새 팀원이 로컬 환경을 띄우는데 반나절이 걸리곤 했습니다. `package.json`의 `engines` 필드와 루트 `.nvmrc`를 pnpm과 맞춰두고, README 최상단에 `corepack enable && pnpm install`만 실행하면 된다고 명시했습니다. 이후에는 깃헙 이슈보다 환경 설정 질문이 먼저 사라졌습니다.

### 예상치 못한 이슈
- Prisma가 워크스페이스 경로를 상대 경로로 인식하지 못해 `schema.prisma`의 `datasource` 경로를 절대 경로로 바꿔야 했습니다. 이때 GPT에게 `prisma generate`가 실패하는 로그를 던져 해결 방식을 검증받았습니다.
- `pnpm install` 직후 Git hook이 중복 실행되던 문제는 Husky를 루트에서만 설치하고 패키지별 `prepare` 훅을 제거하는 것으로 정리했습니다.

## 결과와 회고
모노레포 이전에는 릴리스 브랜치가 서비스마다 따로 움직이며 "백엔드가 사용자 API를 배포했나요?" 같은 확인이 필수였습니다. 지금은 한 PR에서 GraphQL 스키마와 Next.js UI를 함께 검증하고, `pnpm test && pnpm build`만 통과하면 릴리스 파이프라인이 알아서 Docker 이미지를 만들고 배포합니다. 무엇보다 새 기능 실험을 위해 패키지를 추가할 때 "이번엔 저장소를 또 만들어야 하나"라는 고민이 사라졌습니다.

다음 스텝으로는 Turborepo 같은 태스크 러너와 비교해 빌드 그래프를 더 최적화해볼 생각입니다. 여러분은 모노레포 전환에서 어떤 문제가 가장 힘들었나요? 댓글로 다른 팀 이야기도 듣고 싶습니다.

# Reference
- https://pnpm.io/workspaces
- https://docs.github.com/actions/using-workflows/caching-dependencies-to-speed-up-workflows
- https://docs.docker.com/build/cache/

# 연결문서
- [GitHub Actions와 Docker, Elastic Beanstalk로 통합 배포 자동화하기](/post/github-actionswa-docker-elastic-beanstalkro-tonghap-baepo-jadonghwahagi)
- [NestJS GraphQL 예약 도메인에서 실시간성을 확보한 과정](/post/nestjs-graphql-yeyak-domeineseo-silsiganseongeul-hwakbohan-gwajeong)
- [CLOVA OCR API와 PDF 페이지 분할로 학력 증빙 자동화](/post/clova-ocr-apiwa-pdf-peiji-bunhallo-hangnyeok-jeungbing-jadonghwa)
