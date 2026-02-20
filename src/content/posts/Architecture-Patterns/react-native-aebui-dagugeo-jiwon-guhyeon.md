---
tags:
  - i18n
  - ReactNative
  - i18next
  - Localization
  - Expo
title: React Native 앱의 다국어 지원 구현
created: '2025-07-15 10:00'
modified: '2025-07-15 14:00'
---

# 배경

모바일 앱을 한국어 단일 언어로 출시한 뒤, 해외 사용자 유입이 생기면서 다국어 지원이 필요해졌다. 한국어를 기준 원문으로 두고 영어, 일본어, 중국어 간체/번체까지 5개 언어를 지원하도록 구현했다. React Native(Expo) 앱에서 i18next를 사용하되, 단순 번역을 넘어 서버사이드(Edge Function) 푸시 알림의 다국어 처리까지 포함한다.

# 번역 파일 구조

```
src/shared/i18n/
├── index.ts
└── locales/
    ├── ko-KR/
    │   ├── translations.json
    │   ├── terms.json
    │   ├── badge.json
    │   └── qna.json
    ├── en-US/
    ├── ja-JP/
    ├── zh-CN/
    └── zh-TW/
```

`translations.json`에 일반 UI 텍스트를 두고, `terms.json`(이용약관), `badge.json`(배지 시스템), `qna.json`(자주 묻는 질문) 등 도메인별로 분리했다. 키는 dot notation 소문자를 사용한다.

```json
{
  "auth": {
    "login": {
      "apple": "Apple로 로그인",
      "google": "Google로 로그인"
    },
    "signup": {
      "nickname": {
        "label": "닉네임",
        "taken": "이미 사용중인 닉네임이에요",
        "minLength": "닉네임을 2자 이상 작성해주세요"
      }
    }
  },
  "zone": {
    "detail": {
      "participants": "{{count}}명이 참여했어요",
      "leaveReview": "리뷰 작성"
    }
  }
}
```

`{{count}}`처럼 interpolation 변수를 사용해 동적 값을 삽입한다. 이 규칙은 5개 언어 모두 동일하다.

# i18n 초기화

```ts
import { getLocales } from 'expo-localization';
import i18n, { changeLanguage } from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LANGUAGE_STORAGE_KEY = 'puffzone.language';

const resources = {
  en: { translation: { ...translationEn, terms: termsEn, badge: badgeEn, qna: qnaEn } },
  ko: { translation: { ...translationKo, terms: termsKo, badge: badgeKo, qna: qnaKo } },
  ja: { translation: { ...translationJa, terms: termsJa, badge: badgeJa, qna: qnaJa } },
  zh: { translation: { ...translationZh, terms: termsZh, badge: badgeZh, qna: qnaZh } },
  'zh-TW': { translation: { ...translationZhTw, terms: termsZhTw, badge: badgeZhTw, qna: qnaZhTw } },
};
```

네임스페이스를 분리하지 않고 `translation` 하나에 스프레드로 병합했다. 네임스페이스를 쓰면 컴포넌트에서 `t('terms:title')` 형태로 접근해야 하는데, 실제로는 `t('terms.title')`이 더 자연스럽고 키 자동완성도 잘 동작했다.

## 언어 감지 및 폴백

```ts
const fallbackLng: Record<string, string[]> = {
  'en-*': ['en'],
  'ko-*': ['ko'],
  'ja-*': ['ja'],
  'zh-*': ['zh'],
  'zh-tw': ['zh-TW'],
  'zh-hant': ['zh-TW'],
  'zh-hant-*': ['zh-TW'],
  default: ['en'],
};
```

i18next의 `fallbackLng`은 언어 코드 패턴별 폴백 체인을 지원한다. 중국어가 까다로운데, iOS는 `zh-Hant`, Android는 `zh-TW`처럼 서로 다른 코드를 반환한다. 이를 정규화하는 함수를 만들었다.

```ts
const normalizeLanguageCode = (tag?: string | null): LanguageCode => {
  if (!tag) return 'en';
  const normalized = tag.toLowerCase();

  if (normalized.startsWith('zh')) {
    if (normalized.includes('hant') || normalized.includes('tw')
        || normalized.includes('hk') || normalized.includes('mo')) {
      return 'zh-TW';
    }
    return 'zh';
  }

  const [languageCode] = normalized.split('-');
  return (Object.keys(resources) as LanguageCode[])
    .find(code => code.toLowerCase() === languageCode) ?? 'en';
};
```

`zh-Hant-TW`, `zh-TW`, `zh-Hant`, `zh-HK`, `zh-MO` 모두 `zh-TW`(번체)로 매핑한다. 그 외 `zh-*`는 `zh`(간체)로 매핑한다.

## 언어 결정 우선순위

```ts
const getPreferredLanguage = async (): Promise<LanguageCode> => {
  const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (isSupportedLanguage(stored)) return stored;

  const [deviceLocale] = getLocales();
  return normalizeLanguageCode(deviceLocale?.languageTag ?? deviceLocale?.languageCode);
};
```

1순위는 사용자가 앱 내 설정에서 직접 선택한 언어(AsyncStorage), 2순위는 기기 시스템 언어다. `expo-localization`의 `getLocales()`로 기기 언어를 가져온다.

## 앱 부팅 시 초기화

```ts
export function useI18nInit() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    initI18n()
      .catch(error => {
        trackAppException({ code: 'i18n_init_failed', error, screen: 'app_init' });
      })
      .finally(() => setIsReady(true));
  }, []);

  return { isReady };
}
```

`initI18n`은 i18next 초기화 → 저장된 언어 또는 기기 언어 감지 → `changeLanguage` 호출까지 비동기로 처리한다. 초기화 실패 시에도 `isReady`를 `true`로 설정해 앱이 블로킹되지 않도록 했다. 영어 폴백으로 동작한다.

# 서버사이드 다국어: 푸시 알림

푸시 알림은 서버(Edge Function)에서 생성되므로 클라이언트의 i18next를 사용할 수 없다. 별도의 번역 맵과 경량 `t()` 함수를 직접 구현했다.

```ts
const TRANSLATIONS: Record<string, Record<string, string>> = {
  ko: {
    'menu.notification.notice.title': '공지사항',
    'menu.notification.suggestionApproved.title': '장소 수정 승인',
    'menu.notification.suggestionApproved.content': '{{placeName}} 장소 수정 제안이 승인되었어요',
  },
  en: {
    'menu.notification.notice.title': 'Notice',
    'menu.notification.suggestionApproved.title': 'Edit Approved',
    'menu.notification.suggestionApproved.content': 'Your edit suggestion for {{placeName}} has been approved',
  },
  ja: { /* ... */ },
  zh: { /* ... */ },
  'zh-TW': { /* ... */ },
};
```

interpolation도 직접 구현한다.

```ts
const interpolate = (template: string, params?: Record<string, string>): string => {
  if (!params) return template;
  return template.replace(/{{\s*([^}\s]+)\s*}}/g, (_, key) => params[key] ?? '');
};

const t = (locale: string, key: string, params?: Record<string, string>): string => {
  const translations = TRANSLATIONS[locale] ?? TRANSLATIONS.ko;
  const template = translations[key] ?? TRANSLATIONS.ko[key] ?? key;
  return interpolate(template, params);
};
```

사용자의 국가 코드에서 언어를 결정한다. DB에 저장된 `country_code`를 사용하므로 기기 언어 API에 접근할 필요가 없다.

```ts
const resolveLanguageFromCountry = (countryCode?: string | null): string => {
  switch (countryCode?.toUpperCase()) {
    case 'KR': return 'ko';
    case 'US': return 'en';
    case 'JP': return 'ja';
    case 'CN': return 'zh';
    case 'TW': case 'HK': case 'MO': return 'zh-TW';
    default: return 'ko';
  }
};
```

DB의 알림 `content` 필드에는 i18n 키와 파라미터가 JSON으로 저장된다.

```json
{"key": "menu.notification.suggestionApproved.content", "params": {"placeName": "강남역 2번 출구"}}
```

푸시 발송 시 각 사용자의 locale에 맞게 번역한다.

```ts
const locale = resolveLanguageFromCountry(user.countryCode);
const title = t(locale, titleKey);
const body = t(locale, parsed.key, parsed.params);
```

# 번역 키 검증 자동화

앱 규모가 커지면 사용하지 않는 번역 키가 쌓이거나, 코드에서 참조하는 키가 JSON에 없는 경우가 생긴다. 이를 자동으로 검증하는 스크립트를 만들었다.

```bash
node scripts/verify-i18n.js          # 전체 검증
node scripts/verify-i18n.js --fix    # 미사용 키 자동 삭제
node scripts/verify-i18n.js --locale=ko-KR  # 특정 로케일만 검증
```

스크립트는 `src/` 폴더의 모든 `.ts`, `.tsx` 파일을 순회하며 `t('key')`, `t("key")`, `i18nKey="key"` 패턴으로 사용된 키를 추출한다. 동적 키(`t(\`zone.type.${type}\`)`)는 `.i18nrc.json`에 와일드카드 패턴으로 등록해 오탐을 방지한다.

```json
{
  "dynamicPatterns": [
    "badge.families.*.displayName",
    "badge.families.*.tiers.*.*",
    "zone.type.*",
    "zone.status.*"
  ]
}
```

# Next.js 관리자 페이지의 다국어

관리자 페이지(Next.js)에서는 i18next 런타임 대신 파일 시스템에서 JSON을 직접 읽어 props로 전달하는 방식을 사용했다.

```tsx
// src/app/[locale]/page.tsx
const localeMap: Record<string, string> = {
  ko: 'ko-KR', en: 'en-US', ja: 'ja-JP',
  'zh-cn': 'zh-CN', 'zh-tw': 'zh-TW',
};

export default async function LocalizedHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!LOCALES.includes(locale.toLowerCase())) return notFound();

  const resolvedLocale = localeMap[locale.toLowerCase()] || 'ko-KR';
  const localePath = path.join(process.cwd(), 'src/shared/i18n/locales', resolvedLocale, 'translations.json');
  const file = await fs.readFile(localePath, 'utf8');
  const translations = JSON.parse(file);

  return <HomeView homeData={translations.home} />;
}
```

URL 경로(`/ko/`, `/en/`, `/zh-cn/`)를 locale로 사용하고, `generateStaticParams`로 빌드 시 모든 locale 페이지를 사전 생성한다. 컴포넌트에서는 `useTranslation` 훅 없이 props로 받은 번역 데이터를 직접 사용한다. 서버 컴포넌트에서 i18next를 초기화하는 복잡함을 피하면서도 동일한 JSON 파일을 공유할 수 있다.

# 번역 워크플로우

번역 추가 시 워크플로우:

1. 한국어 원문을 `ko-KR/translations.json`에 추가
2. 키 네이밍 규칙에 따라 dot notation 키 생성 (예: `auth.login.google`)
3. AI 번역 엔진에 한국어 원문과 키를 입력하면 5개 언어 JSON을 생성
4. 각 locale 폴더에 병합
5. `verify-i18n.js`로 키 누락/미사용 검증
6. PR 리뷰

AI 번역 시 한국어 원문은 절대 수정하지 않는 것을 규칙으로 정했다. interpolation 변수(`{{count}}`, `{{name}}`)와 줄바꿈도 그대로 유지한다.

# Reference

- https://www.i18next.com/
- https://react.i18next.com/
- https://docs.expo.dev/versions/latest/sdk/localization/

# 연결문서

- [React Context로 통화 로컬라이제이션 구현](/post/react-contextro-tonghwa-rokeollaijeisyeon-guhyeon)
- [Firebase에서 Supabase로 기술 스택 전환](/post/firebaseeseo-supabasero-gisul-seutaek-jeonhwan)
- 위치정보법 준수를 위한 감사 로깅 아키텍처
