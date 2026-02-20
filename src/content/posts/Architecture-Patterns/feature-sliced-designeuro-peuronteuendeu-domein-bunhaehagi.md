---
tags:
  - FeatureSlicedDesign
  - Architecture
  - React
  - TypeScript
  - Frontend
title: Feature-Sliced Design으로 프론트엔드 도메인 분해하기
created: '2025-03-12'
modified: '2025-03-27'
---

# Intro

어느 날 `components/` 폴더를 열었다가 "이건 게시판 버튼인가, 프로필 버튼인가?"를 구분하지 못하고 노트북을 덮은 적이 있다. 체감상 500개가 넘는 파일이 한 자리에 섞여 있었거든. 그래서 Feature-Sliced Design(FSD) 패턴을 도입해 도메인별로 폴더를 재구성했다.

# 계층 구조

`entities`에는 도메인 모델과 UI, `features`에는 사용자 시나리오, `widgets`에는 페이지 조립용 블록을 배치했다. 라우트는 `views` 계층에서만 정의하고, 데이터 접근은 공유 라이브러리와 훅을 통해 이루어지도록 했다. madge와 dead-code 체크 스크립트로 의존성을 점검하고, path alias로 이동한 파일 경로를 빠르게 정리했다.

게시판, 채팅, 밋업, 프로필 등 주요 흐름을 뽑아 각자의 `entities` 폴더를 만들었다. `ui`, `hooks`, `model`, `libs` 디렉터리를 템플릿으로 삼아 새 도메인을 열 때도 구조가 흔들리지 않게 했다. madge와 `pnpm check:dead-code`를 CI에 걸어 의존성 루프와 사용되지 않는 모듈을 빠르게 잡았다.

# 구조 지도와 계층 규칙

기존 코드를 `pnpm check:visual`로 그래프화해 보고, 어떤 컴포넌트가 어디서 사용되는지 Notion에 기록했다. 데이터 접근 로직은 shared 계층으로 모으는 식으로 큰 덩어리를 먼저 이동했다. `entities` → `features` → `widgets` → `views`로만 의존성이 흐르도록 리뷰 기준을 정했다. 자동 검증 대신, PR 템플릿에 "도메인 컴포넌트를 상위 계층에서 직접 참조하지 않았나요?" 같은 질문을 넣어 자가 검토를 유도했다.

schoolmeets의 실제 FSD 디렉터리 구조는 다음과 같다. 채팅, 밋업, 커뮤니티 등 도메인별로 `entities`를 나누고, 각 슬라이스 안에 `ui/`, `hooks/`, `model/`, `libs/`를 둔다.

```
src/
├── app/           # Next.js App Router
├── entities/     # Chat, ChatRoom, DirectMessage, Community, Meetup, Profile, ...
├── features/     # Chat, Profile, Post, Meetup, School, ...
├── shared/       # supabase, components, atoms, types
├── views/        # Home, Community, Admin, MyPage, ...
└── widgets/      # Comment, Meetup, Community, Admin, ...
```

경로 수정은 TypeScript가 제공하는 리팩터 기능과 path alias(`@/*` → `src/*`) 덕분에 생각보다 수월했다. 프로젝트에서는 `useChatRoomMessages` 훅이 `subscribeToChatMessages`, `sendChatMessage`를 shared에서 가져와 쓰고, entity의 `ChatMessageList`를 조합한다.

```ts
import { useChatRoomMessages } from '@/entities/Chat';
import { ChatMessageList, ChatInput } from '@/entities/Chat';

export function ChatRoom({ chatRoomId, onComment }) {
  const {
    chatMessages,
    chatMembers,
    loadMoreData,
    hasNextPage,
    uploadFiles,
    onComment: handleComment,
  } = useChatRoomMessages(chatRoomId);

  return (
    <ChatLayout>
      <ChatMessageList
        messages={chatMessages}
        onLoadMore={loadMoreData}
        hasNextPage={hasNextPage}
      />
      <ChatInput onChat={handleComment} onUpload={uploadFiles} />
    </ChatLayout>
  );
}
```

온보딩 문서에 "entities에서는 데이터 요청을 직접 하지 않는다" 같은 룰을 정리했고, 신규 입사자가 바로 읽고 따라 할 수 있게 사례를 링크했다. 마지막으로 각 뷰를 점검하면서 widgets에서 shared 컴포넌트를 잘 가져다 쓰는지 리뷰했다. 라우트별 코드가 정리되니 모바일 전용 뷰도 금방 정리됐다.

# 겪은 이슈

경계 모호성: 채팅 초대 모달처럼 어디에 둘지 애매한 컴포넌트가 많았다. "도메인 데이터와 직접 맞닿으면 features, 그렇지 않으면 widgets"라는 기준을 세워 논쟁을 줄였다. 죽은 코드: 이동하면서 참조가 끊긴 모듈을 madge가 바로 찾아줬지만, enum처럼 눈에 띄지 않는 것들은 `pnpm check:dead-code:filtered`로 추가 확인했다. 리뷰 속도: 구조 개편 초반에는 PR이 커지기 쉬워서, 디렉터리 이동만 하는 PR과 로직 수정 PR을 분리했다.

# 결과

지금은 새 페이지를 추가할 때 "view → widget → feature → entity" 순서로 자연스럽게 손이 간다. 어디에 파일을 둘지 고민하는 시간보다 사용자 문제를 어떻게 풀지 고민하는 시간이 늘어난 게 가장 큰 수확이다. 다음에는 서버 컴포넌트 비중이 늘어나는 만큼 shared 계층을 더 작게 나누는 실험을 해볼 생각이다.

# Reference
- https://feature-sliced.design/
- https://github.com/pahen/madge

# 연결문서
- [SVG 아이콘을 React 컴포넌트 라이브러리로 만들어 자동 배포하기](/post/svg-aikoneul-react-keomponeonteu-raibeureoriro-mandeureo-jadong-baepohagi)
- [SVG 아이콘 라이브러리를 React Native에서도 쓸 수 있게 만들기](/post/svg-aikon-raibeureorireul-react-nativeeseodo-sseul-su-itge-mandeulgi)
- [HeadVer 버저닝 시스템을 JS 프로덕트에 적용하기](/post/headver-beojeoning-siseutemeul-js-peurodeokteue-jeongnyonghagi)
- [ESLint + Prettier + Husky 자동화 구성](/post/eslint-prettier-husky-jadonghwa-guseong)
