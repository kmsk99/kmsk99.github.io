---
tags:
  - Engineering
  - TechDeepDive
  - Supabase
  - Performance
  - Backend
title: mapWithConcurrencyLimit로 Supabase 병렬 호출을 조율한 이유
created: '2025-10-09 14:06'
modified: '2025-10-09 14:06'
---

# Intro
저는 채팅방이 30개가 넘는 순간, 최근 메시지를 한꺼번에 불러오다가 Supabase가 429를 뿜는 걸 보고 멘붕에 빠졌습니다. 한 번에 모든 방을 조회하는 건 무리였던 거죠. 그래서 `mapWithConcurrencyLimit`라는 유틸 함수를 만들어 병렬 호출 개수를 제한했습니다.

## 핵심 아이디어 요약
- 배열을 받아 순서대로 처리하되 한 번에 최대 N개만 비동기로 실행합니다.
- 실행 중 오류가 나도 전체가 멈추지 않고, 실패한 항목은 undefined로 채웁니다.
- 채팅방 최신 메시지 조회에 적용해 Supabase의 요청 폭주를 막았습니다.

## 준비와 선택
1. **작업 큐 설계**: Promise.all만으로는 폭주를 막을 수 없어서, while 루프 안에서 nextIndex를 증가시키는 워커 패턴을 선택했습니다.
2. **에러 허용**: 한 채팅방에서 오류가 나더라도 다른 방은 계속 처리해야 했기 때문에 try/catch에서 오류를 삼키고 빈 값을 넣었습니다.
3. **순서 보장**: 결과 배열이 원래 순서를 유지해야 했으므로, 각 워커가 완료될 때 해당 인덱스에 직접 쓰도록 했습니다.

## 구현 여정
### Step 1: 워커 패턴 작성
`mapWithConcurrencyLimit`는 `worker` 함수 여러 개를 만들어 `items` 길이만큼 nextIndex를 증가시키며 mapper를 호출합니다. 각 워커는 자신의 인덱스가 배열 길이를 넘으면 종료됩니다.

```ts
export async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      try {
        results[current] = await mapper(items[current], current);
      } catch {
        // 실패한 항목은 undefined로 채워둔다.
        // @ts-expect-error 오류 허용
        results[current] = undefined;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}
```

실제 호출부에서는 다음과 같이 사용했습니다. 배열 길이가 수십 개라도 동시에 실행되는 요청 수는 6개를 넘지 않습니다.

```ts
const latestMessages = await mapWithConcurrencyLimit(chatRoomIds, 6, async roomId => {
  const { data } = await supabase
    .from('chat_message')
    .select('*')
    .eq('chat_room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(1);

  return data?.[0] ?? null;
});
```

### Step 2: 오류 처리
mapper가 던진 오류는 catch에서 무시하고 결과 배열에 undefined를 넣습니다. 덕분에 `Promise.all`이 빠르게 실패하지 않고, 호출자가 실패한 항목만 골라 다시 시도할 수 있습니다.

### Step 3: 채팅방 최신 메시지에 적용
채팅방 ID 리스트를 넣고 limit을 6으로 설정해 Supabase 호출이 6개 이상 동시에 나가지 않도록 했습니다.

## 겪은 이슈와 해결 과정
- **빈 배열 반환**: mapper가 값을 반환하지 않으면 undefined가 들어옵니다. 호출부에서 결과를 필터링하거나 기본값을 설정해 UI가 깨지지 않도록 했습니다.
- **동시성 튜닝**: 처음에는 limit을 3으로 설정했는데 응답 시간이 길어져 6까지 올렸습니다. 더 높이면 속도는 빨라졌지만 Supabase가 간헐적으로 429를 주더군요.
- **디버깅**: 어떤 인덱스에서 실패했는지 알기 어려워 콘솔에 `current` 값을 기록했습니다. 나중에는 Sentry에 이벤트를 보내 어느 방이 실패했는지 추적했습니다.

## 결과와 회고
지금은 채팅방이 수십 개여도 최신 메시지를 안정적으로 가져옵니다. 429 오류가 사라지고, 사용자에게는 항상 최신 콘텐츠를 보여줄 수 있게 됐죠. 앞으로는 백오프 전략을 추가해 Supabase가 과부하 상태일 때 자동으로 속도를 늦출 계획입니다.

여러분은 비동기 병렬 호출을 어떻게 조율하고 계신가요? 다른 패턴이 있다면 댓글로 공유해 주세요. 상황에 따라 적절한 동시성 제한을 정하는 방법이 궁금합니다.

# Reference
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all

# 연결문서
- [[갤럭시 기기까지 고려한 Supabase 첨부파일 업로드 안정화기]]
- [[실시간 채팅을 위한 옵티미스틱 업데이트와 구독 관리 실험기]]
- [[AI 자동화를 cron 엔드포인트로 안전하게 트리거한 과정]]
