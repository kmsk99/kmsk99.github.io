---
tags:
  - Husky
  - HeadVer
  - GitHooks
  - Versioning
  - Automation
  - Monorepo
created: '2025-06-21 03:27'
modified: '2025-06-21 03:28'
title: Husky를 활용한 HeadVer 버전 관리 - GitHub Actions에서 로컬 커밋 자동화로 이전
---
안녕하세요, 여러분! 개발자에게 버전 관리는 애증의 존재죠. 특히 여러 명이 함께 빠르게 제품을 만들어가는 환경에서는 일관되고 효율적인 버전 관리 시스템이 정말 중요하다고 생각합니다.

저희 팀도 제품의 성장 과정을 한눈에 파악하고, 릴리스 시점을 명확히 하고자 [LINE에서 개발한 HeadVer](https://techblog.lycorp.co.jp/ko/headver-new-versioning-system-for-product-teams) 를 도입해서 잘 사용하고 있었는데요. 이전에는 GitHub Actions 를 통해 푸시할 때마다 버전을 자동으로 업데이트하도록 구성했었습니다. 나름 만족스럽게 사용했지만, 마음 한구석에는 이런 생각이 떠나질 않았어요. " 푸시하기 전에, 바로 내 로컬에서 커밋할 때 자동으로 버전이 딱! 하고 찍히면 얼마나 좋을까?" 하고 말이죠.

CI/CD 파이프라인에서 버전 관리를 하는 것도 좋지만, 가끔은 푸시 후에야 버전 업데이트가 반영되거나, 아주 작은 수정인데도 원격 저장소의 액션을 트리거하는 게 부담스러울 때가 있었거든요. 그래서 고민 끝에, **Git Hooks 를 좀 더 적극적으로 활용해서 로컬 개발 경험을 개선해보자!** 라는 결론에 도달했고, 그 해결책으로 `Husky` 를 만나게 되었습니다.

오늘은 기존 HeadVer 시스템에 Husky 를 접목시켜 로컬 환경에서의 버전 관리 자동화를 한층 더 끌어올린 저희 팀의 경험을 공유해 드리려고 합니다. GitHub Actions 에 의존했던 방식에서 벗어나, 어떻게 더 스마트하게 버전 관리를 하게 되었는지 지금부터 함께 살펴보시죠!

### 왜 GitHub Actions 에서 Husky 로 눈을 돌렸을까요?

기존 GitHub Actions 기반의 자동 버전 관리는 분명 편리한 점이 많았습니다. 특정 브랜치에 코드가 푸시되면 알아서 버전을 업데이트하고 커밋까지 해주니까요. 하지만 몇 가지 아쉬운 점들이 있었어요.

*   **느린 피드백:** 버전 업데이트 결과를 확인하려면 일단 원격 저장소에 푸시를 해야 했습니다. 로컬에서 바로 확인이 안 되니 답답할 때가 있었죠.
*   **CI 리소스 소모:** 간단한 버전 업데이트를 위해서도 매번 CI 파이프라인이 돌아야 했습니다. 작지만 계속 쌓이면 무시 못 할 비용이죠.
*   **커밋과 버전 업데이트의 분리:** 개발자가 코드를 커밋하는 시점과 실제 버전이 업데이트되는 시점 사이에 간극이 있었습니다.

이런 고민들을 해결해 줄 수 있는 도구가 바로 Husky 였습니다. Husky 는 Git Hook 을 정말 쉽게 사용할 수 있게 도와주는 라이브러리인데요. 이를 통해 `pre-commit` (커밋 전), `post-commit` (커밋 후) 등 다양한 시점에 우리가 원하는 스크립트를 실행시킬 수 있게 됩니다. 즉, **개발자의 로컬 환경에서, 커밋하는 바로 그 순간에!** 버전 업데이트를 포함한 여러 자동화 작업을 수행할 수 있다는 거죠. 이건 정말 매력적이었습니다.

### Husky, 너로 정했다! - 설정 과정과 핵심 코드 파헤치기

그럼 저희가 어떻게 Husky 를 설정하고 HeadVer 버전 업데이트 로직을 통합했는지 자세히 보여드릴게요. 핵심은 `package.json` 스크립트와 `.husky/` 디렉토리 밑의 훅 스크립트입니다.

먼저 `package.json` 의 `scripts` 부분을 보시죠.

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

몇 가지 중요한 스크립트들이 보이네요.

*   `"prepare": "husky"`: 이 스크립트 덕분에 `pnpm install` (또는 `npm install`, `yarn install`) 을 실행할 때마다 Husky 가 자동으로 설치되고 Git Hook 이 설정됩니다. 팀원 누구나 프로젝트를 받아서 의존성을 설치하기만 하면 바로 Husky 의 마법을 경험할 수 있게 되는 거죠. 정말 편리하지 않나요?
*   `"pre-commit": "lint-staged"`: 커밋하기 *전에* 실행되는 스크립트입니다. 저희는 `lint-staged` 를 사용해서 스테이징된 파일 중 `.js`, `.jsx`, `.ts`, `.tsx` 확장자를 가진 파일들에 대해 자동으로 `prettier` 포맷팅과 `eslint` 검사 및 수정을 수행하도록 했습니다. 이렇게 하면 팀 전체의 코드 스타일을 일관되게 유지하고, 커밋 전에 잠재적인 오류를 미리 잡을 수 있어서 정말 유용합니다.
*   `"post-commit": "pnpm update-version && git add package.json build_number.json && HUSKY=0 git commit --amend --no-edit"`: 자, 이 부분이 바로 오늘의 하이라이트입니다! 커밋이 완료된 *후에* 실행되는 훅인데요, 단계별로 살펴볼까요?
	1.  `pnpm update-version`: 기존에 사용하던 HeadVer 버전 업데이트 스크립트 (`scripts/update-version.js`) 를 실행합니다. 이 스크립트는 `package.json` 의 버전과 `build_number.json` 파일을 HeadVer 규칙에 맞게 업데이트해주죠.
	2.  `git add package.json build_number.json`: 버전 업데이트로 인해 변경된 `package.json` 과 `build_number.json` 파일을 스테이징합니다.
	3.  `HUSKY=0 git commit --amend --no-edit`: 이 부분이 정말 중요합니다! 현재 커밋에 방금 스테이징한 버전 정보 변경 사항을 **덮어씌웁니다.**
		*   `--amend`: 새로운 커밋을 만드는 대신, 방금 한 커밋을 수정합니다. 버전 정보만 업데이트하는 것이니, 별도의 커밋 메시지를 남길 필요 없이 원래 커밋에 자연스럽게 포함시키는 거죠.
		*   `--no-edit`: 커밋 메시지를 수정하지 않고 기존 메시지를 그대로 사용합니다.
		*   `HUSKY=0`: **이 환경 변수가 핵심입니다!** 이게 없다면 `git commit --amend` 명령이 다시 `post-commit` 훅을 트리거해서 스크립트가 무한 반복 실행되는 끔찍한 상황이 발생할 수 있습니다. 저도 처음 설정할 때 이 문제 때문에 한참 헤맸던 기억이 나네요. (커피 몇 잔은 마셨을 겁니다 ☕️) 이 옵션을 통해 Husky 훅이 다시 실행되는 것을 막아줍니다.

다음은 `.husky/` 디렉토리 밑에 있는 훅 스크립트들입니다.

`.husky/pre-commit`:
```sh
#!/usr/bin/env sh
pnpm pre-commit # package.json의 pre-commit 스크립트 실행
```
이 녀석은 간단하게 `package.json` 에 정의해둔 `"pre-commit"` 스크립트, 즉 `lint-staged` 를 실행시켜줍니다.

`.husky/post-commit`:
```sh
#!/usr/bin/env sh

# 이미 실행 중인 post-commit 훅인지 확인
if [ "$HUSKY_POST_COMMIT_RUNNING" = "1" ]; then
  exit 0
fi

# 환경 변수 설정하여 재귀 방지
export HUSKY_POST_COMMIT_RUNNING=1

pnpm post-commit # package.json의 post-commit 스크립트 실행

# 환경 변수 초기화
export HUSKY_POST_COMMIT_RUNNING=0
```
이 스크립트는 `package.json` 의 `"post-commit"` 스크립트를 실행하는데요, 여기에도 `HUSKY_POST_COMMIT_RUNNING` 이라는 환경 변수를 이용한 재귀 호출 방지 로직이 들어있습니다. `package.json` 의 `post-commit` 스크립트에서 `HUSKY=0` 으로 이미 한번 방지했지만, 이렇게 쉘 스크립트 레벨에서도 안전장치를 마련해두니 더욱 든든하죠! 어떤 상황에서도 예상치 못한 무한 루프는 피하고 싶으니까요.

그리고 우리의 충직한 버전 관리 도우미, `scripts/update-version.js` 는 기존 로직을 그대로 사용합니다. 달라진 점이 있다면, 이제 GitHub Actions 가 아닌 개발자의 로컬 환경에서, 커밋 직후 Husky 에 의해 실행된다는 점이죠!

```javascript
/* eslint-disable @typescript-eslint/no-require-imports */
const { format } = require('date-fns');
const fs = require('fs');
const path = require('path');
const semver = require('semver');

// (기존 HeadVer 스크립트 내용은 동일하게 유지됩니다)
// getYearWeek, getHeadVer, getNextVersion 함수들...

// 메인 로직
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

// console.log(`::set-output name=new_version::${nextVersion}`); // GitHub Actions용 출력은 이제 필요 없겠죠?
console.log(`Updated root package version to ${nextVersion}`); // 로컬에서 확인하기 위한 로그
```
`update-version.js` 스크립트의 내용은 기존과 거의 동일합니다. `package.json` 과 `build_number.json` 을 읽고, HeadVer 규칙에 따라 다음 버전을 계산하고, 파일들을 업데이트하는 역할을 충실히 수행하죠. 한 가지 작은 변화는 GitHub Actions 에서 사용하던 `::set-output` 로그 대신, 로컬 콘솔에서 업데이트된 버전을 확인할 수 있도록 로그를 수정했습니다.

### 그래서 뭐가 어떻게 좋아졌나요? Husky 도입 전후 비교

Husky 를 도입하고 나서 저희 팀의 개발 경험은 정말 눈에 띄게 좋아졌습니다.

*   **즉각적인 버전 업데이트:** 이제 코드를 작성하고 `git commit` 을 하는 순간, 제 로컬에서 바로 버전이 업데이트됩니다! 푸시하고 한참 뒤에 CI/CD 파이프라인 결과를 기다릴 필요가 없어졌어요. 개발 흐름이 끊기지 않고 훨씬 매끄러워졌습니다.
*   **실수 방지:** 커밋할 때마다 `lint-staged` 가 돌아가니, 코드 스타일이나 간단한 오류는 커밋 전에 자동으로 수정되거나 알려줍니다. 그리고 `post-commit` 훅에서 버전 업데이트가 자동으로 이루어지니, " 앗! 버전 업데이트 깜빡했다!" 하는 일도 사라졌죠. (가끔 이런 실수로 커밋을 여러 번 하거나, 브랜치 히스토리가 지저분해지는 경험, 다들 있으시죠? 😉)
*   **협업 효율 증가:** 모든 팀원이 동일한 Git Hook 설정을 사용하게 되니, 누가 커밋하든 일관된 방식으로 버전이 관리되고 코드 품질이 유지됩니다. 덕분에 불필요한 커뮤니케이션 비용도 줄었고요.
*   **CI/CD 리소스 절약:** 더 이상 단순 버전 업데이트를 위해 CI/CD 파이프라인을 돌릴 필요가 없어졌습니다. 작지만 소중한 CI 리소스를 아낄 수 있게 된 거죠.

Husky 도입 후 개발 플로우 변화.png (가상 이미지: 왼쪽은 푸시 후 CI/CD 에서 버전 업데이트, 오른쪽은 로컬 커밋 시 즉시 버전 업데이트되는 모습 비교)

### 아찔했던 순간과 해결의 기쁨: `post-commit` 무한 루프 탈출기

사실 `post-commit` 훅에서 `git commit --amend` 를 사용하는 아이디어를 처음 시도했을 때, 정말 아찔한 경험을 했습니다. 예상대로 (?) `post-commit` 훅이 자기 자신을 계속 호출하면서 무한 루프에 빠져버린 거죠! 😱 터미널 창은 에러 메시지로 도배되고, 제 컴퓨터는 팬 소리를 내며 힘겨워했죠.

" 아, 이거 이렇게 간단한 문제가 아니구나…" 싶어서 구글링과 스택오버플로우를 뒤지기 시작했습니다. 여러 자료를 찾아본 끝에 `HUSKY=0` 이라는 환경 변수를 사용하면 Husky 훅의 재실행을 막을 수 있다는 사실을 알게 되었어요. 마치 어둠 속에서 한 줄기 빛을 찾은 기분이었습니다! 해당 옵션을 적용하고 다시 커밋을 했을 때, 드디어 제가 원하던 대로 딱 한 번만 버전이 업데이트되고 깔끔하게 마무리되는 것을 보고 얼마나 기뻤는지 모릅니다.

이런 작은 삽질과 해결의 경험들이 쌓여서 더 나은 개발 환경을 만들어가는 것 같아요. 여러분도 비슷한 문제를 겪으신다면, `HUSKY=0` (또는 각 Git Hook 클라이언트에 맞는 재귀 방지 옵션) 을 꼭 기억해주세요!

### HeadVer 의 장점은 그대로, 편리함은 UP!

Husky 를 도입했다고 해서 기존 HeadVer 의 장점이 사라지는 건 아닙니다. 오히려 HeadVer 가 가진 직관성과 시간 정보 포함이라는 장점이 로컬 개발 환경의 편리함과 만나 더욱 빛을 발하게 되었죠.

*   **버전 번호만으로 제품의 발전 과정과 릴리스 시기를 직관적으로 파악**할 수 있다는 HeadVer 의 핵심 가치는 그대로 유지됩니다. (`<head>.<yearweek>.<build>`)
* 풀스택 개발 환경에서 백엔드와 프론트엔드의 **`head` 버전을 동기화하여 호환성을 관리**하는 방식도 이제 로컬 커밋 단계에서부터 더 쉽게 적용할 수 있게 되었습니다.

이제 커밋하는 순간마다 내 작업이 어떤 버전으로 기록되는지 바로바로 알 수 있으니, 개발 과정 전체에 대한 통제력이 더 높아진 느낌입니다.

### 마치며: 똑똑한 자동화로 개발 라이프사이클 개선하기

GitHub Actions 에서 Husky 로 로컬 버전 관리 자동화를 이전하면서, 저희 팀은 개발 생산성과 만족도 모두에서 긍정적인 변화를 경험했습니다. 처음에는 " 굳이 로컬에서까지…?" 라고 생각할 수도 있지만, 막상 도입하고 나니 이 편리함에서 헤어 나올 수가 없네요.

작은 자동화 하나가 개발자의 반복적인 작업을 줄여주고, 실수를 방지하며, 궁극적으로 더 중요한 문제에 집중할 수 있도록 도와준다는 것을 다시 한번 깨달았습니다. HeadVer 와 Husky 의 조합은 저희 팀에게 그런 멋진 경험을 선사해주었습니다.

이 글이 여러분의 프로젝트에 버전 관리에 대한 새로운 아이디어나 영감을 드렸기를 바랍니다. 혹시 여러분은 어떤 방식으로 버전 관리를 하고 계신가요? 더 좋은 팁이나 경험이 있다면 댓글로 자유롭게 공유해주세요! 함께 더 나은 개발 문화를 만들어가면 좋겠습니다.

긴 글 읽어주셔서 감사합니다! 😊

---

**참고 자료 (기존 글에서 언급된 자료는 여전히 유효합니다!)**

*   [HeadVer: 제품 팀을 위한 새로운 버저닝 시스템](https://techblog.lycorp.co.jp/ko/headver-new-versioning-system-for-product-teams)
*   [HeadVer GitHub Repository](https://github.com/line/headver)
*   [Husky 공식 문서](https://typicode.github.io/husky/)
*   [lint-staged GitHub Repository](https://github.com/okonet/lint-staged)

# Reference

# 연결문서
- [ESLint·Prettier·Husky 자동화를 정착시키기까지](/post/eslint-prettier-husky-jadonghwareul-jeongchaksikigikkaji)
- [나만의 SVG 아이콘 라이브러리 만들기 여정기 (3편) - GitHub Actions로 날개 달기, 자동 배포 시스템 구축!](/post/namanui-svg-aikon-raibeureori-mandeulgi-yeojeonggi-3pyeon-github-actionsro-nalgae-dalgi-jadong-baepo-siseutem-guchuk)
- [나만의 SVG 아이콘 라이브러리 만들기 여정기 (1편) - React 컴포넌트 변환과 컴파일 자동화](/post/namanui-svg-aikon-raibeureori-mandeulgi-yeojeonggi-1pyeon-react-keomponeonteu-byeonhwangwa-keompail-jadonghwa)
