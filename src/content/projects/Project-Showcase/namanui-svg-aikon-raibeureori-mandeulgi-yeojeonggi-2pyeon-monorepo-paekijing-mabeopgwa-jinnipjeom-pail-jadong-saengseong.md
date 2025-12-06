---
tags:
  - Engineering
  - TechDeepDive
  - Monorepo
  - Automation
  - TypeScript
  - NodeJS
  - Packaging
  - Frontend
created: '2025-06-21 03:39'
modified: '2025-12-06 10:35'
title: 나만의 SVG 아이콘 라이브러리 만들기 여정기 (2편) - 모노레포 패키징 마법과 진입점 파일 자동 생성
---
안녕하세요, 다시 만나 반갑습니다! 지난 1 편에서는 [SVG 원본 파일들을 React 컴포넌트(.tsx)로 변환하고, 이를 JavaScript(.js)와 타입 정의 파일(.d.ts)로 컴파일하는 과정](https://velog.io/@kmsk99/%EB%82%98%EB%A7%8C%EC%9D%98-SVG-%EC%95%84%EC%9D%B4%EC%BD%98-%EB%9D%BC%EC%9D%B4%EB%B8%8C%EB%9F%AC%EB%A6%AC-%EB%A7%8C%EB%93%A4%EA%B8%B0-%EC%97%AC%EC%A0%95%EA%B8%B0-1%ED%8E%B8-React-%EC%BB%B4%ED%8F%AC%EB%84%8C%ED%8A%B8-%EB%B3%80%ED%99%98%EA%B3%BC-%EC%BB%B4%ED%8C%8C%EC%9D%BC-%EC%9E%90%EB%8F%99%ED%99%94) 을 함께 살펴봤습니다. 이제 우리 손에는 잘 구워진 컴포넌트 재료들이 가득한데요, 이걸 그냥 한 바구니에 담아두기엔 너무 아깝잖아요? 😉

그래서 오늘은 이 컴파일된 결과물들을 **아이콘 스타일 (카테고리) 별로 착착 정리해서 개별 NPM 패키지로 만들고, 각 패키지에서 아이콘을 쉽게 불러다 쓸 수 있도록 `index.js`, `index.mjs`, `index.d.ts` 같은 마법의 진입점 파일들을 자동으로 생성하는 과정**을 공유해 드리려고 합니다. 바로 " 나만의 SVG 아이콘 라이브러리 만들기 여정기 " 그 두 번째 이야기입니다!

### 왜 패키지로 나눌까요? 모노레포와 개별 패키지의 아름다운 조화

" 그냥 컴파일된 파일들을 한 폴더에 다 넣고 쓰면 안 되나요?" 라고 생각하실 수도 있습니다. 물론 작은 프로젝트라면 그것도 방법이겠지만, 저희는 몇 가지 이유로 아이콘들을 스타일별 개별 패키지로 나누고, 이를 모노레포 (monorepo) 로 관리하기로 결정했습니다.

*   **선택적 설치 및 번들 크기 최적화:** 사용자가 필요한 아이콘 스타일 패키지만 골라서 설치할 수 있게 됩니다. 예를 들어 "Filled" 스타일 아이콘만 필요하다면, 굳이 "Light" 나 "Duotone" 스타일 아이콘까지 전부 설치할 필요가 없는 거죠. 이는 최종 애플리케이션의 번들 크기를 줄이는 데 큰 도움이 됩니다.
*   **명확한 관심사 분리:** 각 패키지는 특정 아이콘 스타일에만 집중합니다. 덕분에 코드 관리가 훨씬 깔끔해지고, 특정 스타일에 문제가 생겼을 때 다른 스타일에 영향을 주지 않고 해결할 수 있습니다.
*   **유연한 버전 관리 (잠재적 이점):** (이번 프로젝트에서는 모든 패키지가 동일한 버전을 사용하지만) 필요하다면 각 패키지별로 독립적인 버전 관리를 할 수도 있습니다.
*   **통합 패키지의 편리함:** 개별 패키지 외에도, 모든 스타일을 한 번에 설치해서 사용할 수 있는 통합 패키지도 제공하여 사용 편의성을 높일 수 있습니다. (마치 `lodash` 와 `lodash/fp` 처럼요!)

이런 장점들을 살리기 위해, 저희는 `pnpm` 워크스페이스를 활용한 모노레포 구조를 채택했습니다. 루트 `package.json` 은 이렇게 생겼죠.

```json
// 루트 package.json 일부
{
  "name": "my-icon-workspace-root", // 실제 프로젝트 이름으로 변경해주세요
  "private": true, // 루트 자체는 배포하지 않음
  "workspaces": [
    "packages/*" // packages 폴더 하위의 모든 폴더를 워크스페이스로 인식
  ],
  "scripts": {
    // ... 1편에서 본 build:icons, compile:all ...
    "build:packages": "node --max-old-space-size=4096 --expose-gc scripts/build-packages.js",
    "build": "pnpm clean && pnpm build:icons && pnpm compile:all && pnpm build:packages" // 전체 빌드 명령
  }
}
```
`workspaces` 설정을 통해 `packages` 폴더 아래에 만들 각 아이콘 스타일별 폴더들이 개별 패키지로 관리될 수 있도록 했습니다. 그리고 오늘 이야기의 핵심인 `build:packages` 스크립트가 보이네요! 이 녀석이 바로 마법을 부리는 주인공입니다.

### 마법의 시작: `scripts/build-packages.js` 파헤치기

`scripts/build-packages.js` 스크립트는 1 편에서 컴파일된 결과물 (`dist/lib`, `dist/types`, `dist/metadata.json`) 을 바탕으로 `packages` 폴더 안에 각 스타일별 하위 패키지들을 생성하고, 각 패키지가 독립적으로 작동할 수 있도록 필요한 파일들을 채워 넣는 역할을 합니다. 정말 많은 일을 하는 친구죠! 크게 보면 다음과 같은 작업들을 순차적으로 수행합니다.

1.  **준비 작업:** 필요한 디렉토리 (`packages`) 가 없으면 만들고, 1 편에서 생성한 `dist/metadata.json` 파일을 읽어옵니다. 이 메타데이터에는 각 아이콘의 이름, 경로, 그리고 가장 중요한 **카테고리 (스타일)** 정보가 담겨있습니다.
2.  **스타일별 패키지 생성:** `metadata.json` 의 카테고리 정보를 기준으로 스타일별로 반복 작업을 수행합니다.
	*   `packages/{스타일명}` 폴더를 생성합니다. (예: `packages/filled`, `packages/light`)
	* 각 패키지 폴더 안에 `package.json` 파일을 동적으로 생성합니다. 이 파일에는 해당 스타일 패키지의 이름 (예: `@my-scope/my-icons-filled`), 버전 (루트 `package.json` 버전과 동일하게), 설명, 그리고 가장 중요한 `main`, `module`, `types` 진입점 파일 경로 등이 정의됩니다.
	*   1 편에서 컴파일된 `dist/lib/{스타일}` 및 `dist/types/{스타일}` 폴더의 내용물을 현재 만드는 패키지의 `dist/lib` 및 `dist/types` 폴더로 **복사**합니다. 이제 각 패키지는 자신에게 필요한 컴포넌트 파일들만 갖게 됩니다.
	* 해당 스타일에 해당하는 아이콘 정보만 필터링한 `metadata.json` 파일을 패키지 내부 `dist` 폴더에 복사합니다. (이 메타데이터는 패키지 내부 빌드 스크립트에서 사용됩니다)
	*   **마법의 씨앗 심기:** 각 패키지 내부에서 진입점 파일 (`index.js`, `index.mjs`, `index.d.ts`) 을 생성할 수 있도록, 미리 준비된 템플릿 빌드 스크립트들 (`scripts/templates` 폴더 안의 파일들) 을 해당 패키지의 `scripts` 폴더로 복사합니다.
	* 복사된 템플릿 빌드 스크립트를 실행하여 (`runBuildScript` 함수), 패키지 내부에 최종 진입점 파일들을 생성합니다.
3.  **통합 패키지 생성:** 모든 스타일의 아이콘을 한 번에 사용할 수 있는 통합 패키지 (예: `packages/all`) 도 만듭니다. 이 패키지는 모든 컴파일된 파일을 포함하고, 루트 레벨의 진입점 파일뿐만 아니라 스타일별 네임스페이스로도 아이콘에 접근할 수 있도록 특별한 진입점 구조를 가집니다.

코드로 보면 이런 느낌입니다.

```javascript
// scripts/build-packages.js 의 일부 (핵심 로직 위주)
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process'); // 스크립트 실행을 위해

// 스타일 폴더명 -> 패키지 이름 일부로 변환 (예: 'filled' -> 'filled')
const STYLE_MAPPINGS = { /* ... 1편과 유사 ... */ };
const STYLE_DESCRIPTIONS = { /* ... 1편과 유사 ... */ };
const PACKAGES_DIR = path.join(__dirname, '../packages');
const DIST_DIR = path.join(__dirname, '../dist'); // 1편에서 컴파일된 결과물 위치

// 루트 package.json에서 버전 읽기
function getRootVersion() {
  const rootPackageJsonPath = path.join(__dirname, '../package.json');
  const rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, 'utf8'));
  return rootPackageJson.version;
}

// 디렉토리 생성 유틸
function ensureDirectoryExists(directory) { /* ... */ }

// 디렉토리 복사 유틸
function copyDirectory(source, target) { /* ... */ }

// 각 패키지 내부에 복사될 빌드 스크립트를 실행하는 함수
function runBuildScript(packageDir, style) {
  return new Promise((resolve, reject) => {
    console.log(`[${style}] 패키지 내부 빌드 스크립트 실행 중... (${packageDir})`);
    const buildScriptPath = path.join(packageDir, 'scripts', 'build.js'); // 패키지 내부에 복사된 build.js
    const packageNameSuffix = STYLE_MAPPINGS[style] || path.basename(packageDir);

    const childProcess = spawn('node', [buildScriptPath, packageNameSuffix], { /* ... 옵션 ... */ });
    // ... (프로세스 완료/에러 처리) ...
  });
}

// 각 패키지의 package.json 내용을 생성하는 함수
function createPackageJsonContent(style) {
  // style이 null이면 통합 패키지용
  const isUnifiedPackage = !style;
  const packageNameSuffix = isUnifiedPackage ? 'all' : STYLE_MAPPINGS[style];
  const packageName = `@my-scope/my-icons-${packageNameSuffix}`; // 실제 스코프와 이름으로 변경
  const description = isUnifiedPackage ? 'My Icons - 모든 스타일 통합 패키지' : STYLE_DESCRIPTIONS[style];

  return {
    name: packageName,
    version: getRootVersion(),
    description: description,
    main: "dist/index.js",    // CommonJS 진입점
    module: "dist/index.mjs", // ESM 진입점
    types: "dist/index.d.ts",  // 타입 정의 진입점
    files: ["dist"],           // 배포 시 포함될 파일/폴더
    sideEffects: false,        // 트리쉐이킹 최적화를 위해
    // ... (repository, bugs, keywords, license, peerDependencies 등)
    // devDependencies는 패키지 내부 빌드 스크립트가 TypeScript 등을 사용한다면 필요할 수 있음
  };
}

async function buildIndividualPackages(metadata) {
  // 메타데이터를 기반으로 스타일별 그룹화
  const styleGroups = metadata.reduce((acc, icon) => {
    const style = icon.category.split('/')[0]; // 'filled/arrow/MyArrowLeftIcon' -> 'filled'
    if (!acc[style]) acc[style] = [];
    acc[style].push(icon);
    return acc;
  }, {});

  for (const [style, iconsInStyle] of Object.entries(styleGroups)) {
    if (!STYLE_MAPPINGS[style]) {
      console.warn(`[${style}] 알 수 없는 스타일입니다. 건너<0xEB><0x9B><0x84>니다.`);
      continue;
    }
    console.log(`\n=== [${style}] 스타일 패키지 생성 시작 ===`);
    const packageNameSuffix = STYLE_MAPPINGS[style];
    const packageDir = path.join(PACKAGES_DIR, packageNameSuffix);
    ensureDirectoryExists(packageDir);

    // 1. package.json 생성
    const packageJsonData = createPackageJsonContent(style);
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify(packageJsonData, null, 2));

    // 2. dist 폴더 및 하위 lib, types 폴더 생성 및 파일 복사
    const packageDistDir = path.join(packageDir, 'dist');
    ensureDirectoryExists(packageDistDir);
    const packageLibDir = path.join(packageDistDir, 'lib'); // 여기서는 스타일 하위 폴더 없이 바로 lib
    const packageTypesDir = path.join(packageDistDir, 'types');

    // 원본 dist/lib/{style}/* -> 패키지 dist/lib/* 로 복사
    const sourceLibStyleDir = path.join(DIST_DIR, 'lib', style);
    if (fs.existsSync(sourceLibStyleDir)) copyDirectory(sourceLibStyleDir, packageLibDir);

    // 원본 dist/types/{style}/* -> 패키지 dist/types/* 로 복사
    const sourceTypesStyleDir = path.join(DIST_DIR, 'types', style);
    if (fs.existsSync(sourceTypesStyleDir)) copyDirectory(sourceTypesStyleDir, packageTypesDir);

    // 3. 필터링된 metadata.json 복사
    const filteredMetadata = iconsInStyle.map(icon => ({
      ...icon,
      // 패키지 내부에서는 스타일 prefix가 없는 경로 사용
      path: icon.path.substring(style.length + 1) // "filled/arrow/MyIcon" -> "arrow/MyIcon"
    }));
    fs.writeFileSync(path.join(packageDistDir, 'metadata.json'), JSON.stringify(filteredMetadata, null, 2));

    // 4. 템플릿 빌드 스크립트 복사
    const packageScriptsDir = path.join(packageDir, 'scripts');
    ensureDirectoryExists(packageScriptsDir);
    const templatesDir = path.join(__dirname, 'templates'); // 템플릿 스크립트 위치
    ['build.js', 'generate-esm.js', 'generate-index.js', 'generate-types.js'].forEach(scriptName => {
      fs.copyFileSync(path.join(templatesDir, scriptName), path.join(packageScriptsDir, scriptName));
    });

    // 5. 패키지 내부 빌드 스크립트 실행 (진입점 파일 생성)
    await runBuildScript(packageDir, style);
    console.log(`✅ [${style}] 스타일 패키지 생성 완료!`);
  }
}

async function createUnifiedPackage(allMetadata) {
  console.log('\n=== 통합 패키지 생성 시작 ===');
  const packageDir = path.join(PACKAGES_DIR, 'all'); // 통합 패키지 폴더명
  ensureDirectoryExists(packageDir);

  // 1. package.json 생성
  const packageJsonData = createPackageJsonContent(null); // style을 null로 전달
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify(packageJsonData, null, 2));

  // 2. dist 폴더 및 하위 lib, types 폴더 생성 및 *모든* 파일 복사
  const packageDistDir = path.join(packageDir, 'dist');
  ensureDirectoryExists(packageDistDir);
  // 전체 dist/lib, dist/types 를 통합 패키지의 dist로 복사
  if (fs.existsSync(path.join(DIST_DIR, 'lib'))) copyDirectory(path.join(DIST_DIR, 'lib'), path.join(packageDistDir, 'lib'));
  if (fs.existsSync(path.join(DIST_DIR, 'types'))) copyDirectory(path.join(DIST_DIR, 'types'), path.join(packageDistDir, 'types'));

  // 3. 전체 metadata.json 복사
  fs.copyFileSync(path.join(DIST_DIR, 'metadata.json'), path.join(packageDistDir, 'metadata.json'));

  // 4. 통합 패키지용 빌드 스크립트 (템플릿 복사 후 실행 - 스타일별 네임스페이스 포함된 진입점 생성)
  // 개별 패키지와는 다른 특별한 build.js 템플릿을 사용하거나,
  // build-packages.js 내에서 직접 통합 패키지용 진입점 파일을 생성할 수도 있습니다.
  // 여기서는 사용자가 제공한 코드처럼 직접 생성하는 방식을 따르겠습니다.
  const allIconsSorted = [...allMetadata].sort((a,b) => a.path.localeCompare(b.path));

  // 루트 레벨 index.js (CommonJS)
  const cjsIndexContent = allIconsSorted
    .map(icon => `exports.${icon.componentName} = require('./lib/${icon.path}').default;`)
    .join('\n');
  fs.writeFileSync(path.join(packageDistDir, 'index.js'), cjsIndexContent);

  // 루트 레벨 index.mjs (ESM)
  const esmIndexContent = allIconsSorted
    .map(icon => `export { default as ${icon.componentName} } from './lib/${icon.path}.js';`)
    .join('\n');
  fs.writeFileSync(path.join(packageDistDir, 'index.mjs'), esmIndexContent);

  // 루트 레벨 index.d.ts (Types)
  const typeIndexContent = allIconsSorted
    .map(icon => `export { default as ${icon.componentName} } from './types/${icon.path}';`) // .d.ts에서는 .js 확장자 불필요
    .join('\n');
  fs.writeFileSync(path.join(packageDistDir, 'index.d.ts'), typeIndexContent);

  // 스타일별 네임스페이스를 위한 하위 폴더 및 인덱스 파일 생성
  const stylesCategoriesMap = allIconsSorted.reduce((acc, icon) => {
    const pathParts = icon.category.split('/'); // 예: "filled/navigation"
    const style = pathParts[0];
    if (!acc[style]) acc[style] = [];
    acc[style].push(icon);
    return acc;
  }, {});

  for (const [style, iconsInStyle] of Object.entries(stylesCategoriesMap)) {
    const styleDistDir = path.join(packageDistDir, style); // 예: packages/all/dist/filled
    ensureDirectoryExists(styleDistDir);
    iconsInStyle.sort((a,b) => a.path.localeCompare(b.path));

    // 스타일 레벨 index.js
    const styleCjs = iconsInStyle.map(icon => `exports.${icon.componentName} = require('../../lib/${icon.path}').default;`).join('\n');
    fs.writeFileSync(path.join(styleDistDir, 'index.js'), styleCjs);
    // 스타일 레벨 index.mjs
    const styleEsm = iconsInStyle.map(icon => `export { default as ${icon.componentName} } from '../../lib/${icon.path}.js';`).join('\n');
    fs.writeFileSync(path.join(styleDistDir, 'index.mjs'), styleEsm);
    // 스타일 레벨 index.d.ts
    const styleTypings = iconsInStyle.map(icon => `export { default as ${icon.componentName} } from '../../types/${icon.path}';`).join('\n');
    fs.writeFileSync(path.join(styleDistDir, 'index.d.ts'), styleTypings);
  }
  console.log(`✅ 통합 패키지 생성 완료!`);
}

async function main() {
  console.log('=== 전체 패키지 빌드 프로세스 시작 ===');
  ensureDirectoryExists(PACKAGES_DIR);
  const metadata = JSON.parse(fs.readFileSync(path.join(DIST_DIR, 'metadata.json'), 'utf8'));

  await buildIndividualPackages(metadata);
  await createUnifiedPackage(metadata);

  console.log('\n=== 모든 패키지 빌드 완료! ===');
}

main().catch(error => {
  console.error("패키지 빌드 중 심각한 오류 발생:", error);
  process.exit(1);
});
```
코드의 양이 꽤 되지만, 핵심은 각 스타일별로 필요한 파일들 (컴파일된 코드, `package.json`, 빌드 스크립트 템플릿) 을 정확한 위치에 복사하고, 각 패키지가 독립적으로 빌드 (진입점 파일 생성) 될 수 있도록 준비하는 것입니다. 통합 패키지는 모든 스타일을 포함하며, 사용자가 `import { FilledMyIcon } from '@my-scope/my-icons-all'` 또는 `import { MyIcon } from '@my-scope/my-icons-all/filled'` 와 같이 접근할 수 있도록 진입점 파일을 구성합니다. 이 부분은 사용자의 프로젝트 구조나 선호에 따라 다양하게 구현할 수 있습니다.

### 패키지 내부의 작은 마법사들: `scripts/templates/*.js`

`build-packages.js` 가 각 패키지 폴더에 `scripts/templates` 의 스크립트들을 복사한다고 했는데, 이 템플릿 스크립트들은 무슨 일을 할까요? 사용자가 제공한 코드에서는 `generate-esm.js`, `generate-index.js`, `generate-types.js` 등이 이 역할을 하는 것으로 보입니다. 이 스크립트들은 각 패키지 내부의 `dist/metadata.json` (해당 스타일에 필터링된 메타데이터) 을 읽어서, `dist` 폴더 안에 최종적으로 사용될 `index.mjs`, `index.js`, `index.d.ts` 파일을 생성합니다.

예를 들어, `packages/filled/scripts/generate-esm.js` 는 `packages/filled/dist/metadata.json` 을 읽고, `packages/filled/dist/index.mjs` 파일에 다음과 같은 내용을 쓸 것입니다.

```javascript
// packages/filled/dist/index.mjs (생성 예시)
export { default as MyFilledArrowLeftIcon } from './lib/arrow/MyFilledArrowLeftIcon.js';
export { default as MyFilledHomeIcon } from './lib/ui/MyFilledHomeIcon.js';
// ... (해당 filled 스타일의 모든 아이콘들)
```
이렇게 각 패키지는 자신만의 깔끔한 진입점을 갖게 되어, 사용자는 `import { MyFilledHomeIcon } from '@my-scope/my-icons-filled';` 와 같이 매우 편리하게 아이콘을 가져다 쓸 수 있게 됩니다.

### 2 편을 마치며: 배포를 향한 마지막 관문만 남았다!

휴, 정말 많은 일이 있었죠? SVG 파일을 React 컴포넌트로 만들고 컴파일한 것에 이어, 오늘은 그 결과물들을 깔끔하게 스타일별 패키지로 나누고, 각 패키지가 제 역할을 할 수 있도록 진입점 파일까지 자동으로 생성하는 마법 같은 과정을 함께했습니다. 이제 `packages` 폴더에는 배포 준비가 거의 완료된 멋진 아이콘 패키지들이 가득합니다!

" 거의 " 완료되었다고요? 네, 맞습니다. 아직 우리에겐 마지막 관문이 남아있습니다. 바로 이 만들어진 패키지들을 실제로 세상에 공개하는, 즉 **NPM (또는 GitHub Packages 등) 에 배포하는 일**이죠!

그 흥미진진한 이야기는 **" 나만의 SVG 아이콘 라이브러리 만들기 여정기 (3 편): GitHub Actions 를 이용한 초간편 자동 배포 시스템 구축 "** 에서 펼쳐질 예정입니다. 3 편에서는 오늘 만든 패키지들을 어떻게 하면 손쉽게, 그리고 자동으로 배포할 수 있는지에 대한 꿀팁들을 대방출할 예정이니, 절대 놓치지 마세요!

오늘 내용이 조금 복잡하게 느껴질 수도 있지만, 차근차근 따라 해보시면 여러분도 멋진 아이콘 라이브러리를 구축하실 수 있을 겁니다. 궁금한 점이나 더 좋은 아이디어가 있다면 언제든지 댓글로 남겨주세요! 😊
