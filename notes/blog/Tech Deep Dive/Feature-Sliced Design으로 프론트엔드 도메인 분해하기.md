---
tags:
  - Engineering
  - TechDeepDive
  - Monorepo
  - TypeScript
  - Frontend
  - Tooling
title: Feature-Sliced Design으로 프론트엔드 도메인 분해하기
created: 2025-10-09 14:06
modified: 2025-10-09 14:06
uploaded: "false"
---

# Intro
저는 어느 날 `components/` 폴더를 열었다가 “이건 게시판 버튼인가, 프로필 버튼인가?”를 구분하지 못하고 노트를 덮은 적이 있습니다. 체감상 500개가 넘는 파일이 한 자리에 섞여 있었거든요. 그래서 Feature-Sliced Design(FSD) 패턴을 도입해 도메인별로 폴더를 재구성했습니다.

## 핵심 아이디어 요약
- `entities`에는 도메인 모델과 UI, `features`에는 사용자 시나리오, `widgets`에는 페이지 조립용 블록을 배치했습니다.
- 라우트는 `views` 계층에서만 정의하고, 데이터 접근은 공유 라이브러리와 훅을 통해 이루어지도록 했습니다.
- madge와 dead-code 체크 스크립트로 의존성을 점검하고, path alias로 이동한 파일 경로를 빠르게 정리했습니다.

## 준비와 선택
1. **도메인 식별**: 게시판, 채팅, 밋업, 프로필 등 주요 흐름을 뽑아 각자의 `entities` 폴더를 만들었습니다.
2. **폴더 규칙**: `ui`, `hooks`, `model`, `libs` 디렉터리를 템플릿으로 삼아 새 도메인을 열 때도 구조가 흔들리지 않게 했습니다.
3. **검증 도구**: madge와 `pnpm check:dead-code`를 CI에 걸어 의존성 루프와 사용되지 않는 모듈을 빠르게 잡았습니다.

## 구현 여정
### Step 1: 기존 구조 지도 만들기
기존 코드를 `pnpm check:visual`로 그래프화해 보고, 어떤 컴포넌트가 어디서 사용되는지 Notion에 기록했습니다. 데이터 접근 로직은 shared 계층으로 모으는 식으로 큰 덩어리를 먼저 이동했습니다.

### Step 2: 계층별 규칙 세우기
`entities` → `features` → `widgets` → `views`로만 의존성이 흐르도록 리뷰 기준을 정했습니다. 자동 검증 대신, PR 템플릿에 “도메인 컴포넌트를 상위 계층에서 직접 참조하지 않았나요?” 같은 질문을 넣어 자가 검토를 유도했습니다.

### Step 3: 코드모드로 자동 이동
경로 수정은 TypeScript가 제공하는 리팩터 기능과 path alias 덕분에 생각보다 수월했습니다. 필요한 경우 일괄적으로 import를 바꾸고, `tsc`로 누락된 타입을 검증했습니다.

```ts
import { ChatMessageList } from '@/entities/chat';
import { useSendMessage } from '@/features/chat/send-message';

export function ChatRoomPage() {
  // feature 계층의 훅으로 도메인 로직을 읽어오고,
  // entity 계층의 UI 컴포넌트를 조합해 페이지를 구성합니다.
  const sendMessage = useSendMessage();
  return (
    <ChatLayout>
      <ChatMessageList />
      <ChatComposer onSubmit={sendMessage} />
    </ChatLayout>
  );
}
```

### Step 4: Onboarding 문서화
온보딩 문서에 “entities에서는 데이터 요청을 직접 하지 않는다” 같은 룰을 정리했고, 신규 입사자가 바로 읽고 따라 할 수 있게 사례를 링크했습니다.

### Step 5: 샌드박스 프로젝트 구축
마지막으로 각 뷰를 점검하면서 widgets에서 shared 컴포넌트를 잘 가져다 쓰는지 리뷰했습니다. 라우트별 코드가 정리되니 모바일 전용 뷰도 금방 정리됐습니다.

## 겪은 이슈와 해결 과정
- **경계 모호성**: 채팅 초대 모달처럼 어디에 둘지 애매한 컴포넌트가 많았습니다. “도메인 데이터와 직접 맞닿으면 features, 그렇지 않으면 widgets”라는 기준을 세워 논쟁을 줄였습니다.
- **죽은 코드**: 이동하면서 참조가 끊긴 모듈을 madge가 바로 찾아줬지만, enum처럼 눈에 띄지 않는 것들은 `pnpm check:dead-code:filtered`로 추가 확인했습니다.
- **리뷰 속도**: 구조 개편 초반에는 PR이 커지기 쉬워서, 디렉터리 이동만 하는 PR과 로직 수정 PR을 분리했습니다.

## 결과와 회고
지금은 새 페이지를 추가할 때 “view → widget → feature → entity” 순서로 자연스럽게 손이 갑니다. 어디에 파일을 둘지 고민하는 시간보다 사용자 문제를 어떻게 풀지 고민하는 시간이 늘어난 게 가장 큰 수확입니다. 다음에는 서버 컴포넌트 비중이 늘어나는 만큼 shared 계층을 더 작게 나누는 실험을 해볼 생각입니다.

여러분은 대규모 프론트엔드를 어떻게 정리하고 계신가요? 다른 패턴을 사용하고 계시다면 댓글로 자랑해 주세요. 서로의 폴더 구조를 비교해 보는 것도 꽤 재밌더라고요.

# Reference
- https://feature-sliced.design/

# 연결문서
- [[나만의 SVG 아이콘 라이브러리 만들기 여정기 (1편) - React 컴포넌트 변환과 컴파일 자동화]]
- [[JavaScript 프로덕트에서 HeadVer 버저닝 시스템을 적용하기]]
- [[ESLint·Prettier·Husky 자동화를 정착시키기까지]]
