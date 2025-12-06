---
tags:
  - Engineering
  - TechDeepDive
  - TypeScript
  - Monorepo
  - Automation
  - Performance
  - ReactNative
  - Frontend
created: '2025-06-21 03:38'
modified: '2025-12-06 10:35'
title: 나만의 SVG 아이콘 라이브러리 만들기 여정기 (1편) - React 컴포넌트 변환과 컴파일 자동화
---
안녕하세요, 개발자 여러분! UI 개발에서 아이콘은 정말 빼놓을 수 없는 요소죠. 디자이너에게 SVG 파일을 받아서 프로젝트에 적용하곤 하는데, 매번 `import` 경로를 신경 쓰고, `width`, `height`, `fill` 같은 속성을 일일이 설정하는 게 번거로울 때가 많았습니다. " 이 SVG 파일들을 좀 더 React 스럽게, 타입 안전하게 쓸 수는 없을까?" 하는 고민에서 이 프로젝트가 시작되었습니다.

그래서 저희 팀은 SVG 아이콘들을 React 컴포넌트로 변환하고, 이를 TypeScript 로 컴파일하여 사용성과 개발 경험을 높이는 자동화 시스템을 구축하기로 했습니다. 이 여정을 총 3 편에 걸쳐 공유해 드리려고 하는데요, 오늘은 그 첫 번째 이야기로 **SVG 파일을 React 컴포넌트 (.tsx) 로 변환하고, 이를 JavaScript(.js) 와 타입 정의 파일 (.d.ts) 로 컴파일하는 과정**을 자세히 살펴보겠습니다.

### 왜 굳이 변환해야 할까요? SVG 직접 사용의 작은 불편함들

SVG 를 직접 사용하는 것도 물론 가능합니다. 하지만 프로젝트 규모가 커지고 아이콘 종류가 많아지면 몇 가지 불편한 점들이 생기기 시작했습니다.

*   **반복적인 속성 설정:** 아이콘마다 `width`, `height`, `color` 등을 설정해야 하고, 일관성을 유지하기 어렵습니다.
*   **타입 안정성 부재:** TypeScript 환경에서 아이콘 컴포넌트의 props 에 대한 타입 체크가 안 되니 불안했습니다.
*   **유지보수의 어려움:** 아이콘 파일이 여기저기 흩어져 있으면 관리하기 어렵고, 일괄 변경도 힘듭니다.

이런 문제들을 해결하고, 마치 잘 만들어진 UI 라이브러리의 컴포넌트처럼 아이콘을 사용하고 싶다는 욕심이 생겼습니다. 그래서 SVGR 과 TypeScript 를 활용하여 우리만의 아이콘 컴포넌트 시스템을 만들기로 결심했습니다!

### 1 단계: SVG, React 옷을 입다 - 컴포넌트 변환 스크립트 (`batch-convert.js`)

가장 먼저 할 일은 수많은 SVG 파일들을 React 컴포넌트 (.tsx) 로 변환하는 것입니다. 이 작업을 위해 저희는 `scripts/batch-convert.js` 라는 이름의 스크립트를 작성했습니다. 이 스크립트의 핵심 역할은 다음과 같습니다.

1.  `src/icons` 폴더 내의 모든 SVG 파일을 탐색합니다. (하위 폴더 구조까지 모두 포함해서요!)
2.  각 SVG 파일을 `@svgr/core` 라이브러리를 사용하여 React 컴포넌트 코드로 변환합니다.
3.  변환된 코드를 `src/generated` 폴더에 동일한 폴더 구조를 유지하며 `.tsx` 파일로 저장합니다.
4.  변환된 아이콘들의 정보를 담은 `metadata.json` 파일을 생성합니다. (이 파일은 2 편에서 아주 유용하게 쓰일 예정입니다!)

```javascript
// scripts/batch-convert.js 의 일부 (핵심 로직 위주)
const fs = require('fs');
const path = require('path');
const glob = require('glob');
const { transform } = require('@svgr/core');

const SOURCE_DIR = path.join(__dirname, '../src/icons'); // 원본 SVG 파일 위치
const OUTPUT_DIR = path.join(__dirname, '../src/generated'); // 변환된 .tsx 파일 저장 위치
const ICON_PREFIX = 'My'; // 저희 아이콘 컴포넌트 접두사입니다. (예: MyHomeIcon)

// 디렉토리 생성 유틸
function ensureDirectoryExists(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

// 파일 이름을 컴포넌트 이름에 적합하게 변경
function sanitizeAndPascalCase(fileName) {
  // 실제 프로덕션에서는 좀 더 정교한 이름 규칙을 사용합니다.
  // 여기서는 간단히 특수문자 제거 및 파스칼 케이스 변환을 가정합니다.
  const sanitized = fileName.replace(/[^a-zA-Z0-9_]/g, '');
  return ICON_PREFIX + sanitized
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

async function convertSvgToReact(svgPath, outputPath) {
  try {
    const svgCode = fs.readFileSync(svgPath, 'utf8');
    const fileName = path.basename(svgPath, '.svg');
    const componentName = sanitizeAndPascalCase(fileName);

    const jsCode = await transform(
      svgCode,
      {
        plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx'], // SVGO 최적화 및 JSX 변환
        typescript: true, // TypeScript 코드로 변환!
        icon: true,       // React Native SVG 호환성을 위한 옵션 (웹에서도 유용)
        jsx: { /* ... Babel 설정 ... */ },
        svgProps: {       // 기본으로 전달될 props 정의
          width: '{size}',
          height: '{size}',
          className: '{className}',
        },
      },
      { componentName }
    );

    // 생성된 코드에 커스텀 로직 추가 (예: size 기본값, props 타입 강화)
    const tsxCode = jsCode
      .replace(
        /(const \w+) = \((props: SVGProps<SVGSVGElement>)\)/,
        // size prop 추가 및 기본값 24 설정, className prop 타입 명시
        `$1 = ({ size = 24, className, ...props }: React.SVGProps<SVGSVGElement> & { size?: number | string; className?: string })`
      )
      // SVG 내부 fill, stroke 색상을 CSS로 제어하기 쉽게 currentColor로 변경
      // 단, className prop이 있을 때만 currentColor를 사용하도록 하여,
      // 기존 SVG 파일에 정의된 색상을 유지하면서도 CSS로 오버라이드 가능하게!
      .replace(
        /fill="(#[0-9a-fA-F]{3,6}|none)"/g,
        (match, color) => `fill={className ? "currentColor" : "${color}"}`
      )
      .replace(
        /stroke="(#[0-9a-fA-F]{3,6}|none)"/g,
        (match, color) => `stroke={className ? "currentColor" : "${color}"}`
      );

    fs.writeFileSync(outputPath, tsxCode, 'utf8');
    return { componentName, originalFileName: fileName, path: path.relative(OUTPUT_DIR, outputPath).replace(/\\/g, '/').replace('.tsx', '') };
  } catch (error) {
    console.error(`Error converting ${svgPath}:`, error);
    return null;
  }
}

async function batchConvert() {
  // ... (폴더 생성, 파일 탐색 로직) ...
  const svgFiles = (await glob.glob('**/*.svg', { cwd: SOURCE_DIR })).sort();
  const iconMetadata = [];

  for (const svgFile of svgFiles) {
    const svgPath = path.join(SOURCE_DIR, svgFile);
    const relativePath = path.dirname(svgFile); // 원본 SVG의 상대 경로 (카테고리 정보로 활용)
    const outputDirForFile = path.join(OUTPUT_DIR, relativePath);
    ensureDirectoryExists(outputDirForFile);

    const baseName = path.basename(svgFile, '.svg');
    const outputPath = path.join(outputDirForFile, `${baseName}.tsx`); // 원본 파일명 유지
    const result = await convertSvgToReact(svgPath, outputPath);

    if (result) {
      iconMetadata.push({
        ...result,
        category: relativePath, // 이 정보가 나중에 스타일/카테고리별 패키징에 중요!
      });
    }
  }

  // 메타데이터 저장 (2편에서 사용)
  const metadataOutputPath = path.join(__dirname, '../dist/metadata.json'); // dist 폴더에 저장
  ensureDirectoryExists(path.dirname(metadataOutputPath));
  fs.writeFileSync(metadataOutputPath, JSON.stringify(iconMetadata, null, 2), 'utf8');
  // ...
}

batchConvert();
```

위 코드에서 몇 가지 주목할 점이 있습니다.

*   **`ICON_PREFIX`**: 생성될 React 컴포넌트 이름에 일관된 접두사를 붙여줍니다. (예: `MyHomeIcon`)
*   **`@svgr/core` 설정**:
	*   `typescript: true`: 생성되는 컴포넌트를 TypeScript(.tsx) 로 만듭니다. 덕분에 타입 추론과 자동완성의 이점을 누릴 수 있죠!
	*   `svgProps`: `width`, `height` 를 `{size}` 로, `className` 을 `{className}` 으로 받도록 하여, 사용할 때 `<MyHomeIcon size={32} className="custom-class" />` 와 같이 편리하게 쓸 수 있도록 했습니다.
	*   **색상 제어**: 생성된 코드에서 `fill` 과 `stroke` 속성을 `className` prop 의 유무에 따라 `currentColor` 또는 원본 색상으로 동적으로 설정하도록 수정했습니다. 이렇게 하면 Tailwind CSS 같은 유틸리티 클래스로 쉽게 색상을 변경하거나, 기본 색상을 그대로 사용할 수 있는 유연성을 확보할 수 있습니다. 정말 유용하죠!
*   **`metadata.json`**: 각 아이콘의 컴포넌트 이름, 원본 파일 이름, 생성된 파일 경로, 그리고 가장 중요한 **카테고리 (원본 SVG 의 폴더 경로)** 정보를 저장합니다. 이 카테고리 정보는 나중에 스타일별로 패키지를 분리할 때 아주 중요한 역할을 합니다.

이 스크립트를 `package.json` 에 다음과 같이 등록하여 실행할 수 있습니다.

```json
// package.json
{
  "scripts": {
    "build:icons": "node --max-old-space-size=4096 --expose-gc scripts/batch-convert.js"
  }
}
```
`--max-old-space-size=4096` 와 `--expose-gc` 옵션은 많은 파일을 처리할 때 발생할 수 있는 메모리 문제를 완화하기 위해 추가했습니다. (GC 는 Garbage Collection 을 의미합니다.)

이제 `pnpm build:icons` (또는 `npm run build:icons`) 명령 한 번이면 `src/icons` 폴더의 모든 SVG 가 `src/generated` 폴더에 React 컴포넌트 (.tsx) 로 변신하고, `dist/metadata.json` 파일도 생성됩니다!

### 2 단계: React 컴포넌트, JavaScript 와 타입 정의를 만나다 (`compile-all.js`)

자, 이제 `.tsx` 파일들은 준비되었습니다. 하지만 이 파일들을 바로 JavaScript 프로젝트에서 사용하거나 NPM 에 배포하려면 JavaScript 파일 (.js) 과 타입 정의 파일 (.d.ts) 로 컴파일하는 과정이 필요합니다. 이 역할을 하는 것이 바로 `scripts/compile-all.js` 스크립트와 `tsconfig.json` 파일입니다.

먼저 `tsconfig.json` 의 핵심 설정을 살펴볼까요?

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "es2015",         // 어떤 버전의 JavaScript로 컴파일할지
    "module": "esnext",        // 모듈 시스템 (트리쉐이킹 등을 위해 esnext 사용)
    "lib": ["dom", "dom.iterable", "esnext"],
    "declaration": true,       // .d.ts 타입 정의 파일 생성 여부! (매우 중요)
    "declarationDir": "./dist/types", // .d.ts 파일 저장 위치
    "jsx": "react",            // JSX 처리 방식
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist/lib",    // 컴파일된 .js 파일 저장 위치
    "rootDir": "./src/generated", // 컴파일할 소스 코드의 루트 디렉토리
    "strict": true
  },
  "include": ["src/generated/**/*"], // 컴파일 대상 파일 명시
  "exclude": ["node_modules"]
}
```

여기서 가장 중요한 설정은 `declaration: true` 와 `declarationDir`, 그리고 `outDir` 과 `rootDir` 입니다.

*   `declaration: true` 와 `declarationDir: "./dist/types"`: TypeScript 컴파일러가 각 `.tsx` 파일에 대한 `.d.ts` 타입 정의 파일을 생성하여 `./dist/types` 폴더에 저장하도록 합니다.
*   `outDir: "./dist/lib"` 와 `rootDir: "./src/generated"`: `src/generated` 폴더 내의 `.tsx` 파일들을 컴파일하여, 원본 폴더 구조를 유지하면서 `./dist/lib` 폴더에 `.js` 파일을 저장합니다.

이제 `scripts/compile-all.js` 스크립트를 보겠습니다. 수백, 수천 개의 아이콘을 한 번에 컴파일하려고 하면 메모리 부족 문제가 발생하기 쉽습니다. 실제로 저희도 이 문제 때문에 골머리를 앓았는데요, 해결책은 **카테고리 (스타일) 별로 나누어 순차적으로 컴파일**하는 것이었습니다.

```javascript
// scripts/compile-all.js 의 일부 (핵심 로직 위주)
const { spawn } = require('child_process');
const fs =require('fs');
const path = require('path');

// 프로세스 실행 유틸 (메모리 옵션 및 GC 호출 포함)
function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    // ... (spawn으로 tsc 실행, 이벤트 핸들링, global.gc() 호출 로직) ...
    // 여기서 중요한 것은 tsc 명령을 실행하는 부분입니다.
    const childProcess = spawn(command, args, {
      stdio: 'inherit',
      shell: true, // OS 쉘을 통해 실행
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096 --expose-gc' }
    });
    // ...
  });
}

async function compileTypeScript() {
  console.log('TypeScript 컴파일 시작...');
  const GENERATED_DIR = path.join(__dirname, '../src/generated');
  const TEMP_TSCONFIG_PATH = path.join(__dirname, '../temp-tsconfig.json'); // 임시 tsconfig 파일 경로
  const rootTsconfig = require('../tsconfig.json'); // 원본 tsconfig.json 로드

  // 'src/generated' 아래의 카테고리 폴더 목록을 가져옵니다.
  const categories = fs.readdirSync(GENERATED_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  console.log(`${categories.length}개의 카테고리(스타일)를 찾았습니다.`);

  // 각 카테고리별로 순차적 컴파일
  for (const category of categories) {
    console.log(`"${category}" 카테고리 컴파일 중...`);

    // 해당 카테고리 폴더만 'include'하는 임시 tsconfig.json 생성
    const tempTsconfigContent = {
      ...rootTsconfig,
      // compilerOptions는 원본을 따르되, include만 현재 카테고리로 제한
      include: [`src/generated/${category}/**/*.tsx`],
      // rootDir도 현재 카테고리에 맞게 조정 (출력 경로 유지를 위해 중요)
      compilerOptions: {
        ...rootTsconfig.compilerOptions,
        rootDir: `src/generated/${category}`,
      }
    };
    fs.writeFileSync(TEMP_TSCONFIG_PATH, JSON.stringify(tempTsconfigContent, null, 2));

    try {
      // 임시 tsconfig를 사용하여 tsc 실행
      await runProcess('pnpm', ['tsc', '--project', TEMP_TSCONFIG_PATH]);
      console.log(`"${category}" 카테고리 컴파일 완료.`);
    } catch (error) {
      console.error(`"${category}" 카테고리 컴파일 중 오류 발생:`, error);
      // 오류 발생 시에도 다음 카테고리 컴파일을 계속 진행할 수 있도록 처리
    }

    // 약간의 딜레이를 주어 메모리 안정화 (경험상 도움이 되었습니다)
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (fs.existsSync(TEMP_TSCONFIG_PATH)) {
    fs.unlinkSync(TEMP_TSCONFIG_PATH); // 임시 파일 삭제
  }
  console.log('모든 카테고리 TypeScript 컴파일 완료!');
}

compileTypeScript();
```

이 스크립트의 핵심 아이디어는 다음과 같습니다.

1.  `src/generated` 폴더 하위의 각 카테고리 (스타일) 폴더를 순회합니다.
2.  각 카테고리마다, 해당 카테고리의 파일들만 `include` 하도록 설정된 **임시 `tsconfig.json` 파일**을 생성합니다. 이때 `compilerOptions.rootDir` 도 현재 카테고리 폴더 기준으로 알맞게 설정해 주어야 `outDir` 에 원하는 폴더 구조로 파일이 생성됩니다. 이 부분이 정말 중요했습니다!
3.  생성된 임시 `tsconfig.json` 을 사용하여 `tsc` (TypeScript 컴파일러) 명령을 실행합니다.
4.  한 카테고리의 컴파일이 끝나면 다음 카테고리로 넘어갑니다.

이렇게 함으로써 한 번에 모든 파일을 컴파일할 때 발생하던 메모리 문제를 효과적으로 해결할 수 있었습니다. 물론, `NODE_OPTIONS` 에 `--max-old-space-size` 와 `--expose-gc` 를 설정하고, 각 컴파일 단계 후 `global.gc()` 를 호출하여 명시적으로 가비지 컬렉션을 유도하는 것도 잊지 않았습니다. (이런 최적화 과정에서 오는 작은 성취감이 개발의 또 다른 재미 아닐까요? 😄)

이 스크립트 역시 `package.json` 에 등록합니다.

```json
// package.json
{
  "scripts": {
    "build:icons": "node --max-old-space-size=4096 --expose-gc scripts/batch-convert.js",
    "compile:all": "node --max-old-space-size=4096 --expose-gc scripts/compile-all.js"
    // ... 나머지 빌드 스크립트들은 2편, 3편에서!
  }
}
```

이제 `pnpm compile:all` 명령을 실행하면, `src/generated` 폴더의 `.tsx` 파일들이 컴파일되어 `dist/lib` 폴더에는 `.js` 파일들이, `dist/types` 폴더에는 `.d.ts` 파일들이 멋지게 생성됩니다! 물론, 원본의 카테고리 폴더 구조도 그대로 유지된 채로요.

### 1 편을 마치며: 다음 단계를 향한 준비 완료!

지금까지 SVG 원본 파일로부터 React 컴포넌트 (.tsx) 를 만들고, 이를 다시 JavaScript 모듈 (.js) 과 타입 정의 파일 (.d.ts) 로 컴파일하는 자동화 과정을 살펴보았습니다. 이제 우리 손에는 잘 만들어진 아이콘 컴포넌트 재료들이 가득합니다!

하지만 아직 갈 길이 남았습니다. 이 컴파일된 결과물들을 어떻게 각 아이콘 스타일 (카테고리) 별로 나누어 개별 NPM 패키지로 만들고, 각 패키지에서 바로 사용할 수 있도록 `index.js`, `index.mjs`, `index.d.ts` 같은 진입점 파일들을 생성할 수 있을까요?

그 이야기는 **" 나만의 SVG 아이콘 라이브러리 만들기 여정기 (2 편): 모노레포 패키징 및 진입점 파일 생성 "** 에서 자세히 다루도록 하겠습니다. 2 편에서는 오늘 만든 결과물들을 바탕으로 본격적인 패키징 작업에 들어갈 예정이니 많이 기대해주세요!

이 글이 여러분의 아이콘 관리 시스템 구축에 조금이나마 도움이 되었기를 바랍니다. 혹시 더 좋은 아이디어나 경험이 있다면 댓글로 공유해주세요! 😊

# Reference

# 연결문서

- [Deep Link Friendly Redirect Validation을 구현하며 배운 보안 체크리스트](/post/deep-link-friendly-redirect-validationeul-guhyeonhamyeo-baeun-boan-chekeuriseuteu)
- [ESLint·Prettier·Husky 자동화를 정착시키기까지](/post/eslint-prettier-husky-jadonghwareul-jeongchaksikigikkaji)
- [Feature-Sliced Design으로 프론트엔드 도메인 분해하기](/post/feature-sliced-designeuro-peuronteuendeu-domein-bunhaehagi)
