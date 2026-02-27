---
tags:
  - i18n
  - OIDC
  - GoogleTranslate
  - Vercel
  - WorkloadIdentityFederation
title: Vercel OIDC와 Google Translate API를 활용한 서버사이드 자동 번역
created: '2026-02-27'
modified: '2026-02-27'
---

# 배경

[React Native 앱의 다국어 지원 구현](/post/react-native-aebui-dagugeo-jiwon-guhyeon)에서 i18next 기반 정적 번역 파일과 서버사이드 푸시 알림 번역을 다뤘다. 정적 UI 텍스트는 번역 파일로 해결되지만, 사용자가 생성하는 동적 콘텐츠(장소 이름, 주소, 설명, 공지사항 등)는 미리 번역해둘 수 없다. 관리자가 장소 정보를 수정할 때마다 5개 언어로 수동 번역하는 것은 현실적이지 않았다.

Google Cloud Translation API v3를 도입해 서버사이드에서 자동 번역하되, Vercel 배포 환경에서 GCP 서비스 계정 키를 직접 관리하지 않기 위해 OIDC(OpenID Connect) 기반 Workload Identity Federation을 적용했다. 이 글에서는 인증 아키텍처부터 번역 파이프라인, 캐싱 전략까지 전체 흐름을 정리한다.

# 아키텍처 개요

```
┌──────────────┐    번역 요청     ┌──────────────────┐
│  React Native │ ──────────────▶ │  Next.js API Route │
│  (service-app)│                │  (service-admin)  │
└──────────────┘                 └────────┬─────────┘
                                          │
                                 ┌────────▼─────────┐
                                 │  Vercel OIDC Token │
                                 │  (x-vercel-oidc-   │
                                 │   token header)    │
                                 └────────┬─────────┘
                                          │ JWT
                                 ┌────────▼─────────┐
                                 │  GCP STS Endpoint  │
                                 │  (토큰 교환)       │
                                 └────────┬─────────┘
                                          │ Federated Token
                                 ┌────────▼─────────┐
                                 │  Service Account   │
                                 │  Impersonation     │
                                 └────────┬─────────┘
                                          │ Access Token
                                 ┌────────▼─────────┐
                                 │  Google Translate   │
                                 │  API v3             │
                                 └────────┬─────────┘
                                          │ 번역 결과
                                 ┌────────▼─────────┐
                                 │  Supabase          │
                                 │  (zone_locales)    │
                                 └──────────────────┘
```

앱에서 장소 상세 화면에 진입하면 `useZoneLocale` 훅이 번역 데이터를 요청한다. 캐시가 없거나 원본이 변경되었으면 Next.js API Route를 호출하고, 서버에서 Vercel OIDC → GCP STS → Google Translate 순으로 인증과 번역이 이루어진다. 결과는 Supabase `zone_locales` 테이블에 저장된다.

# OIDC 기반 인증: 왜 서비스 계정 키를 버렸는가

## 기존 방식의 문제

GCP API를 호출하려면 인증이 필요하다. 가장 단순한 방법은 서비스 계정 JSON 키를 발급받아 환경 변수에 저장하는 것이다.

```
GOOGLE_APPLICATION_CREDENTIALS={"type":"service_account","project_id":"...","private_key":"..."}
```

이 방식에는 세 가지 문제가 있다.

1. **키 유출 위험**: JSON 키에는 RSA 개인키가 포함된다. 환경 변수에 저장하면 로그, 에러 리포트, 팀원 로컬 환경 등 여러 경로로 노출될 수 있다.
2. **키 순환 부담**: 보안 모범 사례에 따르면 서비스 계정 키는 주기적으로 교체해야 한다. 수동 교체는 운영 부담이 크고, 교체 시 다운타임이 발생할 수 있다.
3. **권한 범위 제어 불가**: 키 하나로 모든 환경(개발, 프리뷰, 프로덕션)에서 동일한 권한을 갖는다.

## Workload Identity Federation

Workload Identity Federation은 외부 ID 프로바이더(IdP)가 발급한 토큰을 GCP가 신뢰하도록 설정하는 메커니즘이다. Vercel이 IdP 역할을 하고, GCP의 Security Token Service(STS)가 토큰을 교환한다.

인증 흐름은 3단계로 구성된다.

**1단계: Vercel OIDC 토큰 발급**

Vercel Functions가 실행될 때, Vercel은 자동으로 OIDC 토큰을 생성해 `x-vercel-oidc-token` 요청 헤더에 주입한다. 이 토큰은 JWT 형식이며 TTL이 60분이다. Vercel은 최대 45분간 캐싱하여 함수 실행 중 토큰 만료를 방지한다.

토큰의 `sub` 클레임에는 `owner:{team}:project:{project}:environment:{env}` 형식으로 배포 컨텍스트가 인코딩된다. 이를 통해 GCP 측에서 프로젝트와 환경별로 접근 권한을 세밀하게 제어할 수 있다.

**2단계: GCP STS 토큰 교환**

`google-auth-library`의 `ExternalAccountClient`가 Vercel OIDC 토큰을 GCP STS 엔드포인트(`https://sts.googleapis.com/v1/token`)에 제출한다. STS는 JWKS(JSON Web Key Set)를 통해 토큰의 서명을 검증하고, 유효하면 페더레이션 액세스 토큰을 발급한다.

**3단계: 서비스 계정 임퍼소네이션**

페더레이션 토큰으로 직접 GCP API를 호출할 수 없는 경우, IAM Credentials API를 통해 서비스 계정을 임퍼소네이트(impersonate)한다. 최종적으로 Google Translate API를 호출할 수 있는 단기 액세스 토큰이 발급된다.

## 구현

`@vercel/oidc` 패키지의 `getVercelOidcToken`을 `ExternalAccountClient`의 `subject_token_supplier`로 전달한다.

```ts
import {
  BaseExternalAccountClient,
  ExternalAccountClient,
} from 'google-auth-library';
import { getVercelOidcToken } from '@vercel/oidc';

let authClient: BaseExternalAccountClient | null = null;

const getAuthClient = () => {
  if (authClient) return authClient;

  const projectNumber = process.env.GCP_PROJECT_NUMBER;
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
  const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL;

  authClient = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience: `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
    subject_token_supplier: {
      getSubjectToken: getVercelOidcToken,
    },
  });

  return authClient;
};
```

`ExternalAccountClient.fromJSON`의 설정 객체를 분석하면:

- `audience`: Workload Identity Pool Provider의 전체 경로. GCP가 어떤 풀에서 토큰을 검증할지 결정한다.
- `subject_token_type`: OIDC JWT 토큰 타입을 명시한다(`urn:ietf:params:oauth:token-type:jwt`).
- `token_url`: GCP STS 엔드포인트. RFC 8693(OAuth 2.0 Token Exchange) 스펙을 따른다.
- `service_account_impersonation_url`: 페더레이션 토큰을 서비스 계정 액세스 토큰으로 교환하는 엔드포인트.
- `subject_token_supplier`: 토큰이 필요할 때 호출되는 콜백. `getVercelOidcToken`이 Vercel 런타임에서 OIDC 토큰을 가져온다.

`authClient`를 모듈 레벨에서 싱글턴으로 유지해 매 요청마다 클라이언트를 재생성하지 않도록 했다. `google-auth-library`가 내부적으로 토큰 갱신을 처리한다.

## GCP 콘솔 설정

Vercel 프로젝트에서 GCP API를 호출하려면 사전에 GCP 콘솔에서 다음을 설정해야 한다.

1. **Workload Identity Pool 생성**: IAM & Admin → Workload Identity Federation에서 풀을 생성한다(예: ID `vercel`).
2. **OIDC 프로바이더 추가**: 프로바이더 타입으로 OpenID Connect를 선택하고, Issuer URL에 `https://oidc.vercel.com/{TEAM_SLUG}`를 입력한다. Audience에는 `https://vercel.com/{TEAM_SLUG}`를 설정한다. 팀 단위 Issuer URL을 사용하면 다른 Vercel 팀의 토큰이 풀에 접근하는 것을 방지할 수 있다.
3. **프로바이더 속성 매핑**: `google.subject`를 `assertion.sub`에 매핑한다.
4. **서비스 계정 생성 및 역할 부여**: Cloud Translation API User 역할(`roles/cloudtranslate.user`)을 부여한다.
5. **서비스 계정 사용자 권한 부여**: 풀의 IAM Principal을 서비스 계정 사용자로 추가한다. `principal://iam.googleapis.com/projects/{PROJECT_NUMBER}/locations/global/workloadIdentityPools/vercel/subject/owner:{TEAM}:project:{PROJECT}:environment:production` 형태로 프로덕션 환경만 허용할 수 있다.

Vercel 프로젝트 환경 변수에 다음 값을 설정한다.

| 환경 변수 | 설명 | 예시 |
|---|---|---|
| `GCP_PROJECT_ID` | GCP 프로젝트 ID | `service` |
| `GCP_PROJECT_NUMBER` | GCP 프로젝트 번호 | `0000000000` |
| `GCP_WORKLOAD_IDENTITY_POOL_ID` | Workload Identity Pool ID | `vercel` |
| `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` | Pool Provider ID | `vercel` |
| `GCP_SERVICE_ACCOUNT_EMAIL` | 서비스 계정 이메일 | `vercel@service.iam.gserviceaccount.com` |

# Google Translate API v3 호출

인증이 완료되면 Cloud Translation API v3의 `translateText` 메서드를 호출한다.

```ts
const GOOGLE_TRANSLATE_API_BASE_URL = 'https://translation.googleapis.com/v3';

export const translateTexts = async (
  texts: string[],
  targetLocale: string,
): Promise<string[]> => {
  const projectId = process.env.GCP_PROJECT_ID;
  const location = process.env.GOOGLE_TRANSLATE_LOCATION || 'global';
  const normalizedLocale = normalizeLocale(targetLocale);

  const parent = `projects/${projectId}/locations/${location}`;
  const url = new URL(
    `${GOOGLE_TRANSLATE_API_BASE_URL}/${parent}:translateText`,
  );

  const client = getAuthClient();
  const accessTokenResponse = await client.getAccessToken();
  const accessToken =
    typeof accessTokenResponse === 'string'
      ? accessTokenResponse
      : accessTokenResponse?.token;

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      contents: texts,
      targetLanguageCode: normalizedLocale,
      mimeType: 'text/plain',
    }),
  });

  const data = await response.json();
  return data.translations.map(item => String(item.translatedText));
};
```

`contents`에 여러 텍스트를 배열로 전달하면 단일 API 호출로 일괄 번역된다. 장소의 이름, 주소, 설명을 한 번에 보내 네트워크 왕복을 줄였다.

## 로케일 정규화

이전 글에서 다뤘던 중국어 로케일 정규화와 동일한 문제가 서버에서도 발생한다. 앱에서 전달하는 로케일 코드가 플랫폼(iOS/Android)에 따라 다를 수 있으므로, Google Translate API에 전달하기 전에 정규화한다.

```ts
const normalizeLocale = (locale: string) => {
  const lower = locale.trim().toLowerCase();
  if (!lower) return 'en';

  if (lower.startsWith('zh')) {
    if (
      lower.includes('hant') || lower.includes('tw') ||
      lower.includes('hk') || lower.includes('mo')
    ) {
      return 'zh-TW';
    }
    return 'zh';
  }

  return lower.split('-')[0] || 'en';
};
```

`zh-Hant-TW`, `zh-TW`, `zh-Hant`, `zh-HK`, `zh-MO`는 모두 `zh-TW`(번체)로, 나머지 `zh-*`는 `zh`(간체)로 매핑한다. 앱의 `normalizeLanguageCode`와 동일한 로직을 서버에도 유지해 클라이언트-서버 간 로케일 불일치를 방지한다.

# 번역 API Route 설계

## zone_locales: 장소 번역

```
POST /api/zone-locales/translate
Body: { zone_id: string, locale: string }
```

API Route의 처리 흐름:

1. **원본 조회**: Supabase에서 `zones` 테이블의 `name`, `address`, `description`을 조회한다.
2. **소스 해시 생성**: 원본 텍스트를 SHA-256 해시로 변환한다.
3. **캐시 확인**: `zone_locales` 테이블에서 동일한 `zone_id`와 `locale` 조합을 조회한다.
4. **신선도 판단**: 기존 번역의 `source_hash`와 비교해 원본 변경 여부를 확인한다.
5. **번역 실행**: 원본이 변경되었으면 Google Translate API를 호출한다.
6. **결과 저장**: `zone_locales`에 upsert한다.

## 소스 해시 기반 캐싱

자동 번역에서 가장 주의할 점은 불필요한 API 호출을 줄이는 것이다. Google Translate API는 호출당 과금되므로, 원본이 변경되지 않았는데 매번 번역하면 비용이 낭비된다.

```ts
const buildSourceHash = (zone: {
  name: string | null;
  address: string | null;
  description: string | null;
}) => {
  const payload = JSON.stringify({
    name: zone.name ?? '',
    address: zone.address ?? '',
    description: zone.description ?? '',
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
};
```

번역 대상 필드(name, address, description)를 JSON 직렬화한 뒤 SHA-256 해시를 생성한다. 이 해시를 `zone_locales` 레코드에 `source_hash` 컬럼으로 저장한다. 다음 번역 요청 시 현재 원본의 해시와 저장된 해시를 비교해, 동일하면 기존 번역을 그대로 반환한다.

```ts
const isZoneLocaleFresh = (existing, sourceHash, zoneUpdatedAt) => {
  if (!existing) return false;

  // 1차: source_hash 비교 (정확한 비교)
  if (existing.source_hash) {
    return existing.source_hash === sourceHash;
  }

  // 2차: updated_at 비교 (source_hash가 없는 레거시 데이터용)
  if (!existing.updated_at || !zoneUpdatedAt) return false;
  return new Date(existing.updated_at).getTime() >= new Date(zoneUpdatedAt).getTime();
};
```

`source_hash`가 없는 레거시 데이터는 `updated_at` 타임스탬프로 폴백한다. 새로 생성되는 레코드는 항상 `source_hash`를 포함하므로, 점진적으로 해시 기반 비교로 전환된다.

## notice_locales: 공지사항 번역

공지사항(`notices`)도 동일한 패턴으로 번역한다.

```
POST /api/notice-locales/translate
Body: { notice_id: string, locale: string }
```

대상 필드만 `title`, `content`로 다르고, 소스 해시 생성, 신선도 판단, 번역 실행, upsert 저장의 흐름은 동일하다. 관리자가 공지사항을 작성하면 한국어 원문만 입력하고, 앱에서 사용자의 로케일에 맞게 자동 번역된다.

# 앱에서의 번역 데이터 소비

## useZoneLocale 훅

앱에서는 `useZoneLocale` 커스텀 훅으로 번역 데이터를 관리한다.

```ts
export const useZoneLocale = (zone?: ZoneInput | null) => {
  const { i18n } = useTranslation();
  const locale = i18n.language ?? 'en';

  // Jotai atom으로 메모리 캐시 관리
  const [cachedLocales, setCachedLocales] = useAtom(zoneLocalesCacheAtom);
  const [requestedLocales, setRequestedLocales] = useAtom(zoneLocalesRequestsAtom);

  // ...

  return { zoneLocale, locale, isLoading };
};
```

훅의 동작 흐름:

1. **메모리 캐시 확인**: Jotai atom에 `{zoneId}:{locale}` 키로 캐싱된 데이터가 있는지 확인한다.
2. **소스 해시 계산**: 앱에서도 동일한 로직으로 소스 해시를 계산한다. 다만 Node.js의 `crypto` 대신 `expo-crypto`를 사용한다.
3. **Supabase 직접 조회**: 먼저 `zone_locales` 테이블에서 직접 조회를 시도한다.
4. **번역 요청**: 기존 번역이 없거나 소스 해시가 불일치하면 `/api/zone-locales/translate`를 호출한다.
5. **중복 요청 방지**: 동일한 zone+locale+hash 조합에 대해 진행 중인 요청이 있으면 Promise를 재사용한다.
6. **재시도**: 네트워크 오류 시 최대 3회, 1초 간격으로 재시도한다.

## 중복 요청 방지 메커니즘

리스트 화면에서 같은 장소 카드가 여러 번 렌더링되거나, 빠르게 스크롤하면 동일 번역 요청이 중복 발생할 수 있다.

```ts
const requestKey = `${zoneId}:${locale}:${sourceHash ?? zoneUpdatedAt ?? ''}`;
const existingPromise = requestedLocales.get(requestKey);

const translationPromise = existingPromise || (() => {
  const newPromise = (async () => {
    try {
      const result = await requestTranslationWithRetry();
      setCachedLocales(prev => {
        const next = new Map(prev);
        next.set(cacheKey, result);
        return next;
      });
      return result;
    } finally {
      setRequestedLocales(prev => {
        const next = new Map(prev);
        next.delete(requestKey);
        return next;
      });
    }
  })();

  setRequestedLocales(prev => {
    const next = new Map(prev);
    next.set(requestKey, newPromise);
    return next;
  });

  return newPromise;
})();
```

Jotai atom(`zoneLocalesRequestsAtom`)에 진행 중인 Promise를 `requestKey`로 저장하고, 동일한 키의 요청이 들어오면 기존 Promise를 반환한다. 요청이 완료되면 맵에서 제거하여 이후 재시도가 가능하도록 한다.

## 컴포넌트에서의 사용

번역 데이터를 소비하는 컴포넌트에서는 `zoneLocale` 필드를 우선 사용하되, 없으면 원본으로 폴백한다.

```tsx
const { zoneLocale } = useZoneLocale(zone);

<Text>{zoneLocale?.name || zone.name}</Text>
<Text>{zoneLocale?.address || zone.address}</Text>
```

번역 데이터가 아직 로딩 중이어도 원본 텍스트가 즉시 표시되므로 UX가 끊기지 않는다. 번역이 완료되면 자연스럽게 교체된다.

# zone_locales 테이블 설계

```sql
CREATE TABLE zone_locales (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id     uuid NOT NULL REFERENCES zones(id),
  locale      text NOT NULL,
  name        text,
  address     text,
  description text,
  provider    text,         -- 'GOOGLE_TRANSLATE'
  source_hash text,         -- 원본 SHA-256 해시
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz,
  UNIQUE (zone_id, locale)  -- zone_id + locale 복합 유니크 제약
);
```

`zone_id`와 `locale`의 복합 유니크 제약으로 하나의 장소에 로케일당 하나의 번역 레코드만 존재하도록 보장한다. 서버의 `createZoneLocale`은 이 제약을 활용해 `upsert`로 삽입 또는 갱신한다.

```ts
const { data, error } = await supabase
  .from('zone_locales')
  .upsert(zoneLocale, { onConflict: 'zone_id,locale' })
  .select('*')
  .single();
```

`provider` 컬럼은 번역 제공자를 기록한다. 현재는 `GOOGLE_TRANSLATE`만 사용하지만, 향후 다른 번역 엔진을 추가하거나 수동 번역을 구분할 때 활용할 수 있다.

# 운영 시 고려사항

## 비용 관리

Google Cloud Translation API v3는 번역된 문자 수 기준으로 과금된다(월 50만 자까지 무료). 소스 해시 캐싱으로 불필요한 호출을 방지하되, 다음 상황은 주의가 필요하다.

- 관리자가 장소 설명을 반복 수정하면 수정할 때마다 새로운 번역이 트리거된다.
- 다수의 사용자가 동시에 같은 장소에 접근하면, 서버의 freshness 체크가 동시에 실행될 수 있다. API Route에서 먼저 DB를 체크하고, DB에 이미 최신 번역이 있으면 번역 API를 호출하지 않으므로 실질적인 중복은 최소화된다.

## OIDC 토큰 수명

Vercel OIDC 토큰의 TTL은 60분이고, Vercel은 최대 45분간 캐싱한다. `google-auth-library`가 토큰 만료를 감지하면 자동으로 새 토큰을 요청하므로 애플리케이션 레벨에서 별도의 갱신 로직은 필요 없다. 다만 콜드 스타트 시 첫 번째 요청에서 OIDC 토큰 발급 → STS 교환 → 임퍼소네이션의 전체 체인이 실행되어 약간의 지연이 발생할 수 있다.

## 로컬 개발 환경

로컬에서는 Vercel Functions 런타임이 없으므로 `getVercelOidcToken`이 동작하지 않는다. `vercel env pull` 명령으로 `.env.local`에 `VERCEL_OIDC_TOKEN`을 포함한 환경 변수를 내려받아 사용한다. 로컬 토큰은 고정되므로 만료 후에는 다시 pull해야 한다.

```bash
vercel env pull
```

# 정리

| 구성 요소 | 기술 스택 | 역할 |
|---|---|---|
| 인증 | Vercel OIDC + GCP Workload Identity Federation | 키 없는 GCP 인증 |
| 번역 | Google Cloud Translation API v3 | 텍스트 자동 번역 |
| 저장 | Supabase (zone_locales, notice_locales) | 번역 결과 캐싱 |
| 캐싱 | SHA-256 source_hash | 불필요한 번역 방지 |
| 클라이언트 | Jotai atom + useZoneLocale 훅 | 메모리 캐시 및 중복 요청 방지 |

정적 UI 텍스트(번역 JSON 파일)와 동적 사용자 콘텐츠(자동 번역)를 분리한 것이 핵심이다. 정적 텍스트는 빌드 시 번들에 포함되어 네트워크 없이 즉시 표시되고, 동적 콘텐츠는 on-demand로 번역되어 DB에 캐싱된다. 두 레이어가 합쳐져 앱 전체의 다국어 경험을 구성한다.

OIDC 기반 인증은 초기 설정이 번거롭지만, 한 번 구성하면 키 관리 부담이 사라진다. Vercel 배포 환경에서 GCP 서비스를 사용하는 다른 시나리오(Vertex AI, Cloud Storage 등)에도 동일한 패턴을 적용할 수 있다.

# Reference

- https://examples.vercel.com/docs/oidc
- https://examples.vercel.com/docs/oidc/gcp
- https://cloud.google.com/iam/docs/workload-identity-federation
- https://cloud.google.com/translate/docs/reference/rest/v3
- https://vercel.com/docs/oidc/reference

# 연결문서

- [React Native 앱의 다국어 지원 구현](/post/react-native-aebui-dagugeo-jiwon-guhyeon)
- [React Context로 통화 로컬라이제이션 구현](/post/react-contextro-tonghwa-rokeollaijeisyeon-guhyeon)
