---
tags:
  - Engineering
  - TechDeepDive
  - Supabase
  - Performance
  - Caching
  - Backend
title: 실시간 채팅을 위한 옵티미스틱 업데이트와 구독 관리 실험기
created: '2025-10-09 14:06'
modified: '2025-10-09 14:06'
---

# Intro
저는 채팅이 잠깐이라도 멈추면 손이 먼저 차가워지는 타입입니다. 상담팀이 "읽음 표시가 늦어요"라고 말하던 날, 실시간 로직을 처음부터 다시 점검했죠. Supabase Realtime만 믿기엔 모바일 환경이 너무 가변적이어서, 옵티미스틱 업데이트와 폴백 전략을 같이 쓰는 구조를 만들었습니다.

## 핵심 아이디어 요약
- `onComment`에서 임시 메시지를 추가하고, 서버에서 실제 메시지가 도착하면 교체하는 방식을 썼습니다.
- `subscribeToChatMessages` 구독과 5초 폴링을 함께 사용해 웹소켓이 끊겨도 대화가 이어지도록 했습니다.
- 파일 업로드는 `__optimisticUpload` 메타를 붙여 진행률을 표시하고, 실패 시 하드 딜리트를 시도합니다.

## 준비와 선택
1. **데이터 모델링**: 메시지는 `ChatMessageExtended`, 멤버는 `chat_members`로 분리해 실시간 이벤트에 필요한 필드만 구독했습니다.
2. **상태 관리**: 훅 내부에서 `setChatMessages`로 배열을 직접 다루며 `updateMessage` 유틸을 써서 정렬과 중복 처리를 단순화했습니다.
3. **네트워크**: Supabase 채널이 실패할 때를 대비해 5초 간격의 폴링과 브로드캐스트 이벤트를 함께 사용했습니다.

## 구현 여정
### Step 1: 옵티미스틱 메시지 구조 잡기
사용자가 메시지를 보내면 임시 ID를 가진 메시지를 먼저 배열에 추가하고, 서버 응답이 도착하면 교체합니다.

```ts
import { sendChatMessage, getChatMessage } from './chat-message-service';
import { updateMessage } from './chat-message-helpers';

const tempMessageId = `temp-${Date.now()}`;
const optimisticMessage = {
  id: tempMessageId,
  content,
  created_at: new Date().toISOString(),
  __isOptimistic: true,
};

setChatMessages(prev => updateMessage(prev, [optimisticMessage]));

const permanentId = await sendChatMessage({ chatRoomId, content });
if (!permanentId) {
  setChatMessages(prev => prev.filter(msg => msg.id !== tempMessageId));
  return false;
}

const persisted = await getChatMessage(permanentId);
setChatMessages(prev => {
  const filtered = prev.filter(msg => msg.id !== tempMessageId);
  return updateMessage(filtered, persisted ? [persisted] : []);
});
```

### Step 2: Supabase 구독 최적화
`subscribeToChatMessages`는 INSERT와 UPDATE 이벤트를 구독하고, 삭제는 `broadcast` 이벤트로 처리합니다. 다만 모바일에서 웹소켓이 끊기는 일이 잦아 5초마다 `getChatMessage`를 호출하는 폴링을 추가했습니다. 실시간과 폴링을 함께 돌리되, 컴포넌트 언마운트 시에는 `supabase.removeChannel(subscription)`으로 리스너를 정리했습니다.

### Step 3: 재연결 전략
웹소켓 연결이 끊기면 Supabase가 알아서 재연결하지만, 모든 재연결이 성공하지는 않았습니다. 그래서 `subscribe` 콜백에서 `CHANNEL_ERROR`가 오면 콘솔로그를 남기고, 폴링 루프가 새 메시지를 가져오면 `setChatMessages`로 보강하도록 만들었습니다.

### Step 4: 캐시 버스트와 히스토리 로드
과거 기록은 `loadMoreData`가 페이지네이션을 담당합니다. Supabase의 `range`를 이용해 50개 단위로 불러오고, 새로 가져온 메시지를 기존 배열과 병합할 때 `updateMessage`를 통해 중복을 제거합니다.

### Step 5: 메트릭 모니터링
`mapWithConcurrencyLimit`를 써서 여러 채팅방의 최근 메시지를 동시에 가져올 때도 최대 6개씩만 호출하게 했습니다. 덕분에 이벤트가 몰릴 때도 데이터베이스 부하가 확 튀지 않았습니다.

## 겪은 이슈와 해결 과정
- **메시지 순서 꼬임**: 처음에는 optimistic 메시지가 최신 메시지보다 위에 쌓였습니다. `updateMessage`가 배열을 정렬할 때 `created_at` 기준으로 묶어 해결했습니다.
- **구독 누수**: 페이지 이동 후에도 구독이 살아 있는 바람에 동일한 메시지가 두 번씩 들어왔습니다. `useEffect`에서 언마운트될 때 `unsubscribeMessagesInsert()`를 호출해 정리했습니다.
- **업로드 실패 잔여 데이터**: 파일 업로드가 전부 실패하면 빈 메시지가 남았습니다. `uploadFiles`가 실패 시 `deleteChatMessageHard`를 호출하도록 해 데이터베이스도 정리했습니다.

## 결과와 회고
지금은 상담팀이 "이제 메시지가 바로 뜬다"라고 말해줄 정도로 안정됐습니다. 실시간 채널이 끊겨도 폴백이 붙어 있으니 레이턴시가 크게 튀지 않고, 실패한 업로드가 남는 일도 없어졌습니다. 다음 과제는 오프라인 상태에서 쌓인 메시지를 다시 보내는 큐를 붙이는 일입니다.

여러분은 실시간 채팅을 최적화하면서 어떤 테크닉이 가장 도움이 되었나요? 댓글로 공유해 주시면 다음 개선에 참고해보고 싶어요.

# Reference
- https://supabase.com/docs/guides/realtime
- https://tanstack.com/query/latest/docs/react/overview
- https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API

# 연결문서
- [[mapWithConcurrencyLimit로 Supabase 병렬 호출을 조율한 이유]]
- [[갤럭시 기기까지 고려한 Supabase 첨부파일 업로드 안정화기]]
- [[AI 자동화를 cron 엔드포인트로 안전하게 트리거한 과정]]
