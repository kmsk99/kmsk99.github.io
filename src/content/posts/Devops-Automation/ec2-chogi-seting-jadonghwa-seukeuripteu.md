---
tags:
  - AWS
  - EC2
  - Automation
  - Shell
  - DevOps
title: EC2 초기 세팅 자동화 스크립트
created: '2024-11-28 10:30'
modified: '2024-11-28 10:30'
---

EC2를 새로 열 때마다 `sudo yum update`부터 `pm2 startup`까지 반복하는 일이 지겨웠다. 결국 한 번에 끝내는 초기화 스크립트를 작성했고, 그 과정에서 자동화 습관이 몸에 배었다. 똑같은 일을 세 번째 반복하고 있다면 스크립트로 뽑아내야 한다는 걸 깨달았다.

## 스크립트가 하는 일

OS 감지 → 패키지 설치 → Node/PM2 세팅 → Git/SSH 구성 → 앱 배포까지 한 스크립트에서 처리한다. Amazon Linux와 Ubuntu 둘 다 지원해야 해서 `/etc/os-release`를 읽어 분기했다. Node.js는 18.x 라인을 고정했고, 패키지 관리자는 OS별로 `yum`과 `apt`를 나눠 처리했다.

```bash
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$NAME
    VER=$VERSION_ID
else
    log_error "❌ Cannot detect OS version"
    exit 1
fi

if "$OS" == *"Amazon Linux"*; then
    sudo yum update -y
    PACKAGE_MANAGER="yum"
elif "$OS" == *"Ubuntu"*; then
    sudo apt update && sudo apt upgrade -y
    PACKAGE_MANAGER="apt"
else
    log_error "❌ Unsupported OS: $OS"
    exit 1
fi
```

SSH 키가 없으면 자동으로 생성하고, 공개키를 복사해 붙여넣도록 안내 메시지를 띄웠다. 실패하면 Personal Access Token 경로를 제공했다. `.env` 템플릿을 자동으로 만들어 팀원이 바로 수정만 하면 되게 했다.

## 로깅과 안내

안내 문구를 색상으로 구분해 원격 터미널에서도 진행 상황이 눈에 띄게 했다. `log_info`, `log_success`, `log_warning`, `log_error`, `log_header` 함수로 단계별 출력을 통일했다.

```bash
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_header() { echo -e "${PURPLE}${1}${NC}"; }
```

기존 디렉터리가 있으면 백업하고 새로 클론한 뒤 `npm install`, `npm run build`까지 이어졌다.

```bash
# 기존 프로젝트 백업 후 클론
if [ -d "$PROJECT_DIR" ]; then
    mv "$PROJECT_DIR" "${PROJECT_DIR}.backup.$(date +%Y%m%d_%H%M%S)"
fi
git clone "$GITHUB_REPO" "$PROJECT_DIR"
cd "$PROJECT_DIR"
npm install
npm run build
pm2 start dist/app.js --name "api"
pm2 startup
pm2 save
```

`.env` 파일은 기본값으로 채워두고, 수정이 필요한 값에는 주석을 남겼다.

```bash
cat > .env << 'EOF'
# NICE API Configuration
CLIENT_ID=your_nice_client_id
SECRET_KEY=your_nice_secret_key
API_URL=https://svc.niceapi.co.kr:22001
PRODUCT_ID=your_nice_product_id

# Server Configuration
PORT=8888
NODE_ENV=production

# Session Configuration
SESSION_SECRET=your_strong_session_secret_here

# Return URL Configuration
RETURN_URL=https://your-elastic-ip:8888/checkplus_success

# SSL Configuration (선택사항)
SSL_CERT_PATH=./ssl/cert.pem
SSL_KEY_PATH=./ssl/key.pem
EOF
```

OS에 따라 firewall-cmd 혹은 ufw를 호출했다. 마지막에 PM2 상태, 시스템 정보, 다음 단계 체크리스트를 한 번에 보여주는 마무리 섹션을 붙였다. 테스트하면서 누락된 부분이 있는지 GPT에게 "이 스크립트를 우분투에서 돌릴 때 빠진 의존성이 있는지" 물어보며 검증했다.

## 결과

새 EC2를 띄우는 시간이 30분에서 5분으로 줄었고, 사람마다 달랐던 환경 차이도 크게 줄었다. 스크립트에 안내 문구를 충분히 넣으니 야간에 전화해서 질문할 일도 줄었다. 다음에는 Ansible 같은 도구로 완전히 선언형으로 바꾸고, GitHub Actions에서 직접 배포할 수 있게 확장할 생각이다.

# Reference
- https://docs.aws.amazon.com/ec2/
- https://pm2.keymetrics.io/docs/usage/quick-start/
- https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AccessingInstancesLinux.html

# 연결문서
- [HeadVer 버저닝 시스템을 JS 프로덕트에 적용하기](/post/headver-beojeoning-siseutemeul-js-peurodeokteue-jeongnyonghagi)
- [로컬 HTTPS와 ALB SSL 종료를 함께 다루기](/post/rokeol-httpswa-alb-ssl-jongnyoreul-hamkke-darugi)
