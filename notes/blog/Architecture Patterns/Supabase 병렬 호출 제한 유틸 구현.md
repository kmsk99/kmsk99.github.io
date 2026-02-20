---
tags:
  - Supabase
  - Concurrency
  - Performance
  - NodeJS
  - Backend
title: Supabase 병렬 호출 제한 유틸 구현
created: 2025-04-03
modified: 2025-04-03
---

# Intro

채팅방이 30개가 넘는 순간, 최근 메시지를 한꺼번에 불러오다가 Supabase가 429를 뿜는 걸 보고 멘붕에 빠졌다. 한 번에 모든 방을 조회하는 건 무리였던 거다. 그래서 `mapWithConcurrencyLimit`라는 유틸 함수를 만들어 병렬 호출 개수를 제한했다.

# 워커 패턴 설계

배열을 받아 순서대로 처리하되 한 번에 최대 N개만 비동기로 실행한다. 실행 중 오류가 나도 전체가 멈추지 않고, 실패한 항목은 undefined로 채운다. 채팅방 최신 메시지 조회에 적용해 Supabase의 요청 폭주를 막았다.

Promise.all만으로는 폭주를 막을 수 없어서, while 루프 안에서 nextIndex를 증가시키는 워커 패턴을 선택했다. 한 채팅방에서 오류가 나더라도 다른 방은 계속 처리해야 했기 때문에 try/catch에서 오류를 삼키고 빈 값을 넣었다. 결과 배열이 원래 순서를 유지해야 했으므로, 각 워커가 완료될 때 해당 인덱스에 직접 쓰도록 했다.

# mapWithConcurrencyLimit 구현

프로젝트의 `shared/libs/concurrency.ts`에 있는 실제 구현이다. `limit <= 1`일 때는 순차 실행으로 폴백하고, 그 외에는 워커 패턴으로 동시에 최대 `limit`개만 실행한다.

```ts
export async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit <= 1) {
    const results: R[] = [];
    for (let i = 0; i < items.length; i += 1) {
      results.push(await mapper(items[i], i));
    }
    return results;
  }

  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      try {
        results[current] = await mapper(items[current], current);
      } catch (_error) {
        // @ts-expect-error - 오류 시 undefined 허용
        results[current] = undefined;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}
```

실제 호출부는 `chat-message.service.ts`의 `getLatestChatRoomMessages`에서 쓰인다. 채팅방 ID가 수십 개여도 동시에 실행되는 Supabase 요청은 6개를 넘지 않는다.

```ts
const limit = 6;
await mapWithConcurrencyLimit(chatRoomIds, limit, async chatRoomId => {
  let query = supabase
    .from('chat_message')
    .select(CHAT_MESSAGE_EXTENDED_SELECT_QUERY)
    .eq('chat_room_id', chatRoomId);

  if (blockedUserIds.length > 0) {
    query = query.not(
      'chat_member.user_id',
      'in',
      `(${blockedUserIds.join(',')})`,
    );
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1);

  if (!error && data && data.length > 0) {
    result[chatRoomId] = data[0];
  }
});
```

mapper가 던진 오류는 catch에서 무시하고 결과 배열에 undefined를 넣는다. 덕분에 `Promise.all`이 빠르게 실패하지 않고, 호출자가 실패한 항목만 골라 다시 시도할 수 있다.

# 겪은 이슈

mapper가 값을 반환하지 않으면 undefined가 들어온다. 호출부에서 결과를 필터링하거나 기본값을 설정해 UI가 깨지지 않도록 했다. 처음에는 limit을 3으로 설정했는데 응답 시간이 길어져 6까지 올렸다. 더 높이면 속도는 빨라졌지만 Supabase가 간헐적으로 429를 줬다. 어떤 인덱스에서 실패했는지 알기 어려워 콘솔에 `current` 값을 기록했다. 나중에는 Sentry에 이벤트를 보내 어느 방이 실패했는지 추적했다.

# 결과

지금은 채팅방이 수십 개여도 최신 메시지를 안정적으로 가져온다. 429 오류가 사라지고, 사용자에게는 항상 최신 콘텐츠를 보여줄 수 있게 됐다. 앞으로는 백오프 전략을 추가해 Supabase가 과부하 상태일 때 자동으로 속도를 늦출 계획이다.

# Reference
- https://supabase.com/docs/guides/platform/going-into-prod
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all

# 연결문서
- [[갤럭시 기기 Supabase 파일 업로드 안정화]]
- [[Supabase Realtime 채팅의 옵티미스틱 업데이트]]
- [[Vercel Cron으로 AI 자동화 트리거 구현]]
