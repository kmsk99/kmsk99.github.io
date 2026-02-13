---
tags:
  - HeadVer
  - Versioning
  - JavaScript
  - Troubleshooting
title: JS 프로덕트에서 HeadVer 버저닝 시스템을 적용하기
created: '2024-06-03 10:15'
modified: '2024-06-03 10:38'
---

# Intro

출근길, 링크드인을 둘러보던 도중 우연히 버저닝 시스템에 관한 글을 보게 되었다.

지금까지 프로덕트를 만들면서 사실상 1 인 개발에 가깝게 개발을 해오다보니, 버저닝은 제대로 관리되지 않는 골칫거리 중 하나였다. 그러던 중, 그 포스트는 버저닝에 관한 고민을 순식간에 없애주었다.

# 프로덕트에 적용하기

다만, 이에 관한 포스트는 방법론 자체가 간단해서 그런 것인지, 유명하지 않아서 그런 것인지, typescript 나 javascript 에 바로 적용한 글은 찾기 힘들었다.

그래서 GPT 의 도움을 받아가며 직접 만들어보았다.

- https://github.com/line/headver/blob/main/examples/typescript.md

일단 headver 자체는 별도의 라이브러리는 없고, 일종의 방법론이다. 어떻게 구성하는지에 대한 예시는 위의 깃허브에 간단히 나와있다.  

일단 시작은 가볍게 라이브러리 설치로 시작한다

```bash
// 필요 라이브러리 설치
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

/**
 * Get a `yearweek` string that complies with the HeadVer specification.
 * @param date day of target
 * @returns yearweek
 */
function getYearWeek(date) {
  return format(date, 'yyww');
}

/**
 * Get a version string that complies with the HeadVer specification.
 * @param head Zero-based number
 * @param date For generating `yearweek` string
 * @param build Incremental number from a build server
 * @param suffix Suffix string for a version string that joins with `+`.
 * @returns HeadVer string like a `3.1924.59`
 */
function getHeadVer(args) {
  const headVer = `${args.head}.${getYearWeek(args.date)}.${args.build}`;
  if (args.suffix) {
    return `${headVer}+${args.suffix}`;
  }
  return headVer;
}

/**
 * Get a next HeadVer that keeps the `major` and updates `minor` and `patch`.
 * If `currentVersion` has a suffix, it will be attached same suffix.
 * @param currentVersion A version string that is compatible with HeadVer or SemVer
 * @param date For generating `yearweek` string
 * @param build Incremental number from a build server
 * @param suffix Suffix string for a version string that joins with `+`
 * @returns HeadVer string like a `3.1924.59`
 */
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

console.log(`::set-output name=new_version::${nextVersion}`);
console.log(`Updated version to ${nextVersion}`);

```

마지막으로 버전 업데이트를 위한 package.json 파일을 작성한다

```json
//package.json
  "scripts": {
    "update-version": "node ./scripts/update-version.js",
    "build:versioned": "npm run update-version && npm run build"
  },
```

이후, npm run update-version 을 통해, 버저닝이 제대로 실행되는지 확인한다.

update-version 을 실행할 떄마다, 루트 경로에 build_number.json 파일이 생성되어 갱신되며, 동일 주차에 몇번째 update-version 인지를 기록한다. 수동으로 빌드 넘버를 올려준다고 생각하면 편하다.

그리고 이러한 스크립트는 manual 하게 사용할수도 있겠지만, 우리는 완전 자동화를 원하고있다. 완전 자동화를 위해 git action 까지 짜주겠다.

```yml
// .github/workflows/versioning.yml
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

위 git action 을 통해, 메인이나 개발 브랜치가 아닌 곳에 push 를 하면 자동적으로 빌드 넘버가 올라가게된다. 이제 우리가 할 일은 고객에게 보여지는 화면이 꽤 달라진다고 느껴졌을 때 마다 head version 을 올려주면 끝난다.

이 포스트를 통해 다른 분들이 더 손쉽게 headver 를 사용해보면 좋을것이다.

# Reference

- https://techblog.lycorp.co.jp/ko/headver-new-versioning-system-for-product-teams
- https://github.com/line/headver

# 연결문서
- [Feature-Sliced Design으로 프론트엔드 도메인 분해하기](/post/feature-sliced-designeuro-peuronteuendeu-domein-bunhaehagi)
- [SVG 아이콘을 React 컴포넌트 라이브러리로 만들어 자동 배포하기](/post/svg-aikoneul-react-keomponeonteu-raibeureoriro-mandeureo-jadong-baepohagi)
- [SVG 아이콘 라이브러리를 React Native에서도 쓸 수 있게 만들기](/post/svg-aikon-raibeureorireul-react-nativeeseodo-sseul-su-itge-mandeulgi)
- [Deep Link Friendly Redirect Validation을 구현하며 배운 보안 체크리스트](/post/deep-link-friendly-redirect-validationeul-guhyeonhamyeo-baeun-boan-chekeuriseuteu)
