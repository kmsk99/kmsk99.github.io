---
tags:
  - Engineering
  - TechDeepDive
  - Automation
  - GitHubActions
  - DevOps
  - Tooling
created: '2024-09-09 11:01'
modified: '2024-09-09 11:19'
title: '버전 관리의 신세계, HeadVer 도입기 - JavaScript 개발자를 위한 완벽 가이드'
slug: >-
  버전-관리의-신세계-headver-도입기-javascript-개발자를-위한-완벽-가이드
---

## 버저닝의 고민과 HeadVer 의 등장

소프트웨어 개발에서 버전 관리는 항상 골치 아픈 문제였습니다. 특히 지속적 배포 (CD) 환경에서는 더욱 그렇죠. 기존의 Semantic Versioning(SemVer) 은 많은 개발자들이 사용하고 있지만, 제품의 실제 개발 주기와 맞지 않는 경우가 많았습니다.

예를 들어, 다음과 같은 상황을 생각해봅시다:
- 매주 새로운 기능을 출시하는 제품
- 주요 변경사항이 있을 때마다 메이저 버전을 올리면 너무 빨리 증가함
- 마이너 버전으로만 관리하면 중요한 변경사항을 파악하기 어려움

이러한 문제를 해결하기 위해 LINE 에서 개발한 것이 바로 HeadVer 입니다.

![](./ebabd4f913d9091be1eb90a9800c531d_MD5.png)

프로덕트에 적용된 실제 모습

## HeadVer 소개

HeadVer 는 다음과 같은 구조를 가집니다:

```
<head>.<yearweek>.<build>
```

각 부분의 의미는 다음과 같습니다:
- `head`: 주요 변경사항을 나타내는 숫자
- `yearweek`: 릴리스 년도와 주차 (예: 2324 는 2023 년 24 주차)
- `build`: 빌드 번호

이를 시각화하면 다음과 같습니다:

```
     3    .    2324    .    59
     │          │           │
     │          │           └─ 빌드 번호
     │          │
     │          └─ 2023년 24주차
     │
     └─ 주요 변경 3회
```

### HeadVer vs SemVer

HeadVer 와 SemVer 를 비교해보면 다음과 같은 차이점이 있습니다:

| 특징 | HeadVer | SemVer |
|------|---------|--------|
| 버전 구조 | `<head>.<yearweek>.<build>` | `<major>.<minor>.<patch>` |
| 시간 정보 | 포함 (yearweek) | 미포함 |
| 주요 변경 표시 | head 숫자로 명확히 표시 | major 버전 증가로 표시 |
| 빌드 정보 | 포함 | 선택적 포함 |

HeadVer 의 장점은 버전 번호만으로도 제품의 발전 과정과 릴리스 시기를 직관적으로 파악할 수 있다는 것입니다.

## 프로젝트에 HeadVer 적용하기: 상세 설명

HeadVer 를 JavaScript 프로젝트에 적용하는 과정을 더 자세히 살펴보겠습니다. 각 함수의 동작 원리와 코드의 세부 사항을 설명하겠습니다.

### 1. 필요한 라이브러리 설치

먼저, 필요한 라이브러리를 설치합니다:

```bash
npm i date-fns semver
```

- `date-fns`: 날짜 처리를 위한 라이브러리
- `semver`: 시맨틱 버저닝 파싱 및 비교를 위한 라이브러리

### 2. 버전 업데이트 스크립트 작성

`scripts/update-version.js` 파일을 생성하고 다음과 같이 작성합니다:

```javascript
const { format } = require('date-fns');
const fs = require('fs');
const path = require('path');
const semver = require('semver');

// 연도와 주차 계산 함수
function getYearWeek(date) {
  return format(date, 'yyww');
}
```

`getYearWeek` 함수는 주어진 날짜를 'yyww' 형식 (년도의 마지막 두 자리와 주차) 으로 변환합니다. 예를 들어, 2023 년 9 월 10 일은 '2336' 으로 변환됩니다.

```javascript
// HeadVer 문자열 생성 함수
function getHeadVer(args) {
  const headVer = `${args.head}.${getYearWeek(args.date)}.${args.build}`;
  return args.suffix ? `${headVer}+${args.suffix}` : headVer;
}
```

`getHeadVer` 함수는 HeadVer 형식의 버전 문자열을 생성합니다. `head`, `date`, `build`, 그리고 선택적으로 `suffix` 를 인자로 받아 "head.yearweek.build+suffix" 형식의 문자열을 반환합니다.

```javascript
// 다음 버전 계산 함수
function getNextVersion(args) {
  const current = semver.parse(args.currentVersion);
  const newSuffix = args.suffix !== undefined ? args.suffix : current.build.join('');
  return getHeadVer({
    head: current.major || 0,
    date: args.date,
    build: args.build,
    suffix: newSuffix,
  });
}
```

`getNextVersion` 함수는 현재 버전을 파싱하고, 새로운 HeadVer 버전을 생성합니다. 현재 버전의 major 숫자를 head 로 사용하고, 새로운 날짜와 빌드 번호를 적용합니다.

```javascript
// 메인 로직
const packageJsonPath = path.resolve(__dirname, '../package.json');
const buildNumberPath = path.resolve(__dirname, '../build_number.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const currentVersion = packageJson.version;
const date = new Date();
const yearWeek = getYearWeek(date);
```

메인 로직에서는 먼저 필요한 파일 경로를 설정하고, `package.json` 에서 현재 버전을 읽어옵니다. 그리고 현재 날짜와 주차를 계산합니다.

```javascript
let buildNumberData = {};
if (fs.existsSync(buildNumberPath)) {
  buildNumberData = JSON.parse(fs.readFileSync(buildNumberPath, 'utf8'));
}

const build = buildNumberData[yearWeek] ? buildNumberData[yearWeek] + 1 : 1;
buildNumberData[yearWeek] = build;

fs.writeFileSync(buildNumberPath, JSON.stringify(buildNumberData, null, 2));
```

이 부분에서는 `build_number.json` 파일을 읽어 현재 주차의 빌드 번호를 관리합니다. 파일이 없으면 새로 생성하고, 있으면 해당 주차의 빌드 번호를 1 증가시킵니다.

```javascript
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

마지막으로, 새 버전을 계산하고 `package.json` 파일을 업데이트합니다. 그리고 새 버전 정보를 콘솔에 출력합니다.

### 3. package.json 스크립트 추가

`package.json` 파일에 다음 스크립트를 추가합니다:

```json
"scripts": {
  "update-version": "node ./scripts/update-version.js",
  "build:versioned": "npm run update-version && npm run build"
}
```

- `update-version`: 버전 업데이트 스크립트를 실행합니다.
- `build:versioned`: 버전을 업데이트한 후 빌드를 실행합니다.

### 4. 버전 업데이트 프로세스 설명

버전 업데이트 프로세스는 다음과 같이 진행됩니다:

1. 스크립트 실행 시, 현재 날짜를 기반으로 연도와 주차를 계산합니다.
2. `build_number.json` 파일에서 현재 주차의 빌드 번호를 읽어옵니다.
3. 빌드 번호를 1 증가시키고 파일에 저장합니다.
4. `package.json` 에서 현재 버전을 읽어옵니다.
5. 새로운 HeadVer 버전을 생성합니다:
   - `head`: 현재 버전의 major 숫자를 유지합니다.
   - `yearweek`: 현재 날짜를 기반으로 계산합니다.
   - `build`: 증가된 빌드 번호를 사용합니다.
6. 새 버전을 `package.json` 에 저장합니다.

이 프로세스를 통해, 매 빌드마다 자동으로 버전이 업데이트되며, 주차가 변경될 때마다 빌드 번호가 리셋됩니다.

### 5. 실제 사용 예시

예를 들어, 현재 버전이 `1.2336.5` 이고 2023 년 37 주차에 새로운 빌드를 한다면:

1. `yearweek` 가 2337 로 변경됩니다.
2. `build` 번호가 1 로 리셋됩니다.
3. 결과적으로 새 버전은 `1.2337.1` 이 됩니다.

만약 같은 주 내에 또 다른 빌드를 한다면:

1. `yearweek` 는 그대로 2337 입니다.
2. `build` 번호가 2 로 증가합니다.
3. 새 버전은 `1.2337.2` 가 됩니다.

이러한 방식으로, HeadVer 는 제품의 주요 변경사항 (`head`), 릴리스 시기 (`yearweek`), 그리고 빌드 횟수 (`build`) 를 직관적으로 표현할 수 있습니다.

(이후 내용 유지…)

## GitHub Actions 를 이용한 자동화

버전 관리를 완전히 자동화하기 위해 GitHub Actions 를 활용해보겠습니다.

`.github/workflows/versioning.yml` 파일을 생성하고 다음 내용을 추가합니다:

```yaml
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

이 워크플로우는 `main` 과 `develop` 브랜치를 제외한 모든 브랜치에 push 가 발생할 때마다 자동으로 버전을 업데이트합니다.

## HeadVer 적용 후 실제 사용 사례

HeadVer 를 적용한 후, 버전 변화의 실제 예시를 살펴보겠습니다:

1. 초기 버전: `0.2336.1` (2023 년 36 주차 첫 빌드)
2. 같은 주 두 번째 빌드: `0.2336.2`
3. 다음 주 첫 빌드: `0.2337.1`
4. 주요 변경사항 적용 후: `1.2337.2`
5. 연말 마지막 빌드: `1.2352.5`
6. 새해 첫 빌드: `1.2401.1`

이러한 버전 변화를 통해 제품의 발전 과정과 릴리스 주기를 쉽게 파악할 수 있습니다.

### 풀스택 개발에서의 HeadVer 활용

HeadVer 의 유연성은 풀스택 개발 환경에서 더욱 빛을 발합니다. 특히 백엔드와 프론트엔드의 버전을 동기화하여 호환성을 관리하는 데 매우 유용합니다.

### 백엔드와 프론트엔드 버전 동기화

우리 팀에서는 다음과 같은 상황에서 백엔드와 프론트엔드의 `head` 버전을 동시에 올립니다:

1. 데이터베이스 스키마가 크게 변경될 때
2. API 구조가 대규모로 변경될 때
3. 프론트엔드와 백엔드 간의 데이터 교환 방식이 변경될 때

이렇게 함으로써 얻는 이점은 다음과 같습니다:

- 동일한 `head` 버전을 가진 백엔드와 프론트엔드는 완전한 호환성을 보장합니다.
- 서로 다른 `head` 버전 간에는 호환성 문제가 있을 수 있음을 명확히 표시할 수 있습니다.
- 버전 번호만으로도 백엔드와 프론트엔드의 major 변경 사항을 쉽게 파악할 수 있습니다.

### 실제 사용 예시

예를 들어, 현재 백엔드와 프론트엔드의 버전이 각각 `2.2345.10` 과 `2.2345.15` 라고 가정해봅시다.

1. API 구조를 대폭 변경하는 작업을 수행합니다.
2. 변경 작업이 완료되면 백엔드와 프론트엔드의 `head` 버전을 모두 3 으로 올립니다.
3. 결과적으로 새 버전은 다음과 같이 됩니다:
	
	- 백엔드: `3.2345.11`
	- 프론트엔드: `3.2345.16`

이렇게 하면 버전 번호만 보고도 두 컴포넌트가 호환되는지 즉시 알 수 있습니다.

### 호환성 관리

- `head` 버전이 같은 경우: 완전한 호환성을 기대할 수 있습니다.
- `head` 버전이 다른 경우: 호환성 문제가 있을 수 있으므로 주의가 필요합니다.

이 방식을 통해 마이크로서비스 아키텍처나 분산 시스템에서도 각 컴포넌트 간의 호환성을 효과적으로 관리할 수 있습니다.

## 결론

HeadVer 버저닝 시스템을 적용함으로써 얻은 이점은 다음과 같습니다:

1. 버전 번호만으로 제품의 발전 과정을 직관적으로 파악 가능
2. 릴리스 시기를 명확히 알 수 있어 팀 간 커뮤니케이션 개선
3. 지속적 배포 환경에 적합한 버저닝 시스템 구축
4. 버전 관리에 대한 고민 감소로 개발 효율성 향상
5. 풀스택 개발 환경에서 백엔드와 프론트엔드의 호환성 관리 용이

HeadVer 도입 후, 우리 팀은 제품의 변경사항과 릴리스 주기를 더욱 명확하게 이해하게 되었고, 이는 제품 관리와 고객 지원 측면에서도 큰 도움이 되었습니다. 특히 풀스택 개발 환경에서 프론트엔드와 백엔드 간의 일관성을 유지하는 데 큰 도움이 되었습니다.여러분도 프로젝트에 HeadVer 를 적용해보는 것은 어떨까요? 버전 관리의 새로운 패러다임을 경험해보실 수 있을 것입니다. 특히 복잡한 시스템 구조를 가진 프로젝트에서 HeadVer 의 장점이 더욱 빛을 발할 것입니다.

## 참고 자료

- [HeadVer: 제품 팀을 위한 새로운 버저닝 시스템](https://techblog.lycorp.co.jp/ko/headver-new-versioning-system-for-product-teams)
- [HeadVer GitHub Repository](https://github.com/line/headver)

# Reference

# 연결문서
- [[EC2 초기 세팅 스크립트를 만들며 자동화에 집착한 이유]]
- [[Husky를 활용한 HeadVer 버전 관리 - GitHub Actions에서 로컬 커밋 자동화로 이전]]
- [[나만의 SVG 아이콘 라이브러리 만들기 여정기 (3편) - GitHub Actions로 날개 달기, 자동 배포 시스템 구축!]]
