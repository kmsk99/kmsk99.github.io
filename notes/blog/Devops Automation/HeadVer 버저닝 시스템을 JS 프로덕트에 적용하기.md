---
tags:
  - HeadVer
  - Versioning
  - JavaScript
  - DevOps
  - Husky
  - GitHooks
  - Automation
title: HeadVer 버저닝 시스템을 JS 프로덕트에 적용하기
created: 2024-06-03 10:15
modified: 2025-06-21 03:28
---

# Intro

출근길, 링크드인을 둘러보던 도중 우연히 버저닝 시스템에 관한 글을 보게 되었다.

지금까지 프로덕트를 만들면서 사실상 1 인 개발에 가깝게 개발을 해오다보니, 버저닝은 제대로 관리되지 않는 골칫거리 중 하나였다. 그러던 중, 그 포스트는 버저닝에 관한 고민을 순식간에 없애주었다.

# HeadVer 란

LINE 에서 개발한 HeadVer 는 다음과 같은 구조를 가진다:

```
<head>.<yearweek>.<build>
```

```
     3    .    2324    .    59
     │          │           │
     │          │           └─ 빌드 번호
     │          │
     │          └─ 2023년 24주차
     │
     └─ 주요 변경 3회
```

- `head`: 고객에게 보여지는 화면이 꽤 달라졌다고 느껴질 때 올리는 숫자
- `yearweek`: 릴리스 년도와 주차 (예: 2324 는 2023 년 24 주차)
- `build`: 해당 주차 내 빌드 번호

SemVer 와 비교하면, 버전 번호만으로 릴리스 시기를 알 수 있고, head 만 신경쓰면 되니까 버저닝 고민이 확 줄어든다.

![[ebabd4f913d9091be1eb90a9800c531d_MD5.png]]

프로덕트에 적용된 실제 모습

# 프로덕트에 적용하기

이에 관한 포스트는 방법론 자체가 간단해서 그런 것인지, 유명하지 않아서 그런 것인지, typescript 나 javascript 에 바로 적용한 글은 찾기 힘들었다.

그래서 GPT 의 도움을 받아가며 직접 만들어보았다.

- https://github.com/line/headver/blob/main/examples/typescript.md

일단 headver 자체는 별도의 라이브러리는 없고, 일종의 방법론이다. 어떻게 구성하는지에 대한 예시는 위의 깃허브에 간단히 나와있다.  

일단 시작은 가볍게 라이브러리 설치로 시작한다

```bash
npm i date-fns semver
```

이후, 버전 업데이트를 위한 코드를 작성한다.
본인은 tsconfig 설정의 충돌이 자꾸만 일어나서, js 로 구성해주었다.

```javascript
// scripts/update-version.js
/* eslint-disable @typescript-eslint/no-var-requires */

const { format } = require('date-fns');
const fs = require('fs');
const path = require('path');
const semver = require('semver');

function getYearWeek(date) {
  return format(date, 'yyww');
}

function getHeadVer(args) {
  const headVer = `${args.head}.${getYearWeek(args.date)}.${args.build}`;
  if (args.suffix) {
    return `${headVer}+${args.suffix}`;
  }
  return headVer;
}

function getNextVersion(args) {
  const current = semver.parse(args.currentVersion);
  let newSuffix;
  if (args.suffix || args.suffix === '') {
    newSuffix = args.suffix;
  } else {
    newSuffix = current.build.join('');
  }
  return getHeadVer({
    head: current.major || 0,
    date: args.date,
    build: args.build,
    suffix: newSuffix,
  });
}

const packageJsonPath = path.resolve(__dirname, '../package.json');
const buildNumberPath = path.resolve(__dirname, '../build_number.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const currentVersion = packageJson.version;
const date = new Date();
const yearWeek = getYearWeek(date);

let buildNumberData = {};
if (fs.existsSync(buildNumberPath)) {
  buildNumberData = JSON.parse(fs.readFileSync(buildNumberPath, 'utf8'));
}

const build = buildNumberData[yearWeek] ? buildNumberData[yearWeek] + 1 : 1;
buildNumberData[yearWeek] = build;

fs.writeFileSync(buildNumberPath, JSON.stringify(buildNumberData, null, 2));

const nextVersion = getNextVersion({
  currentVersion,
  date: date,
  build: build,
});

packageJson.version = nextVersion;

fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

console.log(`Updated version to ${nextVersion}`);
```

마지막으로 버전 업데이트를 위한 package.json 스크립트를 작성한다

```json
"scripts": {
  "update-version": "node ./scripts/update-version.js",
  "build:versioned": "npm run update-version && npm run build"
}
```

npm run update-version 을 실행할 때마다, 루트 경로에 build_number.json 파일이 생성되어 갱신되며, 동일 주차에 몇번째 update-version 인지를 기록한다. 수동으로 빌드 넘버를 올려준다고 생각하면 편하다.

# GitHub Actions 로 자동화하기

이러한 스크립트는 manual 하게 사용할수도 있겠지만, 완전 자동화를 원하고있다. 완전 자동화를 위해 git action 까지 짜주었다.

```yml
name: Versioning CI

on:
  push:
    branches-ignore:
      - main
      - develop

permissions:
  contents: write

jobs:
  versioning:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Use Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Update version
        id: update_version
        run: npm run update-version

      - name: Commit updated version
        run: |
          git config --global user.name 'github-actions[bot]'
          git config --global user.email 'github-actions[bot]@users.noreply.github.com'
          git add package.json build_number.json
          git commit -m "ci: update version to ${{ steps.update_version.outputs.new_version }}"
          git push
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

위 git action 을 통해, 메인이나 개발 브랜치가 아닌 곳에 push 를 하면 자동적으로 빌드 넘버가 올라가게된다. 이제 우리가 할 일은 고객에게 보여지는 화면이 꽤 달라진다고 느껴졌을 때 마다 head version 을 올려주면 끝이다.

# Husky 로 로컬 커밋 자동화로 이전

GitHub Actions 로 잘 쓰고 있었지만, 몇 가지 아쉬운 점이 있었다:

- 버전 업데이트 결과를 확인하려면 일단 원격 저장소에 푸시를 해야 했다
- 간단한 버전 업데이트를 위해서도 매번 CI 파이프라인이 돌아야 했다
- 커밋 시점과 실제 버전이 업데이트되는 시점 사이에 간극이 있었다

그래서 Husky 의 post-commit 훅으로 이전했다. 커밋하는 순간 로컬에서 바로 버전이 찍히도록 만든 것이다.

```json
{
  "scripts": {
    "update-version": "node ./scripts/update-version.js",
    "prepare": "husky",
    "pre-commit": "lint-staged",
    "post-commit": "pnpm update-version && git add package.json build_number.json && HUSKY=0 git commit --amend --no-edit"
  },
  "lint-staged": {
    "*.{js,jsx,ts,tsx}": [
      "prettier --write",
      "eslint --fix"
    ]
  }
}
```

핵심은 post-commit 스크립트다:

1. `pnpm update-version`: HeadVer 버전 업데이트 스크립트 실행
2. `git add package.json build_number.json`: 변경된 파일 스테이징
3. `HUSKY=0 git commit --amend --no-edit`: 현재 커밋에 버전 정보를 덮어씌움

여기서 `HUSKY=0` 이 핵심이다. 이게 없으면 `git commit --amend` 가 다시 post-commit 훅을 트리거해서 무한 루프에 빠진다. 처음 설정할 때 이 문제 때문에 한참 헤맸다.

`.husky/post-commit` 쉘 스크립트에서도 재귀 방지를 추가해두었다:

```sh
#!/usr/bin/env sh

if [ "$HUSKY_POST_COMMIT_RUNNING" = "1" ]; then
  exit 0
fi

export HUSKY_POST_COMMIT_RUNNING=1
pnpm post-commit
export HUSKY_POST_COMMIT_RUNNING=0
```

이제 코드를 작성하고 `git commit` 을 하는 순간 로컬에서 바로 버전이 업데이트된다. CI 리소스도 아끼고, 커밋과 버전 업데이트 사이의 간극도 사라졌다.

## 풀스택에서의 HeadVer 활용

백엔드와 프론트엔드의 head 버전을 동기화하여 호환성을 관리하는 데도 유용하다. DB 스키마가 크게 바뀌거나, API 구조가 대규모로 변경될 때 양쪽의 head 를 동시에 올리면, 버전 번호만 보고도 두 컴포넌트가 호환되는지 바로 알 수 있다.

# Reference

- https://techblog.lycorp.co.jp/ko/headver-new-versioning-system-for-product-teams
- https://github.com/line/headver
- https://typicode.github.io/husky/
- https://github.com/okonet/lint-staged

# 연결문서
- [[ESLint + Prettier + Husky 자동화 구성]]
- [[Astro SSG 포트폴리오 블로그 구축]]
- [[옵시디언 마크다운을 Astro 블로그로 변환하기]]
- [[Feature-Sliced Design으로 프론트엔드 도메인 분해하기]]
- [[SVG 아이콘을 React 컴포넌트 라이브러리로 만들어 자동 배포하기]]
- [[SVG 아이콘 라이브러리를 React Native에서도 쓸 수 있게 만들기]]
