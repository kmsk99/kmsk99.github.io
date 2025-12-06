---
tags:
  - Engineering
  - TechDeepDive
  - Supabase
  - Security
  - Backend
title: Supabase RPC로 포인트 적립·차감을 안전하게 처리한 방법
created: '2025-10-09 14:06'
modified: '2025-10-09 14:06'
---

# Intro
저는 포인트 적립 기능을 만들다가 “이 API를 누가 호출해도 되나?”라는 질문에 막혔습니다. 클라이언트에서 직접 포인트 테이블을 만지면 보안이 너무 약했고, 서버에서 중복 로직을 반복하기도 싫었습니다. 그래서 Supabase RPC와 서비스 롤 키를 결합해 트랜잭션을 데이터베이스로 밀어 넣는 전략을 선택했습니다.

## 핵심 아이디어 요약
- 서비스 롤 키로만 접근 가능한 서버 전용 Supabase 클라이언트를 사용합니다.
- 포인트 적립( `add_points`)·차감( `spend_points`)을 SQL 함수로 정의하고 RPC로 호출합니다.
- 포인트 잔액 및 내역 조회도 같은 전용 클라이언트로 처리해 RLS를 우회합니다.

## 준비와 선택
1. **서비스 롤 키**: 환경 변수에 서비스 롤 키를 저장하고, 서버에서만 사용할 수 있는 클라이언트를 따로 만들었습니다.
2. **RPC 설계**: 포인트 관련 계산을 SQL 함수로 옮겨 재사용성을 확보하고, 트랜잭션을 데이터베이스에 맡겼습니다.
3. **API 라우트 보호**: 관리자 전용 API는 로그인 사용자의 역할을 검증해 권한이 없는 요청을 곧바로 차단했습니다.

## 구현 여정
### Step 1: Admin 클라이언트 생성
`createAdminClient()`는 자동 세션 갱신과 쿠키 저장을 끄고 서비스 롤 키로 인증된 Supabase 클라이언트를 생성합니다. 키가 누락되면 즉시 예외를 던져 배포 단계에서 문제를 조기에 발견했습니다.

### Step 2: 포인트 적립과 사용
포인트를 적립·차감하는 함수는 모두 RPC를 호출하도록 만들었습니다.

```ts
import { createAdminClient } from './supabaseAdmin';

export const addUserPoints = async (
  userId: string,
  points: number,
  validityDays: number,
  sourceDescription?: string,
) => {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('add_points', {
    p_user_id: userId,
    p_points_to_add: points,
    p_validity_days: validityDays,
    p_source_description: sourceDescription,
  });
  if (error) throw error;
  return { success: true, batchId: data };
};
```

### Step 3: 잔액과 내역 조회
포인트 잔액과 사용 내역은 보안 뷰에서 가져옵니다. 서비스 롤만 접근할 수 있으므로 RLS를 건드리지 않고도 안전하게 데이터를 확인할 수 있습니다.

## 겪은 이슈와 해결 과정
- **권한 오류**: 서비스 롤 키가 없는 환경에서 호출되면 즉시 실패하도록 하고, 에러 메시지를 로그와 사용자 피드백으로 분리했습니다.
- **잘못된 파라미터**: RPC가 모호한 메시지를 던질 때가 있어, API 레이어에서 기본 검증(`points > 0` 등)을 먼저 수행했습니다.
- **중복 적립**: 동일한 이벤트가 두 번 들어와도 SQL 함수가 트랜잭션으로 처리해 중복을 방지했습니다.

## 결과와 회고
지금은 포인트 관련 API를 전부 서버에서만 호출하도록 막아두어 프런트엔드는 단순히 엔드포인트만 부르면 됩니다. 비즈니스 로직이 데이터베이스 함수에 모여 있어 회계 정책이 바뀌면 SQL 한 군데만 수정하면 되는 점도 만족스럽습니다. 다음에는 RPC 호출에 감사 로그를 붙여 누가 언제 포인트를 조정했는지 추적할 예정입니다.

여러분은 포인트나 크레딧 시스템을 어떻게 설계하고 계신가요? 다른 접근법이 있다면 꼭 공유해 주세요. 특히 RLS와 서비스 롤을 조합하는 노하우가 궁금합니다.

# Reference
- https://supabase.com/docs/guides/functions
- https://supabase.com/docs/reference/javascript/rpc
- https://supabase.com/docs/guides/auth/server-side

# 연결문서
- [갤럭시 기기까지 고려한 Supabase 첨부파일 업로드 안정화기](/post/gaelleoksi-gigikkaji-goryeohan-supabase-cheombupail-eomnodeu-anjeonghwagi)
- [결제 위젯 자동 재시도와 웹훅 이중 검증으로 에러 줄이기](/post/gyeolje-wijet-jadong-jaesidowa-wepuk-ijung-geomjeungeuro-ereo-jurigi)
- [AES-256과 Prisma Middleware로 개인정보 안전하게 돌리기](/post/aes-256gwa-prisma-middlewarero-gaeinjeongbo-anjeonhage-dolligi)
