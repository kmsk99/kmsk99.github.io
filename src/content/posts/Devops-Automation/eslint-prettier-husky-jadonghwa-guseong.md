---
tags:
  - ESLint
  - Prettier
  - Husky
  - CI/CD
  - NextJS
  - TypeScript
title: ESLint + Prettier + Husky 자동화 구성
created: '2025-03-11'
modified: '2025-06-20'
---

코드 리뷰에서 들여쓰기나 세미콜론 이야기가 나오면 기능 토론 시간이 순식간에 갉아먹힌다. `eslint.config.mjs`, `package.json`의 `lint-staged`, `.husky` 훅을 묶어 자동화 파이프라인을 정착시킨 과정을 정리했다.

## ESLint와 Prettier 통합

`eslint.config.mjs`는 `next/core-web-vitals`, `@typescript-eslint`, `plugin:prettier/recommended`를 순서대로 확장한다. Flat Config를 채택했는데, Next.js 15가 권장하는 방식이라 `FlatCompat`로 기존 설정을 불러왔다. `@typescript-eslint/no-unused-vars`는 `_`로 시작하는 매개변수를 허용하도록 커스터마이즈했고, `react/jsx-sort-props` 같은 팀 규칙도 함께 넣었다. Prettier 포맷과 ESLint가 충돌하지 않게 했다.

```js
const eslintConfig = tseslintConfig(
  { ignores: ['node_modules/**', '.next/**', 'out/**', 'build/**'] },
  js.configs.recommended,
  ...tseslintConfigs.recommended,
  nextPlugin.configs['core-web-vitals'],
  importPlugin.flatConfigs.recommended,
  {
    plugins: { prettier: prettierPlugin, react: reactPlugin, 'react-hooks': reactHooksPlugin },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      'prettier/prettier': 'warn',
      'react/jsx-sort-props': [
        'warn',
        { callbacksLast: true, shorthandFirst: true, ignoreCase: true, reservedFirst: true },
      ],
    },
  },
);
```

## Husky 훅 구성

`.husky/pre-commit`에는 `pnpm pre-commit` 한 줄만 넣었다. `package.json`의 `pre-commit` 스크립트가 `lint-staged`를 실행하고, 변경된 파일만 `prettier --write`와 `eslint --fix`가 순서대로 적용된다. `package.json`의 `lint-staged` 필드에 바로 적어서 별도 설정 파일 없이 관리했다.

```sh
#!/usr/bin/env sh

pnpm pre-commit
```

```jsonc
// schoolmeets/package.json
{
  "scripts": {
    "prepare": "husky",
    "pre-commit": "lint-staged",
    "post-commit": "pnpm update-version && git add package.json build_number.json && HUSKY=0 git commit --amend --no-edit"
  },
  "lint-staged": {
    "*.{js,jsx,ts,tsx}": ["prettier --write", "eslint --fix"]
  }
}
```

모노레포(iloveclub-core)에서는 패키지별로 lint-staged 경로를 나눠 적용한다.

```jsonc
// iloveclub-core/package.json
{
  "lint-staged": {
    "packages/frontend/**/*.{js,jsx,ts,tsx}": ["prettier --write", "pnpm frontend:lint:fix"],
    "packages/backend/**/*.{js,ts}": ["prettier --write", "pnpm backend:lint:fix"],
    "packages/integration-test/**/*.{js,ts}": ["prettier --write", "pnpm integration:test:lint:fix"],
    "*.{json,css,scss,md}": ["prettier --write"]
  }
}
```

버전 업데이트는 `post-commit` 훅에서 `scripts/update-version.js`를 돌려 자동으로 올렸다. PR마다 버전이 어긋나는 일을 막으려고 커밋 훅과 묶었다.

## CI 연동

CI에서는 `pnpm lint`와 `pnpm tsc`만 돌린다. 포맷은 pre-commit에서 이미 보장되니 중복 검사는 피했다. 실패 로그는 Slack으로 보내 바로 확인할 수 있게 했다.

## 겪은 이슈

- Prettier 버전 차이: 팀원마다 Prettier 버전이 달라 포맷이 흔들렸다. `packageManager`에 `pnpm@10.15.1`을 명시하고 `pnpm install`만 쓰도록 가이드했다.
- post-commit 무한 루프: `pnpm post-commit`이 다시 커밋을 만드는 구조라 Husky가 재귀 호출을 반복했다. `.husky/post-commit`에서 `HUSKY_POST_COMMIT_RUNNING` 환경변수로 재진입을 막았다.
- lint 속도: 대량 변경 시 `eslint .`가 느렸다. pre-commit에서만 캐시가 적용되고, `lint` 스크립트에는 캐시를 쓰지 않는다. 병렬 실행 옵션을 실험 중이다.

이제 리뷰에서 "lint 돌렸나요?"라는 질문은 사라졌다. 커밋 훅이 포맷을 맞추고 post-commit이 버전까지 올려주니 사람이 개입할 일이 거의 없다. 다음에는 Tailwind v4 클래스 정렬을 더 강제하기 위해 Prettier 플러그인 옵션을 세분화할 생각이다.

# Reference
- https://eslint.org/
- https://prettier.io/
- https://typicode.github.io/husky/

# 연결문서
- [HeadVer 버저닝 시스템을 JS 프로덕트에 적용하기](/post/headver-beojeoning-siseutemeul-js-peurodeokteue-jeongnyonghagi)
- [SVG 아이콘을 React 컴포넌트 라이브러리로 만들어 자동 배포하기](/post/svg-aikoneul-react-keomponeonteu-raibeureoriro-mandeureo-jadong-baepohagi)
- [SVG 아이콘 라이브러리를 React Native에서도 쓸 수 있게 만들기](/post/svg-aikon-raibeureorireul-react-nativeeseodo-sseul-su-itge-mandeulgi)
- [Astro SSG 포트폴리오 블로그 구축](/post/astro-ssg-poteupollio-beullogeu-guchuk)
