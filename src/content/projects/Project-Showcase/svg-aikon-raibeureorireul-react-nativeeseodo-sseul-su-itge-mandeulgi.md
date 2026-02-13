---
tags:
  - Engineering
  - TypeScript
  - Monorepo
  - Automation
  - GitHubActions
  - ReactNative
  - Packaging
created: '2025-06-21 03:38'
modified: '2026-02-13 12:00'
title: SVG 아이콘 라이브러리를 React Native에서도 쓸 수 있게 만들기
---

[이전 글](/post/svg-aikoneul-react-keomponeonteu-raibeureoriro-mandeureo-jadong-baepohagi)에서 구매한 SVG 아이콘을 React 컴포넌트 라이브러리로 만들어 자동 배포하는 시스템을 구축했다. 웹 프로젝트에서는 이걸로 충분했는데, 문제가 하나 더 있었다. 우리 팀은 React Native 앱도 운영하고 있었다.

React Native에서는 웹용 React 컴포넌트를 그대로 쓸 수 없다. `<svg>`, `<path>` 같은 HTML 엘리먼트가 존재하지 않기 때문이다. React Native에서 SVG를 렌더링하려면 `react-native-svg` 라이브러리의 `<Svg>`, `<Path>` 같은 네이티브 컴포넌트를 써야 한다. 결국 웹용으로 만들어둔 아이콘 라이브러리와는 별개로, React Native 전용 패키지를 새로 만들어야 했다.

다행히 이전에 구축해둔 빌드 파이프라인의 구조를 거의 그대로 재활용할 수 있었다. 달라지는 부분만 정확히 짚어서 수정하면 됐다. 이 글은 그 차이점을 중심으로 기록한다.

---

### 1. 웹 버전과 뭐가 다른가

전체 파이프라인의 흐름은 동일하다. SVG 변환 → TypeScript 컴파일 → 모노레포 패키징 → GitHub Actions 자동 배포. 하지만 세부 설정에서 차이가 있다.

| 항목 | React (웹) | React Native |
| --- | --- | --- |
| SVG 렌더링 | 브라우저 내장 SVG | `react-native-svg` |
| SVGR 옵션 | `native: false` | `native: true` |
| 색상 제어 | `className` + `currentColor` | `color` prop 직접 전달 |
| JSX 모드 (tsconfig) | `"jsx": "react"` | `"jsx": "react-native"` |
| 타입 기반 | `SVGProps<SVGSVGElement>` | `SvgProps` (react-native-svg) |
| peerDependencies | `react` | `react`, `react-native`, `react-native-svg` |
| DOM API | 사용 | 사용 불가 |

핵심은 SVGR의 `native: true` 옵션이다. 이걸 켜면 SVGR이 `<svg>` 대신 `<Svg>`, `<path>` 대신 `<Path>`를 사용하는 코드를 생성해준다. 그리고 import도 `react-native-svg`에서 가져오도록 자동으로 바뀐다.

### 2. 프로젝트 세팅

별도의 Git 저장소로 분리했다. 웹 버전과 React Native 버전이 같은 저장소에 있으면 빌드 스크립트가 꼬이고, 의존성도 섞여서 관리가 힘들어진다.

```json
{
  "name": "@my-scope/my-native-icons",
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
    "@svgr/babel-plugin-transform-react-native-svg": "^8.1.0",
    "@svgr/core": "^8.1.0",
    "@svgr/plugin-jsx": "^8.1.0",
    "@svgr/plugin-svgo": "^8.1.0",
    "@types/react": "^19.1.8",
    "glob": "^11.0.3",
    "react": "^19.1.0",
    "react-native-svg": "^15.12.0",
    "typescript": "^5.8.3"
  },
  "peerDependencies": {
    "react": ">=16.8.0",
    "react-native": ">=0.60.0",
    "react-native-svg": ">=12.0.0"
  }
}
```

웹 버전과 비교했을 때 달라진 의존성은 두 가지다.

- `@svgr/babel-plugin-transform-react-native-svg` — SVGR이 React Native 용 SVG 컴포넌트를 생성할 때 필요한 Babel 플러그인이다.
- `react-native-svg` — 생성된 컴포넌트가 import하는 대상이므로, 개발 의존성과 peer 의존성 모두에 넣어줘야 한다.

그리고 `.svg` 파일에 대한 TypeScript 타입 선언도 추가했다.

```typescript
// declarations.d.ts
declare module "*.svg" {
  import React from 'react';
  import { SvgProps } from 'react-native-svg';

  const content: React.FC<SvgProps>;
  export default content;
}
```

### 3. tsconfig.json 변경

```json
{
  "compilerOptions": {
    "target": "es2017",
    "module": "esnext",
    "lib": ["es2017", "es2018", "es2019", "es2020"],
    "declaration": true,
    "declarationDir": "./dist/types",
    "jsx": "react-native",
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist/lib",
    "rootDir": "./src/generated",
    "strict": true,
    "resolveJsonModule": true,
    "noImplicitAny": false,
    "noImplicitReturns": true
  },
  "include": ["src/generated/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

웹 버전과 비교해서 바뀐 부분을 정리하면 이렇다.

`"jsx": "react-native"` — 가장 중요한 변경이다. 웹에서는 `"react"`를 썼는데, React Native에서는 `"react-native"`로 바꿔야 한다. 이 설정은 JSX를 `React.createElement` 호출로 변환하되, React Native 런타임에 맞는 방식으로 처리하게 해준다.

`"lib"` — DOM 관련 타입(`"dom"`, `"dom.iterable"`)을 전부 제거했다. React Native에는 브라우저 DOM이 없으므로 이 타입이 들어가 있으면 `document`, `window` 같은 것들이 타입 체크를 통과해버려서 런타임 에러의 원인이 될 수 있다. ES 스펙 타입만 남겨뒀다.

`"target": "es2017"` — 웹에서는 `"es2015"`를 썼는데, React Native 환경은 JavaScriptCore(또는 Hermes) 엔진이 돌아가므로 좀 더 최신 스펙을 타겟으로 잡아도 된다.

### 4. SVG 변환 스크립트: 핵심 차이

`batch-convert.js`의 전체 구조는 웹 버전과 동일하다. `@svgr/core`의 `transform` 함수로 SVG를 React 컴포넌트로 변환하고, 후처리로 props를 주입하는 방식이다. 달라지는 건 SVGR 옵션과 후처리 로직이다.

```javascript
// scripts/batch-convert.js (React Native 버전 — 변경된 부분만 발췌)

async function convertSvgToReact(svgPath, outputPath) {
  try {
    const svgCode = fs.readFileSync(svgPath, 'utf8');
    const fileName = path.basename(svgPath, '.svg');
    const sanitizedFileName = sanitizeFileName(fileName);

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
        native: true,  // React Native 모드 활성화
        svgProps: {
          width: '{size}',
          height: '{size}',
        },
        // className은 없다. RN에는 CSS 클래스 개념이 없기 때문.
      },
      { componentName }
    );

    const tsxCode = jsCode
      // props 타입을 SvgProps(react-native-svg)로 확장
      .replace(
        /(const \w+) = \((props: SvgProps)\)/,
        '$1 = ({ size = 24, color, ...props }: SvgProps & { size?: number | string; color?: string })'
      )
      // xmlns 속성 제거 (React Native SVG에서는 불필요)
      .replace(
        /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g,
        ''
      )
      // fill/stroke 색상을 color prop으로 동적 제어
      .replace(
        /fill="(#[0-9A-Fa-f]+)"/g,
        'fill={color || "$1"}'
      )
      .replace(
        /stroke="(#[0-9A-Fa-f]+)"/g,
        'stroke={color || "$1"}'
      );

    fs.writeFileSync(outputPath, tsxCode, 'utf8');
    return { componentName, fileName: sanitizedFileName };
  } catch (error) {
    console.error(`Error converting ${svgPath}:`, error);
    return null;
  }
}
```

웹 버전과의 차이를 하나씩 짚어보면 이렇다.

`native: true` — SVGR에게 React Native용 코드를 생성하라고 지시한다. 이 옵션 하나로 `<svg>` → `<Svg>`, `<path>` → `<Path>`, `<circle>` → `<Circle>` 등의 변환이 자동으로 이뤄지고, import 구문도 `import Svg, { Path, Circle, ... } from 'react-native-svg'`로 생성된다.

`className` 제거 — React Native에는 CSS 클래스라는 개념이 없다. 웹에서는 `className` prop으로 Tailwind 같은 유틸리티 클래스를 통해 색상을 제어했는데, RN에서는 직접 `color` prop을 받아서 처리해야 한다.

색상 제어 방식 변경 — 웹에서는 `className`의 유무로 `currentColor`와 원본 색상을 분기했다. RN에서는 더 직관적으로, `color` prop이 전달되면 그 색상을, 아니면 SVG 원본 색상을 사용하도록 했다.

```typescript
// 웹 버전 (className 기반)
fill={className ? "currentColor" : "#1C274C"}

// React Native 버전 (color prop 기반)
fill={color || "#1C274C"}
```

`xmlns` 속성 제거 — 웹 SVG에서는 `xmlns="http://www.w3.org/2000/svg"` 네임스페이스 선언이 필요하지만, `react-native-svg`의 `<Svg>` 컴포넌트에서는 불필요하다. 오히려 있으면 경고가 뜨는 경우도 있어서 정규식으로 제거해줬다.

props 타입 — 웹에서는 `SVGProps<SVGSVGElement>`를 기반으로 확장했지만, RN에서는 `react-native-svg`가 제공하는 `SvgProps`를 기반으로 한다.

최종적으로 생성되는 컴포넌트의 모습은 이렇게 다르다.

```tsx
// 웹 버전 — 생성 결과
import * as React from "react";
import { SVGProps } from "react";

const IconHome = ({ size = 24, className, ...props }: SVGProps<SVGSVGElement> & { size?: number | string; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...props}>
    <path fill={className ? "currentColor" : "#1C274C"} d="M12 2L3 9v12h18V9L12 2z" />
  </svg>
);

export default IconHome;
```

```tsx
// React Native 버전 — 생성 결과
import * as React from "react";
import Svg, { Path } from "react-native-svg";
import type { SvgProps } from "react-native-svg";

const IconHome = ({ size = 24, color, ...props }: SvgProps & { size?: number | string; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...props}>
    <Path fill={color || "#1C274C"} d="M12 2L3 9v12h18V9L12 2z" />
  </Svg>
);

export default IconHome;
```

### 5. 컴파일과 패키징

`compile-all.js`와 `build-packages.js`는 웹 버전과 사실상 동일하다. tsconfig.json 설정이 바뀌었으니 컴파일 결과물이 React Native에 맞게 나올 뿐, 카테고리별 분할 컴파일 전략이나 모노레포 패키징 로직은 그대로 재활용했다.

패키지별 `package.json`에서 달라지는 부분은 `peerDependencies`뿐이다.

```javascript
// build-packages.js — createPackageJson 함수 (변경 부분)
function createPackageJson(style) {
  const packageName = style
    ? `@my-scope/my-native-icons-${STYLE_MAPPINGS[style]}`
    : '@my-scope/my-native-icons';

  return {
    name: packageName,
    version: getRootVersion(),
    description: style ? `${style} 스타일 React Native 아이콘` : '전체 React Native 아이콘 통합 패키지',
    main: "dist/index.js",
    module: "dist/index.mjs",
    types: "dist/index.d.ts",
    files: ["dist"],
    sideEffects: false,
    license: "MIT",
    peerDependencies: {
      "react": ">=16.8.0",
      "react-native": ">=0.60.0",
      "react-native-svg": ">=12.0.0"
    }
  };
}
```

`react-native`과 `react-native-svg`를 peerDependencies에 추가한 것이 핵심이다. 이 패키지를 설치하는 프로젝트에서 이 두 라이브러리를 직접 설치해야 한다는 것을 명시하는 것이다.

### 6. GitHub Actions 워크플로우

워크플로우 구조도 웹 버전과 동일하다. build 잡에서 패키지를 빌드하고 아티팩트로 올린 뒤, publish 잡에서 matrix 전략으로 각 패키지를 병렬 배포한다.

```yaml
name: Release React Native Icon Packages

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
        package: ['all', 'filled', 'light', 'regular', 'duotone', 'sharp', 'two-tone']
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

달라진 건 워크플로우 이름 정도다. 빌드 파이프라인 자체는 `pnpm build:packages` 한 줄이면 되니, CI/CD 설정을 따로 손볼 것이 거의 없었다.

### 7. 사용 방법

React Native 프로젝트에서 설치하고 쓰는 방법이다.

```bash
# react-native-svg가 먼저 설치되어 있어야 한다
pnpm add react-native-svg

# 아이콘 패키지 설치 (filled 스타일 예시)
pnpm add @my-scope/my-native-icons-filled
```

```tsx
import { IconHome, IconArrowLeft } from '@my-scope/my-native-icons-filled';

function Header() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <IconArrowLeft size={20} color="#333" />
      <Text>홈</Text>
      <IconHome size={24} color="#007AFF" />
    </View>
  );
}
```

웹 버전에서 `className`으로 색상을 제어하던 것 대신, `color` prop으로 직접 지정한다. `size` prop은 동일하게 동작한다.

### 8. 삽질 기록

웹 버전을 React Native로 포팅하면서 겪은 문제들이다.

`react-native-svg` 버전 호환 — `react-native-svg`는 메이저 버전마다 API가 꽤 바뀐다. peerDependencies를 `>=12.0.0`으로 넉넉하게 잡았는데, 실제로는 12.x와 15.x에서 일부 props의 동작이 달랐다. 하위 호환이 필요하다면 peerDependencies 범위를 좁히거나, 버전별 분기 처리를 고려해야 한다.

`xmlns` 속성 경고 — SVGR이 생성한 코드에 `xmlns` 속성이 남아있으면, React Native에서 `Unknown prop xmlns` 경고가 뜬다. 정규식으로 제거하는 후처리를 추가해서 해결했다. 사소하지만 빼먹기 쉬운 부분이다.

tsconfig의 `lib` 설정 — 처음에 웹 버전의 tsconfig를 그대로 복사해서 썼더니 `"dom"` 타입이 포함되어 있었다. 컴파일은 문제없이 되지만, 코드 어딘가에서 `document`나 `window`를 참조하는 실수를 타입 체커가 잡아주지 못하게 된다. React Native 전용 패키지에서는 DOM 타입을 반드시 빼야 한다.

`currentColor` 미지원 — 웹 SVG에서는 `currentColor`가 부모 요소의 `color` CSS 속성을 상속받는 편리한 기능인데, React Native에서는 이 개념이 없다. `react-native-svg`가 `currentColor`를 일부 지원하긴 하지만 동작이 일관적이지 않아서, 명시적으로 `color` prop을 받아서 넘기는 방식으로 구현하는 게 안전하다.

### 9. 마무리

결과적으로 웹 버전의 빌드 시스템을 거의 그대로 재활용하면서, SVGR 옵션(`native: true`), tsconfig 설정(`jsx`, `lib`), 색상 제어 방식(`className` → `color`), peerDependencies 세 가지만 바꿔서 React Native 전용 패키지를 만들 수 있었다. 빌드 파이프라인의 구조를 처음부터 일반적으로 설계해뒀던 게 여기서 빛을 발했다.

이제 웹과 React Native 양쪽 모두에서 `import { IconHome } from '@my-scope/...'` 한 줄이면 타입 안전한 아이콘 컴포넌트를 쓸 수 있다. 새 아이콘이 추가되면 SVG 파일을 `src/icons`에 넣고 `main`에 푸시하면 된다. 플랫폼별로 두 개의 저장소에서 각각 GitHub Actions가 돌아가면서 자동 배포까지 처리해준다.

Lesson Learned:

- SVGR의 `native: true` 옵션 하나로 `<svg>` → `<Svg>`, `<path>` → `<Path>` 변환이 자동 처리된다.
- React Native에서는 `currentColor`에 의존하지 말고, 명시적인 `color` prop으로 색상을 제어하는 게 안전하다.
- tsconfig에서 DOM 타입(`"dom"`, `"dom.iterable"`)을 빼야 RN 환경에서의 실수를 타입 레벨에서 잡을 수 있다.
- `xmlns` 속성은 `react-native-svg`에서 불필요하다. 후처리로 제거해줘야 경고가 안 뜬다.
- 빌드 파이프라인을 플랫폼에 독립적으로 설계해두면, 새 플랫폼 지원 시 변환/설정 레이어만 교체하면 된다.

# Reference
- https://react-svgr.com/docs/react-native/
- https://github.com/software-mansion/react-native-svg
- https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry

# 연결문서
- [SVG 아이콘을 React 컴포넌트 라이브러리로 만들어 자동 배포하기](/post/svg-aikoneul-react-keomponeonteu-raibeureoriro-mandeureo-jadong-baepohagi)
