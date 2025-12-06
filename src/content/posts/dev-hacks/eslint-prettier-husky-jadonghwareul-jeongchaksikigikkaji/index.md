---
tags:
  - Engineering
  - TechDeepDive
  - Monorepo
  - Husky
  - TypeScript
  - Automation
  - NextJS
  - React
title: ESLint·Prettier·Husky 자동화를 정착시키기까지
created: '2025-10-09 14:06'
modified: '2025-10-09 14:06'
slug: eslint-prettier-husky-jadonghwareul-jeongchaksikigikkaji
---

# Intro
저는 코드 리뷰에서 들여쓰기 이야기가 나오면 마음이 쿵 내려앉습니다. “이 줄 끝에 세미콜론이 왜 없죠?”라는 한 마디가 기능 토론 시간을 순식간에 갉아먹거든요. 그래서 `eslint.config.mjs`, `package.json`의 `lint-staged`, 그리고 `.husky` 훅을 묶어서 자동화 파이프라인을 정착시킨 과정을 기록해 봅니다.

## 핵심 아이디어 요약
- `eslint.config.mjs` 하나로 Next.js, TypeScript, Prettier 규칙을 통합했습니다.
- Husky `pre-commit` 훅에서 `pnpm pre-commit`을 실행해 변경된 파일만 Prettier와 ESLint로 고칩니다.
- `post-commit` 훅은 `scripts/update-version.js`를 돌려 버전과 빌드 넘버를 자동으로 올립니다.

## 준비와 선택
1. **Flat Config 채택**: Next.js 15가 Flat Config를 권장해서 `FlatCompat`로 기존 설정을 불러오고 있습니다.
2. **lint-staged 위치**: 설정 파일을 따로 두지 않고 `package.json`의 `lint-staged` 필드에 바로 적어 관리 부담을 줄였습니다.
3. **버전 자동화**: 버전 업데이트 스크립트를 커밋 훅과 묶어 PR마다 버전이 어긋나는 일을 막았습니다.

## 구현 여정
### Step 1: ESLint와 Prettier 정리
`eslint.config.mjs`는 `next/core-web-vitals`, `@typescript-eslint`, `plugin:prettier/recommended`를 순서대로 확장합니다. `@typescript-eslint/no-unused-vars`를 커스터마이즈해 `_`로 시작하는 매개변수는 허용하고, `react/jsx-sort-props` 같은 팀 규칙도 함께 적용했습니다. 덕분에 Prettier가 만든 포맷과 ESLint가 충돌하지 않습니다.

```ts
const eslintConfig = [
  {
    plugins: ['@typescript-eslint', 'prettier'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'prettier/prettier': 'warn',
      'react/jsx-sort-props': [
        'warn',
        { callbacksLast: true, shorthandFirst: true, ignoreCase: true },
      ],
    },
  },
];
```

### Step 2: Husky 훅 구성
`.husky/pre-commit`에는 단 한 줄, `pnpm pre-commit`만 있습니다. `package.json`에서 `pre-commit` 스크립트가 `lint-staged`를 실행하기 때문에, 변경된 파일만 `prettier --write`와 `eslint --fix`가 순서대로 적용됩니다. 브랜치가 달라도 입력 파일만 고치니 속도가 유지됩니다.

```sh
#!/usr/bin/env sh

. "$(dirname -- "$0")/_/husky.sh"

pnpm pre-commit
```

### Step 3: lint-staged 스크립트
`lint-staged` 설정은 심플합니다. `*.{js,jsx,ts,tsx}` 파일에 Prettier와 ESLint를 순서대로 돌리고, 그 외에는 손대지 않습니다. Supabase 타입 생성은 수동 명령(`pnpm db:types`)으로 분리해 훅이 느려지지 않도록 했습니다.

```jsonc
{
  "lint-staged": {
    "*.{js,jsx,ts,tsx}": [
      "prettier --write",
      "eslint --fix"
    ]
  }
}
```

### Step 4: CI와 연동
CI에서는 `pnpm lint`와 `pnpm tsc`만 돌립니다. 포맷은 pre-commit에서 이미 보장되기 때문에 중복 검사를 피했습니다. 대신 실패 로그를 Slack으로 보내 바로 확인할 수 있게 했습니다.

## 겪은 이슈와 해결 과정
- **prettier 버전 차이**: 팀원마다 Prettier 버전이 달라 포맷이 흔들렸습니다. `packageManager` 필드에 `pnpm@10.15.1`을 명시하고 `pnpm install`만 쓰도록 가이드했습니다.
- **post-commit 무한 루프**: `pnpm post-commit`이 다시 커밋을 만드는 구조라 Husky가 재귀 호출을 반복했습니다. `.husky/post-commit`에서 `HUSKY_POST_COMMIT_RUNNING` 환경변수로 재진입을 막았습니다.
- **lint 속도**: 대량 변경 시 `eslint .`가 느렸는데 `lint` 스크립트에는 캐시를 쓰지 않으니 pre-commit에서만 캐시가 적용됩니다. 아직 개선 중이지만 병렬 실행 옵션을 실험하고 있습니다.

## 결과와 회고
이제는 리뷰에서 “lint 돌렸나요?”라는 질문이 사라졌습니다. 커밋 훅이 알아서 포맷을 맞추고, post-commit이 버전까지 올려주니 사람이 개입할 일이 거의 없습니다. 다음에는 Tailwind v4 클래스 정렬을 더 강제하기 위해 Prettier 플러그인 옵션을 세분화할 생각입니다.

여러분 팀은 코드 스타일을 어떻게 자동화하고 있나요? 비슷한 실험을 해보셨다면 댓글로 경험을 나눠주세요. 서로의 설정을 비교해 보는 재미가 쏠쏠하더라고요.

# Reference
- https://eslint.org/docs/latest/use/configure/configuration-files-new
- https://prettier.io/docs/en/integrating-with-linters.html
- https://typicode.github.io/husky/

# 연결문서
- [[Husky를 활용한 HeadVer 버전 관리 - GitHub Actions에서 로컬 커밋 자동화로 이전]]
- [[나만의 SVG 아이콘 라이브러리 만들기 여정기 (3편) - GitHub Actions로 날개 달기, 자동 배포 시스템 구축!]]
- [[나만의 SVG 아이콘 라이브러리 만들기 여정기 (1편) - React 컴포넌트 변환과 컴파일 자동화]]
