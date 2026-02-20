---
tags:
  - Supabase
  - EdgeFunctions
  - Compliance
  - LocationInfo
  - AWS
title: 위치정보법 준수를 위한 Edge Function 감사 로깅 아키텍처
created: '2025-06-20 10:00'
modified: '2025-06-20 14:00'
---

# 배경

위치 기반 서비스를 운영하려면 「위치정보의 보호 및 이용 등에 관한 법률」(이하 위치정보법)을 준수해야 한다. 이 법은 위치기반서비스사업자에게 위치정보의 수집/이용/제공 사실을 자동으로 기록하고 보존하도록 요구한다. 위치정보사업 허가 신청을 준비하면서, 이 기술적 요구사항을 어떻게 구현했는지 정리한다.

# 법적 요구사항

## 위치기반서비스사업자의 의무

위치정보법은 사업자를 두 종류로 나눈다.

- 위치정보사업자: GPS, Wi-Fi, 기지국 등으로 위치정보를 직접 수집/처리/제공 (허가제)
- 위치기반서비스사업자: 위치정보를 이용해 서비스를 제공 (신고제)

프로젝트에서 운영하는 흡연구역 찾기 서비스는 사용자의 GPS 좌표를 받아 주변 구역을 검색하는 서비스이므로 위치기반서비스사업자에 해당한다.

## 제16조: 보호조치 의무

위치정보법 제16조와 시행령 제20조에서 요구하는 기술적 조치:

1. 위치정보시스템에 대한 접근권한 확인을 위한 식별 및 인증
2. 위치정보시스템에 대한 접근사실의 전자적 자동기록/보존장치의 운영
3. 위치정보시스템의 침해사고 방지를 위한 보안프로그램 설치/운영
4. 위치정보의 안전한 저장/전송을 위한 암호화기술 적용

이 중 2번 "전자적 자동기록/보존"이 핵심이다. 위치정보를 수집하거나 이용할 때마다 그 사실이 시스템에 자동으로 기록되어야 하고, 이 기록(사실확인자료)은 법정 보존기간(6개월) 동안 보관해야 한다.

# Edge Function 도입 이유

기존 구조에서는 앱이 Supabase RPC를 직접 호출했다.

```
AS-IS: App → Supabase RPC (PostgreSQL) → Response
```

이 구조의 문제는 로그 수집을 강제할 수 없다는 것이다. 클라이언트가 RPC를 직접 호출하면 서버 사이드에서 "이 호출이 위치정보를 이용한 것인지" 판단하고 기록할 중간 계층이 없다.

Supabase Edge Function을 프록시로 두면 모든 위치정보 이용 요청이 이 함수를 경유하게 되고, 함수 내에서 로깅을 강제할 수 있다.

```
TO-BE: App → Edge Function → Supabase RPC → Response
                ↳ CloudWatch 감사 로그 (비동기)
```

# 위치정보 데이터 흐름

서비스의 데이터 흐름을 단계별로 정리하면:

1. 수집: 사용자 단말기의 GPS/Wi-Fi 모듈이 OS를 통해 좌표를 앱에 제공
2. 전송: 앱은 사용자의 정확한 좌표를 저장 목적으로 전송하지 않고, 지도 화면에 보이는 영역(Viewport BBox)을 계산해 서버에 요청. 모든 통신은 HTTPS로 암호화
3. 이용: Edge Function이 BBox를 받아 PostGIS RPC로 해당 영역의 흡연구역을 조회. 이때 사실확인자료 로그를 생성해 비동기 전송
4. 파기: 사용자 좌표는 쿼리 수행 즉시 메모리에서 해제. 서버 DB에 사용자 위치를 별도로 저장하지 않음

데이터 최소화 원칙에 따라, 감사 로그에는 구체적 좌표(위도/경도)를 포함하지 않는다. 로그 유출 시 2차 피해를 방지하기 위해서다.

# 감사 로깅 구현

## 로그 스키마

위치정보법 제16조 제2항과 시행령에 따라 수집/이용/제공 사실 확인자료를 기록한다.

```json
{
  "timestamp": "2024-05-20T10:00:00Z",
  "type": "USAGE",
  "principal": {
    "user_id": "user_12345"
  },
  "method": {
    "type": "GPS",
    "provider": "OS_VIA_APP"
  },
  "purpose": "Search_Smoking_Area",
  "metadata": {}
}
```

`type`은 `USAGE`(이용)와 `COLLECTION`(수집) 두 가지다. 사용자가 지도에서 구역을 조회하면 `USAGE`, 새로운 구역을 제보하면 `COLLECTION`으로 기록한다.

## Edge Function 구현

```ts
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  );

  const { west, south, east, north, p_s2_level, p_kinds } = await req.json();
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  const { data: { user } } = await supabaseClient.auth.getUser(token);

  const { data, error } = await supabaseClient.rpc('get_zone_s2_clusters_in_bbox', {
    west, south, east, north, p_s2_level,
    p_kinds: p_kinds || null,
    page_size: 1000,
  });

  if (!error) {
    const logPayload = {
      type: 'USAGE',
      principal: { user_id: user?.id ?? 'anonymous' },
      method: { type: 'GPS', provider: 'OS_VIA_APP' },
      purpose: 'Search_Smoking_Area',
      timestamp: new Date().toISOString(),
      metadata: {},
    };

    EdgeRuntime.waitUntil(
      fetch(AUDIT_LOG_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': AUDIT_LOG_API_KEY },
        body: JSON.stringify(logPayload),
      }).catch(err => console.error('[ComplianceLogger]', err))
    );
  }

  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
```

핵심 구현 포인트:

- `EdgeRuntime.waitUntil`: 응답을 먼저 반환한 뒤에도 비동기 작업의 실행을 보장하는 API. 로깅이 사용자 응답 시간에 영향을 주지 않으면서도 누락되지 않는다.
- Fire & Forget 패턴: 로깅 실패가 서비스 응답에 영향을 주지 않도록 `catch`로 에러만 기록하고 넘어간다.
- 좌표 미포함: `metadata`에 위도/경도를 넣지 않는다. 사실확인자료의 목적은 "누가 언제 무슨 목적으로 위치정보를 이용했는가"를 기록하는 것이지, 구체적 위치를 저장하는 것이 아니다.

## 컴플라이언스 로거 공통 모듈

모든 Edge Function이 동일한 로깅 로직을 사용하도록 `_shared/compliance-logger.ts`로 분리했다.

```ts
const AUDIT_LOG_ENDPOINT = Deno.env.get('AUDIT_LOG_ENDPOINT');
const AUDIT_LOG_API_KEY = Deno.env.get('AUDIT_LOG_API_KEY');

export interface ComplianceLogParams {
  type: 'USAGE' | 'COLLECTION';
  userId: string;
  purpose: string;
  metadata?: Record<string, any>;
}

export const logLocationUsage = async (params: ComplianceLogParams): Promise<void> => {
  const logPayload = {
    type: params.type,
    principal: { user_id: params.userId || 'anonymous' },
    method: { type: 'GPS', provider: 'OS_VIA_APP' },
    purpose: params.purpose,
    timestamp: new Date().toISOString(),
    metadata: params.metadata || {},
  };

  if (!AUDIT_LOG_ENDPOINT) {
    console.warn('AUDIT_LOG_ENDPOINT not set. Skipping.');
    return;
  }

  const logPromise = fetch(AUDIT_LOG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': AUDIT_LOG_API_KEY || '' },
    body: JSON.stringify(logPayload),
  }).catch(err => console.error('[ComplianceLogger]', err));

  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
    EdgeRuntime.waitUntil(logPromise);
  } else {
    await logPromise;
  }
};
```

`EdgeRuntime`이 없는 로컬 환경에서는 `await`로 폴백한다. 로깅 엔드포인트가 미설정이면 경고만 출력하고 넘어가므로 개발 환경에서 서비스가 중단되지 않는다.

# 로그 수집 파이프라인

Edge Function에서 전송된 로그는 AWS 인프라를 거쳐 불변 저장소에 보관된다.

```
Edge Function → API Gateway → Lambda (Ingestor) → CloudWatch Logs
                                                        ↓
                                                   Kinesis Firehose
                                                        ↓
                                                   S3 Object Lock
                                                   (Compliance mode)
```

## Lambda Ingestor

API Gateway 뒤의 Lambda가 로그를 검증하고 CloudWatch Logs에 적재한다.

```js
export const handler = async (event) => {
  const apiKey = event.headers['x-api-key'];
  if (apiKey !== API_SECRET_KEY) {
    return { statusCode: 401, body: '{"message":"Unauthorized"}' };
  }

  const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  if (!body || !body.type || !body.principal) {
    return { statusCode: 400, body: '{"message":"Invalid schema"}' };
  }

  const today = new Date().toISOString().split('T')[0];
  await ensureLogStream(`ingest-${today}`);

  await client.send(new PutLogEventsCommand({
    logGroupName: '/puffzone/location-access',
    logStreamName: `ingest-${today}`,
    logEvents: [{ message: JSON.stringify(body), timestamp: Date.now() }],
  }));

  return { statusCode: 200 };
};
```

## 불변 저장소 (S3 Object Lock)

법적 분쟁 시 무결성을 입증하기 위해 S3 Object Lock의 Compliance 모드를 사용한다.

- Compliance 모드: root 계정을 포함해 누구도 보존기간 만료 전에 객체를 삭제하거나 수정할 수 없다. WORM(Write Once Read Many) 보장
- 보존기간: 6개월 (위치정보법 시행령의 최소 보관 기간)
- 암호화: KMS CMK(고객 관리형 키)로 저장 시 암호화

CloudWatch Logs에 쌓인 로그는 Kinesis Data Firehose를 통해 S3로 실시간 적재된다. Firehose는 60~300초 간격으로 버퍼링하고 GZIP 압축 후 전송한다.

## CloudTrail 감시

로그 시스템 자체에 대한 변경 시도를 감시한다. 다음 API가 호출되면 즉시 알림이 발송된다.

- CloudWatch: `DeleteLogGroup`, `PutRetentionPolicy` (보관기간 단축 시도)
- S3: `DeleteBucket`, `PutObjectLockConfiguration`
- KMS: `DisableKey`, `ScheduleKeyDeletion`

EventBridge 규칙으로 이벤트를 감지하고 SNS를 통해 관리자에게 알린다.

```json
{
  "source": ["aws.logs", "aws.s3", "aws.kms"],
  "detail-type": ["AWS API Call via CloudTrail"],
  "detail": {
    "eventName": [
      "DeleteLogGroup", "PutRetentionPolicy",
      "DeleteBucket", "PutObjectLockConfiguration",
      "DisableKey", "ScheduleKeyDeletion"
    ]
  }
}
```

# 위치정보 활용 인벤토리

위치정보를 파라미터로 받거나 처리하는 모든 RPC의 목록을 관리한다. 이 인벤토리의 모든 함수가 로깅 대상이다.

### 이용 (Usage)
| 함수 | 입력 | 용도 |
|------|------|------|
| `get_zone_s2_clusters_in_bbox` | bbox | 지도 내 클러스터 조회 |
| `get_zones_in_bbox` | bbox | 지도 내 개별 구역 조회 |
| `get_zones_nearby` | 좌표, 반경 | 주변 구역 검색 |
| `search_smoking_zones` | 좌표, 키워드 | 키워드 검색 (거리순) |
| `get_zone_nonsmoking_merged_in_bbox` | bbox | 금연구역 폴리곤 조회 |

### 수집 (Collection)
| 함수 | 입력 | 용도 |
|------|------|------|
| `add_zone_point` | 좌표 | 신규 구역 제보 |
| `update_zone_point` | 좌표 | 구역 위치 수정 |

현재 `get_zone_s2_clusters_in_bbox`에 대해 Edge Function과 로깅이 적용되어 있고, 나머지 함수도 동일한 패턴으로 확장할 계획이다.

# 법령 대응 매핑

| 법적 요구사항 | 법령 근거 | 구현 |
|--------------|----------|------|
| 기술적 보호조치 | 제16조 1항, 시행령 제20조 | IAM 접근 통제, KMS 암호화 |
| 사실확인자료 자동기록 | 제16조 2항 | Edge Function에서 CloudWatch로 자동 전송 |
| 보존기간 | 시행령 (6개월) | S3 Object Lock Retention 6개월, CloudWatch 180일 |
| 파기 | 제23조 | S3 Lifecycle으로 보존기간 후 자동 삭제 |
| 접근 감시 | 해설서 (접근권한 확인) | CloudTrail + EventBridge 알림 |
| 암호화 | 시행령 제20조 2항 | KMS CMK, HTTPS 전송 |

# Reference

- https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=277359 (위치정보의 보호 및 이용 등에 관한 법률)
- https://www.lbsc.kr (위치정보지원센터)
- https://supabase.com/docs/guides/functions
- https://supabase.com/docs/guides/functions/background-tasks
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html
- https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/

# 연결문서

- [S2 Geometry 기반 서버사이드 지도 클러스터링](/post/s2-geometry-giban-seobeosaideu-jido-keulleoseuteoring)
- [PostGIS RPC로 구역 저장과 공간 조회](/post/postgis-rpcro-guyeok-jeojanggwa-gonggan-johoe)
- [S2 기반 히트맵 통계 집계와 조회](/post/s2-giban-hiteumaep-tonggye-jipgyewa-johoe)
- [React Native에서 Next.js API를 인증된 상태로 호출하기](/post/react-nativeeseo-next-js-apireul-injeungdoen-sangtaero-hochulhagi)
- [Firebase에서 Supabase로 기술 스택 전환](/post/firebaseeseo-supabasero-gisul-seutaek-jeonhwan)
