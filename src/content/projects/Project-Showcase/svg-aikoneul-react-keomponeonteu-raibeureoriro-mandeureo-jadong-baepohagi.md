---
tags:
  - Engineering
  - TypeScript
  - Monorepo
  - Automation
  - GitHubActions
  - React
  - Frontend
  - Packaging
created: '2025-06-21 03:38'
modified: '2026-02-13 12:00'
title: SVG 아이콘을 React 컴포넌트 라이브러리로 만들어 자동 배포하기
---

프로젝트에서 사용할 아이콘 세트를 인터넷에서 구매했다. 디자인 퀄리티가 좋고 스타일도 다양해서 만족스러웠는데, 문제는 제공되는 형태가 SVG 파일 묶음뿐이었다는 것이다. 공식 npm 패키지가 없었다. React 프로젝트에서 아이콘을 쓰려면 SVG 파일을 직접 import하고, 매번 width/height/fill 같은 속성을 일일이 지정해야 했다. 아이콘이 수십 개일 때는 참을 만했는데, 수백 개를 넘어가면서 관리가 고통스러워졌다. TypeScript 환경에서 props 타입 체크도 되지 않으니 런타임에서 깨지는 경우도 있었다.

이대로는 안 되겠다 싶어서, 구매한 SVG 파일들을 React 컴포넌트로 자동 변환하고, 스타일별로 패키지를 분리해서, GitHub Actions로 자동 배포하는 시스템을 직접 구축하기로 했다. 공식 패키지가 없으면 만들면 된다.

---

### 1. 전체 구조 설계

먼저 최종적으로 어떤 모습이 되어야 하는지 그림을 그렸다.

```
project-root/
├── src/icons/           # 원본 SVG 파일 (구매한 아이콘 세트)
│   ├── filled/
│   │   ├── arrows/
│   │   │   └── arrow-left.svg
│   │   └── ui/
│   │       └── home.svg
│   ├── light/
│   └── ...
├── src/generated/       # SVG → React 컴포넌트(.tsx) 변환 결과
├── dist/
│   ├── lib/             # .tsx → .js 컴파일 결과
│   ├── types/           # .tsx → .d.ts 타입 정의 결과
│   └── metadata.json    # 아이콘 메타데이터
├── packages/            # 스타일별 개별 NPM 패키지
│   ├── filled/
│   ├── light/
│   └── all/             # 통합 패키지
├── scripts/
│   ├── batch-convert.js
│   ├── compile-all.js
│   ├── build-packages.js
│   ├── publish-all.js
│   └── templates/       # 패키지 내부 빌드 스크립트 템플릿
├── .github/workflows/
│   └── release-package.yml
├── tsconfig.json
├── pnpm-workspace.yaml
└── package.json
```

빌드 파이프라인은 네 단계로 나뉜다.

1. SVG 파일을 React 컴포넌트(.tsx)로 변환
2. .tsx를 JavaScript(.js)와 타입 정의(.d.ts)로 컴파일
3. 컴파일 결과물을 스타일별 패키지로 분리하고 진입점 파일 생성
4. GitHub Actions로 GitHub Packages에 자동 배포

### 2. 프로젝트 초기 세팅

pnpm workspace 기반 모노레포로 구성했다.

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
```

```json
{
  "name": "@my-scope/my-icons",
  "version": "1.0.0",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "pnpm clean && pnpm build:icons && pnpm compile:all && pnpm build:packages",
    "build:icons": "node --max-old-space-size=4096 --expose-gc scripts/batch-convert.js",
    "compile:all": "node --max-old-space-size=4096 --expose-gc scripts/compile-all.js",
    "build:packages": "node --max-old-space-size=4096 --expose-gc scripts/build-packages.js",
    "clean": "rm -rf packages && rm -rf src/generated && rm -rf dist",
    "publish:all": "node scripts/publish-all.js"
  },
  "devDependencies": {
    "@babel/plugin-transform-react-jsx": "^7.27.1",
    "@svgr/core": "^8.1.0",
    "@svgr/plugin-jsx": "^8.1.0",
    "@svgr/plugin-svgo": "^8.1.0",
    "@types/react": "^19.1.8",
    "glob": "^11.0.3",
    "react": "^19.1.0",
    "typescript": "^5.8.3"
  }
}
```

`--max-old-space-size=4096`와 `--expose-gc`는 수천 개의 SVG를 처리할 때 메모리 부족 문제를 방지하기 위한 옵션이다. 아이콘 수가 적다면 없어도 된다.

tsconfig.json은 이렇게 잡았다.

```json
{
  "compilerOptions": {
    "target": "es2015",
    "module": "esnext",
    "lib": ["dom", "dom.iterable", "esnext"],
    "declaration": true,
    "declarationDir": "./dist/types",
    "jsx": "react",
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist/lib",
    "rootDir": "./src/generated",
    "strict": true
  },
  "include": ["src/generated/**/*"],
  "exclude": ["node_modules"]
}
```

핵심은 `declaration: true`다. 이걸 켜야 `.d.ts` 타입 정의 파일이 생성된다. `outDir`과 `declarationDir`을 분리해서 `.js`와 `.d.ts`가 각각 `dist/lib`과 `dist/types`에 떨어지도록 했다.

### 3. 1단계: SVG를 React 컴포넌트로 변환

`@svgr/core` 라이브러리를 사용해서 SVG 파일을 `.tsx` 컴포넌트로 변환하는 스크립트를 작성했다.

```javascript
// scripts/batch-convert.js
const fs = require('fs');
const path = require('path');
const glob = require('glob');
const { transform } = require('@svgr/core');

const SOURCE_DIR = path.join(__dirname, '../src/icons');
const OUTPUT_DIR = path.join(__dirname, '../src/generated');
const ICON_PREFIX = 'Icon';

function ensureDirectoryExists(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function sanitizeFileName(fileName) {
  return fileName.replace(/[^\w_]/g, '');
}

async function convertSvgToReact(svgPath, outputPath) {
  try {
    const svgCode = fs.readFileSync(svgPath, 'utf8');
    const fileName = path.basename(svgPath, '.svg');
    const sanitizedFileName = sanitizeFileName(fileName);

    // 파일명을 PascalCase 컴포넌트명으로 변환
    let componentName = ICON_PREFIX + sanitizedFileName
      .split('_')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join('');

    const jsCode = await transform(
      svgCode,
      {
        plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx'],
        typescript: true,
        icon: true,
        jsx: {
          babelConfig: {
            plugins: [
              ['@babel/plugin-transform-react-jsx', { useBuiltIns: true }]
            ]
          }
        },
        svgProps: {
          width: '{size}',
          height: '{size}',
          className: '{className}',
        },
      },
      { componentName }
    );

    const tsxCode = jsCode
      // size prop 추가, 기본값 24
      .replace(
        /(const \w+) = \((props: SVGProps<SVGSVGElement>)\)/,
        '$1 = ({ size = 24, className, ...props }: SVGProps<SVGSVGElement> & { size?: number | string; className?: string })'
      )
      // className이 있으면 currentColor 사용, 없으면 원본 색상 유지
      .replace(
        /fill: "(#[0-9A-Fa-f]+)"/g,
        'fill: className ? "currentColor" : "$1"'
      )
      .replace(
        /stroke: "(#[0-9A-Fa-f]+)"/g,
        'stroke: className ? "currentColor" : "$1"'
      );

    fs.writeFileSync(outputPath, tsxCode, 'utf8');
    return { componentName, fileName: sanitizedFileName };
  } catch (error) {
    console.error(`Error converting ${svgPath}:`, error);
    return null;
  }
}

async function batchConvert() {
  try {
    console.log('SVG 파일을 React 컴포넌트로 변환 시작...');
    ensureDirectoryExists(OUTPUT_DIR);

    const DIST_DIR = path.join(__dirname, '../dist');
    ensureDirectoryExists(DIST_DIR);

    const svgFiles = (await glob.glob('**/*.svg', { cwd: SOURCE_DIR })).sort();
    console.log(`${svgFiles.length}개의 SVG 파일을 찾았습니다.`);

    const iconMetadata = [];

    for (const svgFile of svgFiles) {
      const svgPath = path.join(SOURCE_DIR, svgFile);
      const relativePath = path.dirname(svgFile);
      const outputDir = path.join(OUTPUT_DIR, relativePath);
      ensureDirectoryExists(outputDir);

      const baseName = path.basename(svgFile, '.svg');
      const sanitizedBaseName = sanitizeFileName(baseName);
      const outputPath = path.join(outputDir, `${sanitizedBaseName}.tsx`);
      const result = await convertSvgToReact(svgPath, outputPath);

      if (result) {
        iconMetadata.push({
          ...result,
          category: relativePath,
          path: path.join(relativePath, sanitizedBaseName)
        });
      }
    }

    iconMetadata.sort((a, b) => a.path.localeCompare(b.path));
    fs.writeFileSync(
      path.join(DIST_DIR, 'metadata.json'),
      JSON.stringify(iconMetadata, null, 2),
      'utf8'
    );

    console.log(`${iconMetadata.length}개의 아이콘이 변환되었습니다.`);
  } catch (error) {
    console.error('변환 중 오류 발생:', error);
    process.exit(1);
  }
}

batchConvert();
```

여기서 몇 가지 설계 의도가 있다.

SVGR 설정에서 `typescript: true`를 켜서 `.tsx`로 바로 생성되게 했고, `svgProps`에 `width`와 `height`를 `{size}`로 바인딩해서 `<IconHome size={32} />` 처럼 쓸 수 있게 했다.

색상 제어가 좀 고민이었는데, 결국 `className` prop의 유무로 분기하는 방식을 택했다. className이 전달되면 `currentColor`를 쓰고(Tailwind의 `text-red-500` 같은 클래스로 색상 제어 가능), 전달되지 않으면 SVG 원본 색상을 그대로 유지한다.

그리고 `metadata.json`이 중요하다. 각 아이콘의 컴포넌트 이름, 원본 파일명, 생성 경로, 카테고리(원본 SVG의 폴더 경로) 정보를 전부 담아둔다. 이 파일이 이후 패키징 단계에서 핵심 역할을 한다.

### 4. 2단계: TypeScript 컴파일

`.tsx` 파일이 생성되었으니 이걸 `.js`와 `.d.ts`로 컴파일해야 한다. 그런데 아이콘이 수천 개가 넘어가면 `tsc`를 한 번에 돌릴 때 메모리가 터진다. 실제로 OOM(Out of Memory) 에러를 몇 번이나 만났다.

해결 방법은 카테고리(스타일) 폴더별로 나눠서 순차 컴파일하는 것이었다.

```javascript
// scripts/compile-all.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    console.log(`실행 명령: ${command} ${args.join(' ')}`);
    const childProcess = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' }
    });

    childProcess.on('close', (code) => {
      if (code === 0) {
        console.log('프로세스 정상 종료');
        global.gc && global.gc();
        setTimeout(() => resolve(), 1000);
      } else {
        console.error(`프로세스 오류 코드 ${code}로 종료`);
        setTimeout(() => resolve(), 1000);
      }
    });

    childProcess.on('error', (error) => {
      console.error('프로세스 실행 중 오류:', error);
      setTimeout(() => resolve(), 1000);
    });
  });
}

async function compileTypeScript() {
  try {
    console.log('TypeScript 컴파일 시작...');

    const GENERATED_DIR = path.join(__dirname, '../src/generated');
    const TEMP_TSCONFIG = path.join(__dirname, '../temp-tsconfig.json');
    const tsconfig = require('../tsconfig.json');

    const categories = fs.readdirSync(GENERATED_DIR, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    console.log(`${categories.length}개의 카테고리를 찾았습니다.`);

    for (const category of categories) {
      console.log(`"${category}" 카테고리 컴파일 중...`);

      // 해당 카테고리만 include하는 임시 tsconfig 생성
      const tempConfig = {
        ...tsconfig,
        include: [`src/generated/${category}/**/*.tsx`]
      };

      fs.writeFileSync(TEMP_TSCONFIG, JSON.stringify(tempConfig, null, 2));

      try {
        await runProcess('pnpm', ['tsc', '--project', 'temp-tsconfig.json']);
        console.log(`"${category}" 카테고리 컴파일 완료`);
      } catch (error) {
        console.error(`"${category}" 카테고리 컴파일 중 오류:`, error);
      }

      // 다음 카테고리 전에 잠깐 대기 (메모리 안정화)
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (fs.existsSync(TEMP_TSCONFIG)) {
      fs.unlinkSync(TEMP_TSCONFIG);
    }

    console.log('TypeScript 컴파일 완료');
  } catch (error) {
    console.error('TypeScript 컴파일 중 오류:', error);
    process.exit(1);
  }
}

process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --expose-gc`;
compileTypeScript();
```

핵심 아이디어는 원본 `tsconfig.json`을 기반으로, `include` 경로만 현재 카테고리 폴더로 제한한 임시 tsconfig 파일을 매번 새로 만들어서 `tsc`를 돌리는 것이다. 한 카테고리가 끝나면 GC를 돌리고 2초 정도 대기한 뒤 다음 카테고리로 넘어간다. 이렇게 하니 메모리 문제가 사라졌다.

이 단계까지 끝나면 `dist` 폴더에 이런 구조가 만들어진다.

```
dist/
├── lib/
│   ├── filled/
│   │   ├── arrows/
│   │   │   └── IconArrowLeft.js
│   │   └── ui/
│   │       └── IconHome.js
│   └── light/
│       └── ...
├── types/
│   ├── filled/
│   │   ├── arrows/
│   │   │   └── IconArrowLeft.d.ts
│   │   └── ui/
│   │       └── IconHome.d.ts
│   └── light/
│       └── ...
└── metadata.json
```

### 5. 3단계: 스타일별 패키지 분리

여기서부터가 진짜 본론이다. 컴파일된 결과물들을 스타일별 개별 NPM 패키지로 쪼개는 작업이다.

왜 하나의 패키지로 안 묶었냐면, 사용자가 `filled` 스타일 아이콘만 필요한데 `light`, `duotone` 등 전체 스타일을 설치할 이유가 없기 때문이다. 패키지를 분리하면 번들 크기를 줄일 수 있고, 관심사도 깔끔하게 나뉜다. 물론 전부 필요한 사용자를 위해 통합 패키지(`all`)도 함께 제공한다.

스타일 매핑은 이렇게 정의했다. 원본 SVG 폴더명과 패키지명 사이의 변환 테이블이다.

```javascript
const STYLE_MAPPINGS = {
  'filled': 'filled',
  'light': 'light',
  'regular': 'regular',
  'duotone': 'duotone',
  'sharp': 'sharp',
  'two tone': 'two-tone',
  // ... 필요한 만큼 추가
};
```

`build-packages.js` 스크립트가 하는 일을 순서대로 정리하면 이렇다.

1. `dist/metadata.json`을 읽는다.
2. 메타데이터의 `category` 필드(원본 SVG의 폴더 경로)를 기준으로 스타일별로 그룹핑한다.
3. 각 스타일에 대해:
   - `packages/{스타일명}` 폴더를 만든다.
   - 해당 스타일의 `package.json`을 동적으로 생성한다.
   - `dist/lib/{스타일}`과 `dist/types/{스타일}`의 파일을 패키지 내부 `dist/lib`과 `dist/types`로 복사한다.
   - 해당 스타일의 아이콘만 필터링한 `metadata.json`을 패키지 내부에 넣는다.
   - 템플릿 빌드 스크립트를 복사하고 실행하여 진입점 파일(index.js, index.mjs, index.d.ts)을 생성한다.
4. 마지막으로 모든 스타일을 포함하는 통합 패키지(`all`)를 만든다.

```javascript
// scripts/build-packages.js
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const STYLE_MAPPINGS = {
  'filled': 'filled',
  'light': 'light',
  'regular': 'regular',
  'duotone': 'duotone',
  'sharp': 'sharp',
  'two tone': 'two-tone',
};

const PACKAGES_DIR = path.join(__dirname, '../packages');
const DIST_DIR = path.join(__dirname, '../dist');

function getRootVersion() {
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')
  );
  return rootPkg.version;
}

function ensureDirectoryExists(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function copyDirectory(source, target) {
  ensureDirectoryExists(target);
  const files = fs.readdirSync(source);
  for (const file of files) {
    const sourcePath = path.join(source, file);
    const targetPath = path.join(target, file);
    if (fs.statSync(sourcePath).isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function runBuildScript(packageDir, style) {
  return new Promise((resolve) => {
    const buildScriptPath = path.join(packageDir, 'scripts', 'build.js');
    const packageName = STYLE_MAPPINGS[style] || path.basename(packageDir);

    const childProcess = spawn('node', [buildScriptPath, packageName], {
      cwd: packageDir,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' }
    });

    childProcess.on('close', () => {
      global.gc && global.gc();
      setTimeout(() => resolve(), 1000);
    });

    childProcess.on('error', (error) => {
      console.error('빌드 스크립트 실행 중 오류:', error);
      setTimeout(() => resolve(), 1000);
    });
  });
}

function createPackageJson(style) {
  const packageName = style
    ? `@my-scope/my-icons-${STYLE_MAPPINGS[style]}`
    : '@my-scope/my-icons';

  return {
    name: packageName,
    version: getRootVersion(),
    description: style ? `${style} 스타일 아이콘` : '전체 아이콘 통합 패키지',
    main: "dist/index.js",
    module: "dist/index.mjs",
    types: "dist/index.d.ts",
    files: ["dist"],
    sideEffects: false,
    license: "MIT",
    peerDependencies: {
      react: ">=16.8.0"
    }
  };
}
```

각 패키지의 `package.json`에서 `sideEffects: false`를 설정한 것이 중요하다. 이걸 해야 번들러가 트리쉐이킹을 제대로 수행해서, 실제로 import한 아이콘만 번들에 포함시킨다.

### 6. 4단계: 진입점 파일 자동 생성

각 패키지에는 사용자가 import할 수 있는 진입점 파일이 필요하다. `index.js`(CommonJS), `index.mjs`(ESM), `index.d.ts`(타입 정의) 세 가지다.

이 파일들을 생성하는 템플릿 스크립트가 `scripts/templates/` 안에 있다. `build-packages.js`가 이 템플릿들을 각 패키지의 `scripts/` 폴더로 복사한 뒤 실행하는 구조다.

ESM 진입점 생성 스크립트는 이렇게 생겼다.

```javascript
// scripts/templates/generate-esm.js
const fs = require('fs');
const path = require('path');

const packageDir = path.join(__dirname, '..');
const metadataPath = path.join(packageDir, 'dist', 'metadata.json');
const distDir = path.join(packageDir, 'dist');

const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

// 카테고리별 index.mjs 생성
const categories = {};
metadata.forEach(icon => {
  const category = icon.category;
  if (!categories[category]) categories[category] = [];
  categories[category].push(icon);
});

Object.entries(categories).forEach(([category, icons]) => {
  const categoryDir = path.join(distDir, category);
  fs.mkdirSync(categoryDir, { recursive: true });

  const exports = icons
    .map(icon => `export { default as ${icon.componentName} } from '../../lib/${icon.path}.js';`)
    .join('\n');

  fs.writeFileSync(path.join(categoryDir, 'index.mjs'), exports);
});

// 메인 index.mjs 생성
const mainExports = metadata
  .sort((a, b) => a.path.localeCompare(b.path))
  .map(icon => `export { default as ${icon.componentName} } from './lib/${icon.path}.js';`)
  .join('\n');

fs.writeFileSync(path.join(distDir, 'index.mjs'), mainExports);
```

CommonJS 진입점(`generate-index.js`)과 타입 정의 진입점(`generate-types.js`)도 같은 원리다. 다만 CommonJS는 `exports.ComponentName = require('./lib/path').default;` 형태로, 타입 정의는 `export { default as ComponentName } from './lib/path';` 형태로 생성한다.

이 과정을 거치면 각 패키지가 이런 구조를 갖게 된다.

```
packages/filled/
├── package.json
├── dist/
│   ├── index.js        # CommonJS 진입점
│   ├── index.mjs       # ESM 진입점
│   ├── index.d.ts      # 타입 정의 진입점
│   ├── lib/            # 컴파일된 .js 파일
│   ├── types/          # .d.ts 파일
│   ├── metadata.json
│   └── arrows/         # 카테고리별 하위 진입점
│       ├── index.js
│       ├── index.mjs
│       └── index.d.ts
└── scripts/
    └── (빌드 스크립트들)
```

사용자 입장에서는 이렇게 쓸 수 있다.

```typescript
// 패키지 전체에서 가져오기
import { IconArrowLeft, IconHome } from '@my-scope/my-icons-filled';

// 카테고리에서 가져오기 (더 세밀한 트리쉐이킹)
import { IconArrowLeft } from '@my-scope/my-icons-filled/arrows';
```

통합 패키지는 모든 스타일의 아이콘을 포함한다. 여기서는 루트 레벨의 진입점뿐 아니라 스타일별 네임스페이스 접근도 가능하도록 추가 진입점을 생성해준다.

```typescript
// 통합 패키지 사용
import { IconArrowLeft } from '@my-scope/my-icons';

// 통합 패키지에서 스타일별로 접근
import { IconArrowLeft } from '@my-scope/my-icons/filled';
```

통합 패키지의 진입점 생성 로직은 `build-packages.js`의 `createUnifiedPackage` 함수에서 처리한다. 스타일/카테고리별로 중첩된 폴더 구조를 만들고 각각에 index.js, index.mjs, index.d.ts를 생성한다.

### 7. 5단계: GitHub Actions로 자동 배포

패키지를 GitHub Packages에 배포하기로 했다. 먼저 `.npmrc` 파일로 레지스트리를 설정한다.

```
@my-scope:registry=https://npm.pkg.github.com/
//npm.pkg.github.com/:_authToken=${GH_PAT}
```

`@my-scope`로 시작하는 패키지는 GitHub Packages 레지스트리를 바라보게 된다. `GH_PAT`는 환경변수로 주입되는 인증 토큰이다.

로컬에서 수동 배포가 필요할 때를 위한 스크립트도 만들어뒀다.

```javascript
// scripts/publish-all.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PACKAGES_DIR = path.join(__dirname, '../packages');

async function publishAllPackages() {
  const packageDirs = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  console.log(`${packageDirs.length}개의 패키지를 배포합니다:`, packageDirs);

  for (const packageName of packageDirs) {
    const packageDir = path.join(PACKAGES_DIR, packageName);
    const packageJsonPath = path.join(packageDir, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      console.warn(`${packageName}: package.json이 없습니다. 건너뜁니다.`);
      continue;
    }

    try {
      console.log(`[${packageName}] 배포 중...`);
      execSync('pnpm publish --no-git-checks', {
        cwd: packageDir,
        stdio: 'inherit',
        env: { ...process.env }
      });
      console.log(`[${packageName}] 배포 완료`);
    } catch (error) {
      console.error(`[${packageName}] 배포 실패:`, error.message);
    }
  }
}

publishAllPackages();
```

`--no-git-checks` 옵션은 Git 저장소 상태(커밋되지 않은 변경사항 등)를 무시하고 배포를 진행하게 해준다. 빌드 과정에서 생성된 파일들이 Git에 커밋되어있지 않은 상태에서 배포해야 하기 때문이다.

GitHub Actions 워크플로우는 두 개의 잡으로 구성했다.

```yaml
# .github/workflows/release-package.yml
name: Release Packages

on:
  push:
    branches:
      - main

jobs:
  build-packages:
    runs-on: ubuntu-latest
    permissions:
      packages: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v3
        with:
          node-version: 16
          registry-url: https://npm.pkg.github.com/
      - uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Install dependencies
        run: pnpm install

      - name: Build packages
        run: pnpm build:packages

      - name: Upload packages artifact
        uses: actions/upload-artifact@v4
        with:
          name: packages
          path: packages/

  publish-packages:
    needs: build-packages
    runs-on: ubuntu-latest
    permissions:
      packages: write
      contents: read
    strategy:
      matrix:
        package:
          - 'all'
          - 'filled'
          - 'light'
          - 'regular'
          - 'duotone'
          - 'sharp'
          - 'two-tone'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v3
        with:
          node-version: 16
          registry-url: https://npm.pkg.github.com/
      - uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Install dependencies
        run: pnpm install

      - name: Download packages artifact
        uses: actions/download-artifact@v4
        with:
          name: packages
          path: packages/

      - name: Check if package exists
        id: check-package
        run: |
          if [ -d "packages/${{ matrix.package }}" ]; then
            echo "exists=true" >> $GITHUB_OUTPUT
          else
            echo "exists=false" >> $GITHUB_OUTPUT
          fi

      - name: Publish package
        if: steps.check-package.outputs.exists == 'true'
        run: |
          cd packages/${{ matrix.package }}
          pnpm publish --no-git-checks
        env:
          GH_PAT: ${{ secrets.GITHUB_TOKEN }}
```

`build-packages` 잡에서 전체 빌드를 수행하고, 결과물인 `packages/` 폴더를 아티팩트로 업로드한다. `publish-packages` 잡에서는 이 아티팩트를 받아서 각 패키지를 배포한다.

matrix 전략을 쓴 이유는 각 패키지의 배포를 병렬로 처리하기 위해서다. 패키지가 12개면 12개의 배포 작업이 동시에 돌아간다. 한 패키지의 배포가 실패해도 다른 패키지에 영향을 주지 않는다.

`secrets.GITHUB_TOKEN`은 GitHub Actions가 워크플로우 실행 시 자동으로 생성해주는 토큰이다. `permissions`에 `packages: write`만 설정해주면 별도의 PAT(Personal Access Token) 생성 없이도 GitHub Packages에 배포할 수 있다.

### 8. 버전 관리

모든 하위 패키지의 버전은 루트 `package.json`의 `version` 필드를 따라간다. `build-packages.js`의 `getRootVersion()` 함수가 루트 버전을 읽어서 각 패키지의 `package.json`에 주입하는 구조다.

배포 전에 버전을 올리는 방식은 여러 가지가 있다. 수동으로 `npm version patch`를 실행해도 되고, Husky의 pre-commit hook에서 자동으로 버전을 올리는 방식을 쓸 수도 있다. 어떤 방식이든 루트 `package.json`의 버전만 변경하면 하위 패키지들이 전부 따라온다.

### 9. 삽질 기록

이 시스템을 만들면서 겪은 문제들을 정리해둔다.

메모리 문제 — 처음에는 `tsc`로 전체 파일을 한 번에 컴파일하려고 했다. 아이콘이 3000개를 넘어가니 Node.js가 OOM으로 죽었다. 카테고리별 분할 컴파일로 해결했고, `--max-old-space-size=4096`과 `--expose-gc` 옵션을 붙여 GC를 명시적으로 호출하는 것도 도움이 됐다.

임시 tsconfig 경로 문제 — 임시 tsconfig 파일의 `include` 경로가 프로젝트 루트 기준인데, `tsc` 실행도 프로젝트 루트에서 해야 한다. 처음에 패키지 디렉토리에서 `tsc`를 돌리다가 파일을 못 찾는 문제를 겪었다.

ESM/CJS 이중 지원 — `package.json`의 `main`(CJS)과 `module`(ESM) 필드를 둘 다 제공해야 다양한 번들러와 환경에서 호환된다. `index.js`는 `require` 방식으로, `index.mjs`는 `export` 방식으로 생성하고, `types`에는 `index.d.ts`를 넣어야 한다.

GitHub Packages 인증 — `.npmrc`에 `_authToken=${GH_PAT}`로 환경변수를 바인딩해뒀는데, CI 환경에서 `GH_PAT`가 아니라 `NODE_AUTH_TOKEN`으로 넘어오는 경우가 있다. `actions/setup-node`의 `registry-url` 설정과 `.npmrc` 설정이 충돌하지 않도록 주의해야 한다.

### 10. 마무리

처음에는 "SVG를 컴포넌트로 쓰고 싶다"는 단순한 욕심에서 시작했는데, 결과적으로 SVG 변환, TypeScript 컴파일, 모노레포 패키징, GitHub Actions 자동 배포까지 이어지는 꽤 큰 시스템이 만들어졌다. 이제 디자이너가 새 아이콘을 넘기면, `src/icons`에 넣고 `main`에 푸시하기만 하면 된다. 나머지는 전부 자동이다.

물론 개선할 점은 남아있다. Rollup이나 esbuild로 번들링을 추가해서 패키지 크기를 더 줄일 수 있을 것이고, Changesets 같은 도구로 버전 관리를 더 체계적으로 할 수도 있다. React Native용 패키지를 별도로 만드는 것도 고려 중이다.

하지만 현재 상태만으로도 수작업으로 수백 개의 아이콘을 관리하던 때와 비교하면 생산성이 완전히 달라졌다. import 한 줄이면 타입 안전한 아이콘 컴포넌트를 쓸 수 있고, 새 아이콘 추가도 SVG 파일 하나 넣으면 끝이다.

이 글의 코드는 실제 프로덕션에서 돌아가고 있는 것을 일반화한 것이니, 그대로 따라해도 동작할 것이다. 다만 아이콘 수, 스타일 분류 체계, 패키지 스코프 같은 부분은 각자의 프로젝트에 맞게 조정이 필요하다.

Lesson Learned:

- 수천 개의 TypeScript 파일을 한 번에 컴파일하면 메모리가 터진다. 분할 컴파일이 답이다.
- `sideEffects: false`를 잊으면 트리쉐이킹이 안 된다.
- SVGR의 `currentColor` 처리는 className 유무로 분기하면 유연하게 쓸 수 있다.
- 모노레포에서 각 패키지의 버전을 루트에서 중앙 관리하면 배포 시 혼란이 줄어든다.
- GitHub Actions의 matrix 전략은 다수의 패키지를 병렬 배포할 때 유용하다.
- `secrets.GITHUB_TOKEN`에 `packages: write` 권한만 주면 PAT 없이도 GitHub Packages 배포가 가능하다.

# Reference
- https://react-svgr.com/docs/getting-started/
- https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry
- https://pnpm.io/workspaces

# 연결문서
- [SVG 아이콘 라이브러리를 React Native에서도 쓸 수 있게 만들기](/post/svg-aikon-raibeureorireul-react-nativeeseodo-sseul-su-itge-mandeulgi)
- [ESLint + Prettier + Husky 자동화 구성](/post/eslint-prettier-husky-jadonghwa-guseong)
- Husky를 활용한 HeadVer 버전 관리 - GitHub Actions에서 로컬 커밋 자동화로 이전
