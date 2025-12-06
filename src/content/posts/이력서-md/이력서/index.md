---
title: 이력서
slug: 이력서
created: '2025-10-10T02:28:43.210Z'
modified: '2025-10-10T02:41:12.517Z'
---
# 김민석
010-4181-7601 | kmsk96@naver.com

## 소개
스타트업 CTO로 3년이 넘는 시간 동안 초기 기획, 시스템 아키텍처, 운영을 일관되게 이끌어 왔습니다. 웹·모바일 클라이언트부터 백엔드, 데이터 파이프라인, 클라우드 인프라까지 직접 설계하고 배포해 실서비스를 성장시킨 경험을 보유하고 있습니다. 특히 보안과 자동화에 집중해 민감 데이터 보호, 장애 복구, 품질 게이트를 코드로 구현해 조직의 실행력을 높였습니다.

## 핵심 역량
- 엔드투엔드 제품 설계: 문제 정의와 UX 설계부터 프론트·백엔드·인프라 개발까지 일관된 아키텍처 구현
- 보안 및 개인정보 보호: AES-256, AWS KMS, Web Crypto, 다단계 인증·권한 분리로 제로 트러스트 흐름 구축
- 클라우드 & DevOps: AWS Elastic Beanstalk, S3, CloudWatch, Docker, GitHub Actions, pnpm 모노레포로 배포 자동화
- 데이터 & 워크플로우 자동화: OCR, PDF 생성, Supabase/Firebase 기반 실시간 처리, cron 파이프라인 설계
- 모바일·웹 동시 운영: Next.js(App Router), React Native, Expo, PWA 등 멀티 플랫폼 사용자 경험 최적화

## 기술 스택
- 언어: TypeScript, JavaScript, Python
- 프론트엔드: Next.js, React, React Native, Expo, Feature-Sliced Design, React Query
- 백엔드: NestJS, GraphQL, Prisma, Supabase, Firebase, Express
- 보안 & 데이터: AWS KMS, AES-GCM/ECB, Web Crypto API, HMAC, OAuth, Prisma Middleware
- 인프라 & DevOps: AWS (Elastic Beanstalk, S3, CloudFront, CloudWatch, Lambda), Docker, pnpm, GitHub Actions, Husky, ESLint, Prettier

## 경력
### 주식회사 포트존(PORTZONE) | CTO | 2023.05 - 현재
- 초기 멤버로 제품 비전 설계, 개발 문화·코드 리뷰·품질 게이트 자동화를 정착시켜 배포 리드타임과 장애 대응 시간을 절반 이하로 단축했습니다.

#### 스쿨밋
- 10,000+ SVG 아이콘을 자동으로 React 컴포넌트화하고 트리쉐이킹까지 지원하는 TypeScript 빌드 파이프라인과 사내 npm 패키지를 구축해 디자인 시스템 온보딩 시간을 70% 이상 절감했습니다.
- AWS KMS와 Web Crypto API를 결합한 이중 암호화, NICE 본인확인/PASS 인증 통합, 토스페이먼츠 결제 위젯 자동 재시도·웹훅 이중 검증을 구현해 개인정보 조회와 결제 실패율을 각각 0건으로 유지했습니다.
- Supabase Realtime 기반 채팅에 Optimistic Update, 구독 풀 관리, Circuit Breaker와 Exponential Backoff를 적용해 평균 응답 지연을 35% 개선하고 외부 인증·결제 API 장애를 자동 복구했습니다.
- Supabase RPC와 mapWithConcurrencyLimit 유틸로 포인트 적립·차감, 병렬 데이터 동기화를 안정화해 캠페인 운영 시 동시 호출 병목을 제거했습니다.
- Chain Flag 패턴과 네트워크 재시도 전략을 접목한 `useProfileWithRetry` 훅으로 Supabase 세션을 안정화하고, 로컬 HTTPS·로컬 관리자 인증 플로우까지 정비해 불안정한 네트워크에서도 끊김 없는 운영을 달성했습니다.
- AWS Lambda cron 엔드포인트와 Supabase Edge Functions를 연동해 AI 자동화 작업을 예약 실행하고, 장시간 호출은 Chain Flag 패턴으로 조율해 운영자 개입 없이도 안정적으로 완주했습니다.
- CLOVA OCR + AWS Bedrock LLM을 묶은 Fluid Pipeline을 설계해 학력 증빙 문서를 자동 추출·검증하고, 실패 로그와 재시도 큐를 구성해 수동 검수 시간을 절반 이하로 줄였습니다.
- AWS KMS와 AES-GCM 이중 암호화 업로드 파이프라인을 구축해 Supabase Storage에 저장되는 민감 파일을 서버 사이드에서 암호화·키 분리 보관하며, Lambda를 이용한 키 로테이션 전략을 수립했습니다.
- AWS CloudFront + Route53 + Supabase Storage 조합으로 대용량 첨부 업로드를 안정화하고, 갤럭시·iOS 등 플랫폼별 업로드 오류를 해결하는 보정 레이어를 React Native 파일 업로드 파이프라인에 추가했습니다.
- Expo Prebuild + patch-package 조합으로 네이티브 의존성 충돌을 해소하고 App Store/Play Store 심사 빌드를 자동화해 릴리스 사이클을 주 1회로 고정했습니다.
- Next.js 13 App Router에서 Firebase Auth 컨텍스트와 관리자 레이아웃 가드를 재구성해 관리자 콘솔 접근을 역할 기반으로 통제하고, 로딩 플래시 없이 보호 페이지를 제공했습니다.
- Deep Link friendly redirect validation과 NICE DI 중복 계정 탐지 API를 결합해 모바일 초대 코드·본인인증 흐름에서 보안 우회를 차단했습니다.
- Deep Link Validation, ActionSheet Wrapper 등 재사용 가능한 라이브러리·훅을 패키지화해 프로젝트 전반의 UI/UX 일관성을 확보했습니다.
- React Native ActionSheet, Bottom Sheet 커스텀 훅을 제작해 단말기별 UI 통합 이슈를 해소하고, 더블백 종료 규칙·In-App Browser 외부 전환 문제를 해결했습니다.
- NICE·카카오 OAuth 등 SNS 로그인 흐름을 Expo Router와 통합해 iOS/Android 모두에서 동일한 인증 경험을 제공하고, 로컬 리텐션 알림 스케줄링으로 월간 리텐션을 높였습니다.

#### 아이러브클럽
- NestJS + GraphQL + Prisma 예약 시스템을 설계해 실시간 예약 현황과 승인 여부를 처리하고, Prisma 트랜잭션으로 복합 도메인에서도 원자성을 보장했습니다.
- AES-256 결정적 암호화와 Prisma Middleware를 도입해 이메일·전화번호를 자동 암복호화하고, 역할 기반 승인 흐름과 세션/메모리 캐시 연동으로 인증 데이터 무결성을 보장했습니다.
- Feature-Sliced Design과 도메인 드리븐 UI 컴포넌트 구조로 프론트엔드 모듈을 재편해 신규 페이지 개발 시간을 절반 이하로 줄였습니다.
- pnpm 모노레포와 HeadVer·Husky 기반 버전 관리 파이프라인을 구축해 프론트·백엔드·공용 패키지를 단일 릴리스 주기로 묶고 품질 게이트를 자동화했습니다.
- GitHub Actions + Docker + Elastic Beanstalk CI/CD 파이프라인을 구축해 master 병합 후 7분 이내 배포, 실패 시 자동 롤백, 이메일 알림을 실현하고 CloudWatch + Winston으로 운영 로깅을 표준화했습니다.
- PWA 웹앱으로 모바일 사용성을 확보하며 S3 서명 URL 업로드, 오프라인 캐싱, jsPDF + Canvas 인증서 자동 생성, Firebase Admin SDK 푸시 알림까지 연결해 운영팀 수동 업무를 60% 이상 줄였습니다.
- 신청자-동아리-연합회 3단계 역할 기반 승인 워크플로우와 감사 로그를 추가해 민감 문서 승인 과정을 완전 자동화했습니다.
- Elastic Beanstalk 환경 튜닝(메모리 스왑, 프로세스 헬스 체크, 블루/그린 전환 스크립트)과 EC2 초기 세팅 자동화로 인프라 운영 부담을 낮췄습니다.

#### 담타 (크로스플랫폼 흡연 구역 지도 앱)
- Firebase 서버리스 백엔드와 Cloud Firestore/Storage를 결합한 API를 설계해 초기 비용 없이 실시간 데이터 수집과 사용자 인증을 안정적으로 처리했습니다.
- 공공기관·사용자 제보 데이터를 크론 파이프라인으로 수집·정제하고 지오코딩 자동화를 붙여 데이터 정합성과 업데이트 속도를 동시에 확보했습니다.
- 대용량 지도 마커를 실시간 클러스터링하고 React Native + 네이버 지도 SDK 최적화를 적용해 주요 도시에서도 프레임 드랍 없이 위치 기반 UX를 제공했습니다.


- 공통적으로 GitHub Actions, Husky, ESLint/Prettier, pnpm Workspace 자동화를 적용해 전 프로젝트에 일관된 품질·배포 프로세스를 유지했습니다.

## 사이드 프로젝트 & 기술 실험
- 크롬 확장 프로그램 기반 다국어 로렘 입숨 생성기를 기획부터 배포까지 구현하며 Manifest V3, i18next, Webpack 번들링, Chrome Web Store 리뷰 대응 경험을 쌓았습니다.
- Husky와 HeadVer를 활용한 버전 관리 자동화 템플릿을 정리해 GitHub Actions와 연동할 수 있는 예제를 제공, 사내 패키지 릴리스 워크플로우 표준화를 도왔습니다.
- Next.js 기반 기술 블로그 자동 생성 시스템을 설계하고, 문체 분석·카테고리 분류 프롬프트를 문서화해 팀 내 지식 전파 프로세스를 체계화했습니다.

## 기술 블로그 & 공개 활동
- Tech Deep Dive 시리즈 59편 집필: AES-256 + Prisma Middleware 개인정보 암호화, AWS KMS + AES-GCM 파일 업로드, GitHub Actions·Docker·Elastic Beanstalk 통합 배포, Supabase 병렬 호출 제어 등 실전 사례 공유
- Issue 카테고리 19편으로 React Native 지도·파일 업로드, Elastic Beanstalk 운영, Prisma 마이그레이션, PWA Builder, Docker 네트워킹 등 트러블슈팅 노하우 정리
- Project Showcase, prompt 시리즈를 통해 크롬 확장 프로그램, AI 자동화, 블로그 운영 시스템을 문서화하여 사내외 지식 전파와 협업 기반을 마련했습니다.
