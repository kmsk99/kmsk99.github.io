---
tags:
  - Engineering
  - TechDeepDive
  - AWS
  - Automation
  - GitHubActions
  - DevOps
  - Tooling
title: EC2 초기 세팅 스크립트를 만들며 자동화에 집착한 이유
created: '2024-11-28 10:30'
modified: '2024-11-28 10:30'
---

# Intro
- 저는 매번 EC2를 새로 열 때마다 `sudo yum update`부터 `pm2 startup`까지 반복하는 제 손을 보며 현타를 느꼈어요.
- 그래서 결국 한 번에 끝내는 초기화 스크립트를 작성했고, 그 과정에서 자동화 습관이 몸에 배었습니다.
- 똑같은 일을 세 번째 반복하고 있다면 이제는 스크립트로 뽑아내야 한다는 걸 몸소 깨달았습니다.

## 핵심 아이디어 요약
- OS 감지 → 패키지 설치 → Node/PM2 세팅 → Git/SSH 구성 → 앱 배포까지 한 스크립트에서 처리합니다.
- SSH 키 생성과 GitHub 인증을 인터랙티브하게 안내하며, 실패 시 Personal Access Token 경로를 제공했습니다.
- `.env` 템플릿을 자동으로 만들어 팀원이 바로 수정만 하면 되도록 했습니다.

## 준비와 선택
- Amazon Linux와 Ubuntu 두 가지를 모두 지원해야 했기에 `/etc/os-release`를 읽어 분기하도록 만들었습니다.
- Node.js는 18.x 라인을 고정했고, 패키지 관리자는 OS별로 `yum`과 `apt`를 나눠 처리했습니다.
- 팀 이름과 이메일을 기본 Git 설정에 넣어두고, 필요하면 나중에 덮어쓰게 했습니다.

## 구현 여정
- **Step 1: 로깅 함수와 색상 정의**  
  안내 문구를 색상으로 구분해, 원격 터미널에서도 진행 상황이 눈에 띄도록 했습니다.
- **Step 2: SSH 키 안내 절차**  
  키가 없으면 자동으로 생성하고, 공개키를 복사해 붙여넣도록 안내 메시지를 띄웁니다. 실패하면 PAT 방식을 선택할 수 있게 했습니다.
- **Step 3: 저장소 클론과 의존성 설치**  
  기존 디렉터리가 있을 경우 백업하고 새로 클론합니다. 이후 `npm install`과 `npm run build`까지 이어집니다.

```bash
npm install
npm run build
pm2 start dist/app.js --name "schoolmeets-api"
pm2 startup
pm2 save
```

- **Step 4: 환경 변수 템플릿과 방화벽 설정**  
  `.env` 파일을 기본값으로 채워두고, 수정이 필요한 값에는 주석을 남겼습니다. OS에 따라 firewall-cmd 혹은 ufw를 호출하도록 했습니다.
- **Step 5: 마지막 안내**  
  PM2 상태, 시스템 정보, 다음 단계 체크리스트를 한 번에 보여주는 마무리 섹션을 붙였습니다. 새로 합류한 동료가 그대로 따라 하면 되는 수준까지 만들고 싶었거든요.
- 테스트하면서 누락된 부분이 없는지 확인하려고 GPT에게 "이 스크립트를 우분투에서 돌릴 때 빠진 의존성이 있는지" 묻기도 했습니다. 운영체제별 차이를 빠르게 검증하는 데 도움을 받았어요.

## 결과와 회고
- 새 EC2를 띄우는 시간이 30분에서 5분으로 줄어들었고, 사람마다 달랐던 환경 차이도 크게 줄었습니다.
- 스크립트에 안내 문구를 충분히 넣으니, 야간에 전화해서 질문할 일도 줄어들었습니다.
- 다음에는 Ansible 같은 도구로 완전히 선언형으로 바꾸고, GitHub Actions에서 직접 배포할 수 있게 확장할 생각입니다.
- 여러분은 아직도 EC2에서 손으로 npm install을 치고 계신가요? 꼭 자동화 경험을 공유해 주세요.

# Reference
- https://pm2.keymetrics.io/docs/usage/quick-start/
- https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AccessingInstancesLinux.html

# 연결문서
- [버전 관리의 신세계, HeadVer 도입기 - JavaScript 개발자를 위한 완벽 가이드](/post/beojeon-gwalliui-sinsegye-headver-doipgi-javascript-gaebaljareul-wihan-wanbyeok-gaideu)
- [로컬 HTTPS와 클라우드 로드밸런서를 함께 다루며 얻은 실전 노하우](/post/rokeol-httpswa-keullaudeu-rodeubaelleonseoreul-hamkke-darumyeo-eodeun-siljeon-nohau)
- [Husky를 활용한 HeadVer 버전 관리 - GitHub Actions에서 로컬 커밋 자동화로 이전](/post/huskyreul-hwallyonghan-headver-beojeon-gwalli-github-actionseseo-rokeol-keomit-jadonghwaro-ijeon)
