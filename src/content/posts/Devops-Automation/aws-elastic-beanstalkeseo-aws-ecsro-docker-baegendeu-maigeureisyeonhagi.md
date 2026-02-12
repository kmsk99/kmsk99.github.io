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

기존에 NestJS 와 Docker 를 이용해서 AWS Elastic Beanstalk 에 Docker 플랫폼을 통해 서버를 배포하여 운영해왔었다. 하지만 이 Elastic Beanstalk 는 EC2 인스턴스 위에 Docker 컨테이너를 띄우는 방식이라 컨테이너 환경에 완전히 최적화되어 있지 않았고, 무엇보다 EC2 인스턴스를 계속 점유하다 보니 비용 효율도 좋지 못했다. 또한, .ebextensions 같은 독자적인 설정 파일에 의존해야 해서 세부적인 인프라 컨트롤이 까다로웠다.

사실, 이 서버를 처음 배포할 당시에는 클라우드 인프라에 대한 지식이 부족했고, 그 부족한 상태에서 선택할 수 있는 가장 쉽고 빠른 최선의 선택이 EB 였다. 하지만 이제는 서비스가 성장하고 인프라 지식도 쌓인 만큼, 이 레거시를 청산하고 AWS ECS Fargate 로 마이그레이션을 진행해보기로 했다.

이 글은 그 삽질과 배움의 기록이다.

---

### 1. 왜 굳이 ECS Fargate 인가?

기존 EB 환경도 돌아가긴 했다. 하지만 비용 효율성과 관리 편의성 두 마리 토끼를 다 놓치고 있었다.

Elastic Beanstalk 는 편하긴 하지만, 그 아래 깔린 EC2 를 직접 관리해야 하는 부담이 여전히 존재했다. 반면 ECS Fargate 는 서버리스 컨테이너 서비스다.

- 서버 관리 불필요: OS 패치나 인스턴스 관리를 AWS 에 위임할 수 있다.
- 비용 최적화: 실행된 컨테이너의 CPU/Memory 리소스만큼만 비용을 지불한다.
- Docker 친화적: Task Definition 을 통해 컨테이너 설정을 아주 세밀하게 제어할 수 있다.

### 2. 마이그레이션 아키텍처 설계

가장 먼저 한 일은 기존 아키텍처를 분석하고 ECS 에 맞는 새 그림을 그리는 것이었다.

- Front: Vercel
- Back: Elastic Beanstalk → ECS Fargate
- CI/CD: GitHub Actions
- Registry: ECR

특히 보안을 위해 기존에 사용하던 Long-term Access Key 를 제거하고, GitHub Actions 에서 OIDC 를 통해 AWS 권한을 임시로 획득하도록 파이프라인을 전면 수정했다. 이제 내 로컬이나 깃허브 시크릿에 민감한 AWS 키를 저장할 필요가 없어졌다.

### 3. 난관의 시작: 환경변수와의 전쟁

인프라를 테라폼 같은 IaC 없이 콘솔과 CLI 로 하나씩 잡아가다 보니, 예상치 못한 곳에서 문제가 터졌다. 바로 환경변수 주입 문제였다.

NestJS 앱이 시작되자마자 이런 에러를 뱉으며 죽어버렸다.

Bash

```
Error: Config validation error: POSTGRES_USER is required. POSTGRES_PASSWORD is required...
```

EB 에서는 설정 메뉴에서 환경변수를 텍스트로 넣으면 알아서 주입됐지만, ECS 는 Task Definition 에 명시적으로 정의해야 했다. 보안상 민감한 DB 접속 정보나 API 키들은 AWS Secrets Manager 에 저장하고, ECS 가 이를 가져다 쓰도록 설정했다.

하지만 설정을 마쳤음에도 불구하고 이번엔 이런 에러가 떴다.

Bash

```
TypeError: Cannot read properties of undefined
at new EncryptionService ...
```

로그를 뜯어보니 ENCRYPTION_KEY 환경변수가 제대로 로드되지 않아 암호화 서비스가 초기화되다 죽은 것이었다. 알고 보니 Secrets Manager 의 ARN 을 Task Definition 에 매핑할 때, JSON 키 값을 정확히 지정하지 않아 전체 JSON 덩어리가 넘어가거나 파싱이 안 되는 문제였다.

결국 Task Definition 의 secrets 섹션을 꼼꼼히 수정하고, IAM Role 에 secretsmanager:GetSecretValue 권한이 잘 들어가 있는지 수십 번 확인한 끝에야 초록색 Running 상태를 볼 수 있었다.

### 4. 무중단 배포를 향하여

서비스를 중단 없이 넘기기 위해 Blue/Green 배포 전략을 흉내 냈다.

1. ECS 인프라 구축: 기존 EB 는 그대로 둔 채, 옆에 ECS 클러스터와 서비스를 새로 띄웠다.
2. 트래픽 분산: Route53 이나 ALB 의 가중치 기반 라우팅을 이용해 트래픽의 10% 만 ECS 로 흘려보냈다.
3. 모니터링: CloudWatch 로그와 헬스 체크를 매의 눈으로 감시했다. 다행히 200 OK 가 뜨기 시작했다.

### 5. 마무리하며

처음 EB 를 세팅할 때의 막막함과는 다른, 뭔가 제대로 된 시스템을 구축하고 있다는 희열이 있었다.

이제 우리 서버는 EC2 의 족쇄에서 벗어나 Fargate 위에서 유연하게 스케일링 된다.

물론 아직 갈 길은 멀다. Auto Scaling 정책도 더 다듬어야 하고, 비용을 더 줄이기 위해 Fargate Spot 도입도 고려해야 한다. 하지만 부족한 상태에서의 최선이었던 EB 를 보내주고, 더 나은 기술적 선택인 ECS 로 넘어왔다는 사실만으로도 개발자로서 한 뼘 성장한 기분이다.

Lesson Learned:

- AWS IAM 권한 설정은 언제나 까다롭지만, 보안의 핵심이다.
- 로그는 거짓말을 하지 않는다. 에러 메시지를 꼼꼼히 읽자.
- 레거시는 부끄러운 과거가 아니라, 더 나은 구조로 가기 위한 발판이다.

# Reference
- https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html
- https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/intro.html
- https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html

# 연결문서
- [GitHub Actions와 Docker, Elastic Beanstalk로 통합 배포 자동화하기](/post/github-actionswa-docker-elastic-beanstalkro-tonghap-baepo-jadonghwahagi)
- [EC2 초기 세팅 스크립트를 만들며 자동화에 집착한 이유](/post/ec2-chogi-seting-seukeuripteureul-mandeulmyeo-jadonghwae-jipchakan-iyu)
- [Winston과 CloudWatch로 구조화 로깅 파이프라인 다듬기](/post/winstongwa-cloudwatchro-gujohwa-roging-paipeurain-dadeumgi)
