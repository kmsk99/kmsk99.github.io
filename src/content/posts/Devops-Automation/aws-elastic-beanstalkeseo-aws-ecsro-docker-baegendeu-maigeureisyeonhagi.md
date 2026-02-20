---
tags:
  - AWS
  - ECS
  - Docker
  - Fargate
  - ElasticBeanstalk
  - Migration
  - DevOps
  - CI/CD
created: '2026-02-11 02:34'
modified: '2026-02-12 03:58'
title: AWS Elastic Beanstalk에서 AWS ECS로 docker 백엔드 마이그레이션하기
---

기존에 NestJS 와 Docker 를 이용해서 AWS Elastic Beanstalk 에 Docker 플랫폼을 통해 서버를 배포하여 운영해왔었다. 하지만 이 Elastic Beanstalk 는 EC2 인스턴스 위에 Docker 컨테이너를 띄우는 방식이라 컨테이너 환경에 완전히 최적화되어 있지 않았고, 무엇보다 EC2 인스턴스를 계속 점유하다 보니 비용 효율도 좋지 못했다. 또한, `.ebextensions` 같은 독자적인 설정 파일에 의존해야 해서 세부적인 인프라 컨트롤이 까다로웠다.

사실, 이 서버를 처음 배포할 당시에는 클라우드 인프라에 대한 지식이 부족했고, 그 부족한 상태에서 선택할 수 있는 가장 쉽고 빠른 최선의 선택이 EB 였다. 하지만 이제는 서비스가 성장하고 인프라 지식도 쌓인 만큼, 이 레거시를 청산하고 AWS ECS Fargate 로 마이그레이션을 진행해보기로 했다.

이 글은 그 삽질과 배움의 기록이다.

---

### 1. 왜 굳이 ECS Fargate 인가?

기존 EB 환경도 돌아가긴 했다. 하지만 비용 효율성과 관리 편의성 두 마리 토끼를 다 놓치고 있었다.

Elastic Beanstalk 는 편하긴 하지만, 그 아래 깔린 EC2 를 직접 관리해야 하는 부담이 여전히 존재했다. OS 패치, 인스턴스 스케일링, 메모리 스왑 설정 같은 것들을 `.ebextensions` 로 일일이 잡아줘야 했다. 반면 ECS Fargate 는 서버리스 컨테이너 서비스다.

- 서버 관리 불필요: OS 패치나 인스턴스 관리를 AWS 에 위임할 수 있다.
- 비용 최적화: 실행된 컨테이너의 CPU/Memory 리소스만큼만 비용을 지불한다. EB 는 트래픽이 없어도 EC2 가 돌아가고 있으니 돈이 나갔다.
- Docker 친화적: Task Definition 을 통해 컨테이너 설정을 아주 세밀하게 제어할 수 있다.
- DevOps 유연성: Task Definition 이 버전 관리되므로, 문제가 생기면 이전 revision 으로 즉시 롤백이 가능하다.

### 2. 마이그레이션 아키텍처 설계

가장 먼저 한 일은 기존 아키텍처를 분석하고 ECS 에 맞는 새 그림을 그리는 것이었다.

- Front: Vercel (기존 유지)
- Back: Elastic Beanstalk → ECS Fargate
- CI/CD: GitHub Actions
- Registry: ECR (기존 EB 에서도 ECR 을 쓰고 있었으므로 리포지토리를 그대로 공유)
- Secrets: AWS Secrets Manager

전체적인 흐름은 이렇다. GitHub Actions 에서 Docker 이미지를 빌드하고 ECR 에 푸시한 뒤, ECS Service 를 업데이트하여 새 이미지로 컨테이너를 교체하는 방식이다.

특히 보안을 위해 기존에 사용하던 Long-term Access Key 를 제거하고, GitHub Actions 에서 OIDC(OpenID Connect) 를 통해 AWS 권한을 임시로 획득하도록 파이프라인을 전면 수정했다. 이제 내 로컬이나 깃허브 시크릿에 민감한 AWS 키를 저장할 필요가 없어졌다.

### 3. ECS 인프라 구축: 하나씩 쌓아 올리기

Terraform 같은 IaC 없이 콘솔과 CLI 로 하나씩 잡아갔다. 돌이켜보면 이 과정 자체가 ECS 의 구조를 깊이 이해하는 데 큰 도움이 됐다.

#### 3.1 IAM Role 세 종류 만들기

ECS 를 돌리려면 IAM Role 이 최소 세 개는 필요하다. 처음엔 이게 왜 이렇게 많이 필요한지 이해가 안 됐는데, 하나씩 만들다 보니 각각의 역할이 명확하게 구분됐다.

Task Execution Role — ECS 가 컨테이너를 기동할 때 필요한 역할이다. ECR 에서 이미지를 풀(pull)하고, CloudWatch Logs 에 로그를 보내고, Secrets Manager 에서 환경변수를 가져오는 권한을 가진다.

```json
{
  "Effect": "Allow",
  "Action": ["secretsmanager:GetSecretValue"],
  "Resource": "arn:aws:secretsmanager:ap-northeast-2:<ACCOUNT_ID>:secret:*"
}
```

Task Role — 애플리케이션 자체가 AWS API 를 호출할 때 필요한 역할이다. 우리 백엔드는 S3 에 파일을 업로드하므로, 해당 버킷에 대한 최소 권한을 부여했다.

GitHub Actions OIDC Role — CI/CD 파이프라인이 AWS 에 접근할 때 사용하는 역할이다. Trust Policy 에서 GitHub 레포와 브랜치를 명시적으로 제한하여, `master` 브랜치에서만 배포가 가능하도록 설정했다.

```json
{
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:<ORG>/<REPO>:ref:refs/heads/master"
    }
  }
}
```

#### 3.2 네트워크와 보안 그룹

보안 그룹은 세 개를 만들어 체이닝했다.

- ALB Security Group: 외부에서 80/443 포트로 들어오는 트래픽 허용
- ECS Task Security Group: ALB 에서 3000 포트로 들어오는 트래픽만 허용, RDS 쪽 5432 아웃바운드 허용
- RDS Security Group: ECS Task SG 에서 5432 포트 인바운드 허용 (기존 EB SG 도 유지)

여기서 한 가지 중요한 포인트가 있었다. Default VPC 에 NAT Gateway 없이 구성했기 때문에, Fargate Task 에 Public IP 를 반드시 활성화해야 했다. 이걸 안 하면 ECR 에서 이미지를 pull 하지 못해 Task 가 무한 PENDING 상태에 빠진다.

#### 3.3 ALB + Target Group 생성

Target Group 을 만들 때 Fargate 의 경우 `target-type` 을 반드시 `ip` 로 설정해야 한다. EB 때처럼 `instance` 로 하면 안 된다.

```bash
aws elbv2 create-target-group \
  --name project-ecs-tg \
  --protocol HTTP \
  --port 3000 \
  --vpc-id <VPC_ID> \
  --target-type ip \
  --health-check-path / \
  --health-check-interval-seconds 10 \
  --healthy-threshold-count 2
```

헬스체크는 NestJS 앱의 루트 엔드포인트(`GET /`)가 `200 OK` 와 `Hello World!` 를 반환하도록 이미 구현되어 있었으므로 그대로 활용했다.

#### 3.4 ECS Cluster, Task Definition, Service

ECS Cluster 는 `project-prod` 라는 이름으로 하나 만들었다.

Task Definition 은 Fargate 용으로 작성했다. CPU 512(0.5 vCPU), Memory 1024(1GB), 네트워크 모드는 `awsvpc`.

```json
{
  "family": "project-backend",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "backend",
      "image": "<ACCOUNT_ID>.dkr.ecr.ap-northeast-2.amazonaws.com/project:latest",
      "portMappings": [{ "containerPort": 3000, "protocol": "tcp" }],
      "essential": true,
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "NEST_PORT", "value": "3000" }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:ap-northeast-2:<ACCOUNT_ID>:secret:project/prod/backend-XXXXXX:DATABASE_URL::"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/project-backend",
          "awslogs-region": "ap-northeast-2",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:3000/ || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
```

ECS Service 를 만들어 Task 를 올린 순간, 진짜 전쟁이 시작됐다.

### 4. 난관의 시작: 환경변수와의 전쟁

NestJS 앱이 시작되자마자 이런 에러를 뱉으며 죽어버렸다.

```
Error: Config validation error: "POSTGRES_USER" is required. "POSTGRES_PASSWORD" is required.
"DB_HOST" is required. "DATABASE_URL" is required. "JWT_ACCESS_SECRET" is required...
```

무려 24개의 환경변수가 전부 누락되어 있었다. EB 에서는 설정 메뉴에서 환경변수를 텍스트로 넣으면 알아서 주입됐지만, ECS 는 Task Definition 에 명시적으로 정의해야 했다.

우리 NestJS 백엔드는 `app.module.ts` 에서 `ignoreEnvFile: process.env.NODE_ENV === 'production'` 으로 설정되어 있어, 프로덕션에서는 `.env` 파일을 읽지 않는다. 즉, Task Definition 의 `environment` 또는 `secrets` 로 환경변수를 직접 주입해줘야 하는 것이다.

보안상 민감한 DB 접속 정보나 API 키들은 AWS Secrets Manager 에 하나의 시크릿(`project/prod/backend`)으로 모아서 저장하고, ECS 가 이를 가져다 쓰도록 설정했다.

하지만 설정을 마쳤음에도 불구하고 이번엔 이런 에러가 떴다.

```
TypeError: Cannot read properties of undefined (reading 'length')
    at new EncryptionService (/app/dist/encryption/encryption.service.js:18:17)
```

로그를 뜯어보니 `ENCRYPTION_KEY` 환경변수가 제대로 로드되지 않아 암호화 서비스가 초기화되다 죽은 것이었다. 알고 보니 Secrets Manager 에서 환경변수를 가져올 때, JSON 키 경로를 정확히 지정하지 않으면 전체 JSON 덩어리가 통째로 넘어오거나 파싱이 안 되는 문제였다.

Secrets Manager 의 ARN 뒤에 `:KEY_NAME::` 형식으로 JSON 키를 명시해줘야 했다.

```json
{
  "name": "ENCRYPTION_KEY",
  "valueFrom": "arn:aws:secretsmanager:ap-northeast-2:<ACCOUNT_ID>:secret:project/prod/backend-XXXXXX:ENCRYPTION_KEY::"
}
```

이런 식으로 24개 환경변수 하나하나에 대해 `secrets` 매핑을 작성했다. 그리고 Task Execution Role 에 `secretsmanager:GetSecretValue` 권한이 잘 들어가 있는지 수십 번 확인한 끝에야 드디어 로그에 초록빛 `Nest application successfully started` 메시지가 떴다.

### 5. 컨테이너 헬스체크의 함정

환경변수 문제를 해결하고 나니, 이번엔 다른 곳에서 뒤통수를 맞았다. CloudWatch Logs 에는 앱이 정상 부팅된 로그가 찍히고, ALB DNS 로 curl 을 날리면 `200 OK` 가 잘 돌아오는데, ECS Service Events 에는 이런 메시지가 계속 올라왔다.

```
service project-backend task d430f634... failed container health checks.
service project-backend has stopped 1 running tasks.
```

ALB Target Group 에서는 `healthy` 인데, ECS 컨테이너 레벨의 헬스체크에서 `unhealthy` 가 뜨는 것이다.

원인은 Task Definition 에 설정한 컨테이너 헬스체크였다. `curl -f http://localhost:3000/` 명령을 쓰고 있었는데, NestJS 앱이 부팅되는 데 시간이 꽤 걸리다 보니 `startPeriod`(60초) 안에 헬스체크가 통과하지 못하는 케이스가 있었다. 게다가 slim 이미지에는 `curl` 이 기본 설치되어 있지 않을 수도 있다.

결국 컨테이너 헬스체크의 `startPeriod` 를 넉넉하게 늘리고, ALB 쪽 Health Check Grace Period 도 60초로 설정하여 앱이 충분히 뜰 시간을 확보했다. 이후로 Task 가 계속 재시작되는 무한 루프에서 벗어날 수 있었다.

### 6. Dockerfile: 멀티 스테이지 빌드

Docker 이미지는 멀티 스테이지 빌드로 최적화했다. 모노레포(pnpm workspace) 구조에서 백엔드만 깔끔하게 뽑아내는 게 핵심이었다.

```dockerfile
FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g corepack@latest
RUN corepack enable
RUN corepack prepare pnpm@9.15.5 --activate
WORKDIR /app
RUN apt-get update && apt-get install -y openssl

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm --filter @project-core/backend install --frozen-lockfile
RUN pnpm backend:build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm deploy --filter @project-core/backend --prod /prod/backend
WORKDIR /prod/backend
RUN pnpm prisma:generate

FROM base AS backend
COPY --from=build /prod/backend/dist ./dist
COPY --from=build /prod/backend/node_modules ./node_modules
COPY --from=build /prod/backend/package.json ./
EXPOSE 3000
CMD [ "pnpm", "start:prod" ]
```

빌드 스테이지에서 `pnpm deploy --filter` 로 백엔드 패키지만 프로덕션 의존성과 함께 추출하고, 최종 이미지에는 빌드 결과물(`dist`)과 `node_modules` 만 복사한다. `--mount=type=cache` 로 pnpm store 를 캐싱하여 빌드 속도도 잡았다.

### 7. CI/CD 파이프라인: OIDC 기반 무인 배포

GitHub Actions 워크플로우는 `master` 브랜치에 백엔드 관련 파일이 변경되면 자동으로 트리거된다.

```yaml
name: Deploy Backend (ECR -> ECS)

on:
  push:
    branches: [master]
    paths:
      - 'packages/backend/src/'
      - 'packages/backend/prisma/'
      - 'packages/backend/package.json'
      - '.github/workflows/release.yml'
      - 'Dockerfile'

permissions:
  id-token: write
  contents: read
```

파이프라인의 핵심 흐름은 이렇다.

1. OIDC 로 AWS 인증 — 장기 Access Key 없이 임시 자격 증명을 받는다.
2. ECR 로그인 & Docker 빌드/푸시 — 이미지에 커밋 SHA 태그와 `latest` 태그를 동시에 달아 푸시한다. SHA 태그가 있으니 언제든 특정 커밋 시점으로 롤백할 수 있다.
3. 현재 Task Definition 다운로드 — AWS 에서 현재 운영 중인 Task Definition 을 동적으로 가져온다. 레포에 `task-definition.json` 을 고정으로 두지 않는 게 포인트다. 콘솔에서 환경변수나 메모리 설정을 변경해도 파이프라인이 덮어쓰는 실수를 방지할 수 있다.
4. 새 이미지로 Task Definition 렌더링 — `amazon-ecs-render-task-definition` 액션으로 이미지 URI 만 교체한다.
5. ECS Service 배포 & 안정화 대기 — `wait-for-service-stability: true` 옵션으로 새 Task 가 healthy 상태가 될 때까지 기다린다.

```yaml
- name: Download current ECS task definition
  run: |
    aws ecs describe-task-definition \
      --task-definition "$ECS_TASK_DEFINITION" \
      --query taskDefinition > task-definition.json
    jq 'del(.taskDefinitionArn, .requiresAttributes, .compatibilities, 
            .revision, .status, .registeredAt, .registeredBy)' \
      task-definition.json > task-definition-clean.json
    mv task-definition-clean.json task-definition.json
```

GitHub Secrets 에는 다음 값들을 등록했다.

| Secret Name | 설명 |
| --- | --- |
| `AWS_REGION` | `ap-northeast-2` |
| `AWS_ROLE_TO_ASSUME` | OIDC Role ARN |
| `ECR_REPOSITORY` | ECR 리포지토리 이름 |
| `ECS_CLUSTER` | ECS Cluster 이름 |
| `ECS_SERVICE` | ECS Service 이름 |
| `ECS_TASK_DEFINITION` | Task Definition Family |
| `ECS_CONTAINER_NAME` | 컨테이너 이름 |

### 8. 무중단 배포를 향하여

서비스를 중단 없이 넘기기 위해 Blue/Green 배포 전략을 흉내 냈다.

1. ECS 인프라 구축: 기존 EB 는 그대로 둔 채, 옆에 ECS 클러스터와 서비스를 새로 띄웠다.
2. 병행 운영 시작: Route53 가중치 기반 라우팅을 이용해 트래픽의 일부만 ECS 로 흘려보냈다.
3. 모니터링: CloudWatch 에서 ECS Service 의 CPU/Memory 사용률, ALB Target Group 의 Healthy Host Count, Request Count, 5xx Error 를 매의 눈으로 감시했다. 다행히 200 OK 가 뜨기 시작했다.
4. 점진적 전환: 20% → 50% → 100% 순으로 트래픽을 옮기며 각 단계마다 24시간 이상 모니터링했다.

병행 운영 기간 동안 확인한 것들:
- ECS Task 가 정상적으로 재시작되는가
- 환경변수/Secrets 가 올바르게 주입되는가
- DB 커넥션 풀이 정상 동작하는가
- S3 업로드/다운로드, 외부 API 호출(NCP, Firebase, Kakao)이 정상인가
- CloudWatch Logs 가 정상 수집되는가

### 9. EB 종료: 아찔했던 순간

트래픽을 100% ECS 로 전환하고 1주일간 안정화를 확인한 뒤, 드디어 EB 환경을 종료하기로 했다. 그런데 여기서 진짜 아찔한 일이 벌어졌다.

EB 환경을 terminate 하는 순간, EB 가 연결된 RDS 까지 같이 삭제하려고 시도한 것이다.

```
ERROR: Deleting RDS database named: awseb-e-xxx-stack-awsebrdsdatabase-xxx failed 
Reason: "Cannot delete protected DB Instance, please disable deletion protection 
and try again."
```

다행히 RDS 에 Deletion Protection 이 걸려 있어서 삭제가 실패로 끝났지만, 만약 이 보호 설정이 없었다면 운영 DB 가 날아갈 뻔했다. 진짜 등골이 서늘했다.

교훈: RDS 의 Deletion Protection 은 반드시 켜두자. 그리고 EB 환경을 종료할 때는 CloudFormation 스택이 어떤 리소스들을 함께 삭제하려 하는지 반드시 미리 확인해야 한다.

EB 종료 후에는 남은 레거시 리소스들을 정리했다.

```bash
# EB 관련 파일 정리
git mv Dockerrun.aws.json docs/archive/
git mv .ebextensions docs/archive/
git commit -m "chore: EB 관련 파일 제거 (ECS 전환 완료)"
```

### 10. 마무리하며

처음 EB 를 세팅할 때의 막막함과는 다른, 뭔가 제대로 된 시스템을 구축하고 있다는 희열이 있었다.

이제 우리 서버는 EC2 의 족쇄에서 벗어나 Fargate 위에서 유연하게 스케일링 된다. OIDC 기반의 CI/CD 파이프라인으로 보안도 한층 강화됐고, Secrets Manager 를 통해 민감한 설정 정보도 안전하게 관리하고 있다. 배포도 `master` 에 푸시하면 자동으로 이루어지니, 개발에만 집중할 수 있게 됐다.

물론 아직 갈 길은 멀다. Auto Scaling 정책도 더 다듬어야 하고, 비용을 더 줄이기 위해 Fargate Spot 도입도 고려해야 한다. 장기적으로는 현재 환경변수로 넘기고 있는 AWS Access Key 를 제거하고 Task Role 기반의 SDK credential chain 으로 전환하는 것도 숙제다.

하지만 부족한 상태에서의 최선이었던 EB 를 보내주고, 더 나은 기술적 선택인 ECS 로 넘어왔다는 사실만으로도 개발자로서 한 뼘 성장한 기분이다.

Lesson Learned:

- Secrets Manager 에서 환경변수를 주입할 때 ARN 뒤에 `:KEY_NAME::` 형식으로 JSON 키 경로를 명시하지 않으면, 전체 JSON 이 통째로 넘어온다.
- ECS 컨테이너 헬스체크와 ALB 헬스체크는 별개다. 둘 다 통과해야 서비스가 안정화된다.
- Fargate + Default VPC + NAT 없음 조합에서는 Public IP 를 반드시 활성화해야 ECR pull 이 된다.
- AWS IAM 권한 설정은 언제나 까다롭지만, 보안의 핵심이다. OIDC 로 장기키를 제거한 건 이번 마이그레이션의 숨은 MVP.
- EB 환경 종료 시 RDS Deletion Protection 은 생명줄이다. 반드시 확인하자.
- 로그는 거짓말을 하지 않는다. 에러 메시지를 꼼꼼히 읽자.
- 레거시는 부끄러운 과거가 아니라, 더 나은 구조로 가기 위한 발판이다.

# Reference
- https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html
- https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/intro.html
- https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html

# 연결문서
- [GitHub Actions와 Docker, Elastic Beanstalk로 통합 배포 자동화하기](/post/github-actionswa-docker-elastic-beanstalkro-tonghap-baepo-jadonghwahagi)
- [EC2 초기 세팅 자동화 스크립트](/post/ec2-chogi-seting-jadonghwa-seukeuripteu)
- [Winston + CloudWatch 구조화 로깅 구현](/post/winston-cloudwatch-gujohwa-roging-guhyeon)
