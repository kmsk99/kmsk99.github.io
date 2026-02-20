---
tags:
  - Supabase
  - Realtime
  - Chat
  - OptimisticUI
  - Subscriptions
  - Frontend
title: Supabase Realtime 채팅의 옵티미스틱 업데이트
created: 2025-10-09 14:06
modified: 2025-10-09 14:06
---

# Intro

QA 중에 "읽음 표시가 늦다"는 피드백이 올라왔을 때, 실시간 로직을 처음부터 다시 점검했다. Supabase Realtime만 믿기엔 모바일 환경이 너무 가변적이어서, 옵티미스틱 업데이트와 폴백 전략을 같이 쓰는 구조를 만들었다.

# 옵티미스틱 업데이트와 구독

`onComment`에서 임시 메시지를 추가하고, 서버에서 실제 메시지가 도착하면 교체하는 방식을 썼다. `subscribeToChatMessages` 구독과 5초 폴링을 함께 사용해 웹소켓이 끊겨도 대화가 이어지도록 했다. 파일 업로드는 `__optimisticUpload` 메타를 붙여 진행률을 표시하고, 실패 시 하드 딜리트를 시도한다.

메시지는 `ChatMessageExtended`, 멤버는 `chat_members`로 분리해 실시간 이벤트에 필요한 필드만 구독했다. 훅 내부에서 `setChatMessages`로 배열을 직접 다루며 `updateMessage` 유틸을 써서 정렬과 중복 처리를 단순화했다. Supabase 채널이 실패할 때를 대비해 5초 간격의 폴링과 브로드캐스트 이벤트를 함께 사용했다.

# 옵티미스틱 메시지 구조

사용자가 메시지를 보내면 임시 ID를 가진 메시지를 먼저 배열에 추가하고, 서버 응답이 도착하면 교체한다. 프로젝트의 `useChatRoomMessages` 훅에서 실제로 쓰는 `onComment` 흐름이다.

```ts
const onComment = async (content: string) => {
  const currentUserChatMember = chatMembers.find(
    member => member.user_id === userId,
  );

  const tempMessageId = `temp-${Date.now()}`;
  const tempMessage: ChatMessageExtended = {
    id: tempMessageId,
    content,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    chat_room_id: chatRoomId,
    chat_member_id: currentUserChatMember?.id || null,
    is_deleted: false,
    is_system: false,
    chat_member: currentUserChatMember || null,
    attachments: [],
    __isOptimistic: true,
  } as ChatMessageExtended & { __isOptimistic: boolean };

  try {
    setChatMessages(prev => updateMessage(prev, [tempMessage]));
    moveToBottom();

    const chatMessageId = await sendChatMessage({ chatRoomId, content });

    if (!chatMessageId) {
      setChatMessages(prev => prev.filter(msg => msg.id !== tempMessageId));
      errorMessage('메시지 전송에 실패했어요');
      throw new Error('메시지 전송 실패');
    }

    const updatedMessage = await getChatMessage(chatMessageId);

    if (updatedMessage) {
      setChatMessages(prev => {
        const filteredMessages = prev.filter(msg => msg.id !== tempMessageId);
        return updateMessage(filteredMessages, [updatedMessage]);
      });
    }

    await updateLastReadTime(chatRoomId);
    return true;
  } catch (e) {
    setChatMessages(prev => prev.filter(msg => msg.id !== tempMessageId));
    return false;
  }
};
```

# Supabase 구독과 폴링

`subscribeToChatMessages`는 INSERT와 UPDATE 이벤트를 구독하고, 삭제는 `broadcast` 이벤트로 처리한다. 프로젝트의 실제 구독 코드는 다음과 같다.

```ts
export const subscribeToChatMessages = (
  chatRoomId: string,
  callbacks: {
    onInsert?: (message: ChatMessageExtended) => void;
    onUpdate?: (message: ChatMessageExtended) => void;
  },
) => {
  const supabase = getSupabase();

  const subscription = supabase
    .channel(`chat_messages:${chatRoomId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_message',
        filter: `chat_room_id=eq.${chatRoomId}`,
      },
      async payload => {
        if (callbacks.onInsert) {
          const extendedMessage = await getChatMessage(payload.new.id);
          if (extendedMessage) callbacks.onInsert(extendedMessage);
        }
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_message',
        filter: `chat_room_id=eq.${chatRoomId}`,
      },
      async payload => {
        if (callbacks.onUpdate) {
          const extendedMessage = await getChatMessage(payload.new.id);
          if (extendedMessage) callbacks.onUpdate(extendedMessage);
        }
      },
    )
    .on('broadcast', { event: 'message_deleted' }, async payload => {
      if (callbacks.onUpdate && payload.message_id) {
        const extendedMessage = await getChatMessage(payload.message_id);
        if (extendedMessage) callbacks.onUpdate(extendedMessage);
      }
    })
    .subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR') {
        console.error(`채팅방 ${chatRoomId} 구독 오류:`, err);
      }
    });

  return () => supabase.removeChannel(subscription);
};
```

다만 모바일에서 웹소켓이 끊기는 일이 잦아 5초마다 `getChatRoomMessages`를 호출하는 폴링을 추가했다. 실시간과 폴링을 함께 돌리되, 컴포넌트 언마운트 시에는 `unsubscribeMessagesInsert()`로 리스너를 정리했다.

웹소켓 연결이 끊기면 Supabase가 알아서 재연결하지만, 모든 재연결이 성공하지는 않았다. 그래서 `subscribe` 콜백에서 `CHANNEL_ERROR`가 오면 콘솔로그를 남기고, 폴링 루프가 새 메시지를 가져오면 `setChatMessages`로 보강하도록 만들었다.

# 히스토리 로드와 메트릭

과거 기록은 `loadMoreData`가 페이지네이션을 담당한다. Supabase의 `range`를 이용해 50개 단위로 불러오고, 새로 가져온 메시지를 기존 배열과 병합할 때 `updateMessage`를 통해 중복을 제거한다. `mapWithConcurrencyLimit`를 써서 여러 채팅방의 최근 메시지를 동시에 가져올 때도 최대 6개씩만 호출하게 했다. 덕분에 이벤트가 몰릴 때도 데이터베이스 부하가 확 튀지 않았다.

# 겪은 이슈

처음에는 optimistic 메시지가 최신 메시지보다 위에 쌓였다. `updateMessage`가 배열을 정렬할 때 `created_at` 기준으로 묶어 해결했다. 페이지 이동 후에도 구독이 살아 있는 바람에 동일한 메시지가 두 번씩 들어왔다. `useEffect`에서 언마운트될 때 `unsubscribeMessagesInsert()`를 호출해 정리했다. 파일 업로드가 전부 실패하면 빈 메시지가 남았다. `uploadFiles`가 실패 시 `deleteChatMessageHard`를 호출하도록 해 데이터베이스도 정리했다.

# 결과

지금은 QA에서 더 이상 문제가 보고되지 않을 정도로 안정됐다. 실시간 채널이 끊겨도 폴백이 붙어 있으니 레이턴시가 크게 튀지 않고, 실패한 업로드가 남는 일도 없어졌다. 다음 과제는 오프라인 상태에서 쌓인 메시지를 다시 보내는 큐를 붙이는 일이다.

# Reference
- https://supabase.com/docs/guides/realtime
- https://tanstack.com/query/latest/docs/react/overview
- https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API

# 연결문서
- [[Supabase 병렬 호출 제한 유틸 구현]]
- [[갤럭시 기기 Supabase 파일 업로드 안정화]]
- [[Vercel Cron으로 AI 자동화 트리거 구현]]
