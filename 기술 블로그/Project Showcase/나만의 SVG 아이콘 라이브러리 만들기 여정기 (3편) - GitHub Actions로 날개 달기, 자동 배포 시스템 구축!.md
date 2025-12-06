---
tags:
  - Engineering
  - TechDeepDive
  - Monorepo
  - Automation
  - GitHubActions
  - Husky
  - React
  - Performance

created: 2025-06-21 03:41
modified: 2025-06-21 03:44
---
드디어 대망의 마지막 편입니다! 지난 1 편에서는 [SVG 파일을 React 컴포넌트로 만들고 컴파일하는 과정]([1편_링크_가상](https://velog.io/@kmsk99/%EB%82%98%EB%A7%8C%EC%9D%98-SVG-%EC%95%84%EC%9D%B4%EC%BD%98-%EB%9D%BC%EC%9D%B4%EB%B8%8C%EB%9F%AC%EB%A6%AC-%EB%A7%8C%EB%93%A4%EA%B8%B0-%EC%97%AC%EC%A0%95%EA%B8%B0-1%ED%8E%B8-React-%EC%BB%B4%ED%8F%AC%EB%84%8C%ED%8A%B8-%EB%B3%80%ED%99%98%EA%B3%BC-%EC%BB%B4%ED%8C%8C%EC%9D%BC-%EC%9E%90%EB%8F%99%ED%99%94)) 을, 2 편에서는 [컴파일된 결과물들을 스타일별로 나누어 모노레포 패키지로 만들고, 각 패키지에 필요한 진입점 파일들을 자동으로 생성하는 마법 같은 이야기](https://velog.io/@kmsk99/%EB%82%98%EB%A7%8C%EC%9D%98-SVG-%EC%95%84%EC%9D%B4%EC%BD%98-%EB%9D%BC%EC%9D%B4%EB%B8%8C%EB%9F%AC%EB%A6%AC-%EB%A7%8C%EB%93%A4%EA%B8%B0-%EC%97%AC%EC%A0%95%EA%B8%B0-2%ED%8E%B8-%EB%AA%A8%EB%85%B8%EB%A0%88%ED%8F%AC-%ED%8C%A8%ED%82%A4%EC%A7%95-%EB%A7%88%EB%B2%95%EA%B3%BC-%EC%A7%84%EC%9E%85%EC%A0%90-%ED%8C%8C%EC%9D%BC-%EC%9E%90%EB%8F%99-%EC%83%9D%EC%84%B1) 를 함께했습니다. 이제 우리 손에는 언제든 세상에 나갈 준비가 된, 반짝반짝 빛나는 아이콘 패키지들이 한가득이죠!

하지만 개발자의 여정은 여기서 끝이 아닙니다. 이 멋진 결과물들을 어떻게 하면 가장 효율적이고 안전하게 사용자들에게 전달할 수 있을까요? 바로 **' 배포 '** 라는 마지막 관문이 남았습니다. 물론 패키지가 한두 개라면 수동으로 할 수도 있겠지만, 저희처럼 여러 스타일의 패키지를 한 번에 관리하고 배포해야 한다면… 생각만 해도 아찔하죠? 😅

그래서 오늘은, " 나만의 SVG 아이콘 라이브러리 만들기 여정기 " 그 마지막 이야기로, **GitHub Actions 를 활용하여 이 모든 패키지들을 손쉽게, 그리고 ' 자동으로 ' 배포하는 시스템을 구축하는 과정**을 속 시원하게 공유해 드리려고 합니다. 이제 클릭 몇 번과 약간의 기다림만으로 여러분의 아이콘 라이브러리가 세상의 빛을 볼 수 있게 될 거예요!]]

### 배포, 어디에 어떻게 할까요? GitHub Packages 와 .npmrc 설정

배포할 곳은 여러 선택지가 있겠지만, 저희는 GitHub 저장소와 긴밀하게 연동되고, 특히 프라이빗 패키지 관리가 용이한 **GitHub Packages**를 선택했습니다. (물론 공개 NPM 레지스트리에 배포하는 것도 비슷한 원리로 가능합니다!)

GitHub Packages 에 배포하기 위해서는 먼저 우리 프로젝트가 GitHub Packages 레지스트리를 바라보도록 설정해주어야 합니다. 바로 `.npmrc` 파일을 통해서죠. 프로젝트 루트에 다음과 같이 `.npmrc` 파일을 만들어주세요.

```
@my-scope:registry=https://npm.pkg.github.com/
//npm.pkg.github.com/:_authToken=${GH_PAT}
```

*   `@my-scope:registry=…`: `@my-scope` 라는 이름으로 시작하는 패키지들 (예: `@my-scope/my-icons-filled`) 은 GitHub Packages 레지스트리에서 찾고, 또 그곳으로 배포하겠다는 의미입니다. 여러분의 GitHub 사용자명이나 조직 이름으로 `@my-scope` 를 대체해주세요.
*   `//npm.pkg.github.com/:_authToken=${GH_PAT}`: GitHub Packages 에 인증하기 위한 토큰 설정입니다. `GH_PAT` 는 GitHub Personal Access Token 을 의미하는 환경 변수 이름입니다. GitHub Actions 워크플로우에서는 `secrets.GITHUB_TOKEN` 이라는 특별한 토큰을 사용할 수도 있는데, 이 경우 해당 토큰에 `packages: write` 권한만 부여해주면 별도의 PAT 생성 없이도 배포가 가능합니다. (이 부분은 뒤에서 더 자세히 다룰게요!)

### 로컬에서도 자신 있게! `scripts/publish-all.js` (선택 사항)

자동 배포 시스템을 만들기 전에, 로컬 환경에서 모든 패키지를 한 번에 배포하거나 테스트해볼 수 있는 스크립트가 있다면 정말 유용하겠죠? 저희는 `scripts/publish-all.js` 라는 이름으로 이런 스크립트를 준비했습니다.

```javascript
// scripts/publish-all.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PACKAGES_DIR = path.join(__dirname, '../packages');

async function publishAllPackages() {
  try {
    console.log('모든 패키지 배포 시작...');
    const packageDirs = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    if (packageDirs.length === 0) {
      console.log('배포할 패키지가 없습니다.');
      return;
    }
    console.log(`${packageDirs.length}개의 패키지를 배포합니다:`, packageDirs);

    for (const packageName of packageDirs) {
      const packageDir = path.join(PACKAGES_DIR, packageName);
      // ... (package.json 존재 여부 확인 로직) ...
      try {
        console.log(`\n[${packageName}] 패키지 배포 중...`);
        // 여기서 GH_PAT 환경 변수가 설정되어 있어야 GitHub Packages에 인증 가능
        execSync('pnpm publish --no-git-checks', {
          cwd: packageDir,
          stdio: 'inherit',
          env: { ...process.env } // GH_PAT는 보통 쉘 환경에 미리 설정해둡니다.
        });
        console.log(`[${packageName}] 배포 완료!`);
      } catch (error) {
        console.error(`[${packageName}] 배포 실패:`, error.message);
        // 개별 패키지 실패 시 전체 중단 않도록 처리 (선택적)
      }
    }
    console.log('\n모든 패키지 배포 프로세스 완료!');
  } catch (error) {
    console.error('배포 중 오류 발생:', error);
    process.exit(1);
  }
}

publishAllPackages();
```
이 스크립트는 `packages` 폴더 안의 모든 하위 패키지 디렉토리로 이동하여 `pnpm publish --no-git-checks` 명령을 실행합니다. `--no-git-checks` 옵션은 Git 저장소의 상태 (예: 변경사항 커밋 여부) 를 확인하지 않고 바로 배포를 진행하도록 합니다. 로컬에서 `GH_PAT` 환경 변수를 설정하고 이 스크립트를 실행하면, 모든 패키지가 GitHub Packages 로 슝~ 하고 올라가게 됩니다. (물론, 실제 배포 전에는 버전을 신중하게 관리해야겠죠!)

루트 `package.json` 에는 이렇게 등록해두면 편리합니다.
```json
// 루트 package.json
{
  "scripts": {
    // ... 기존 빌드 스크립트들 ...
    "publish:all": "node scripts/publish-all.js"
  }
}
```

### GitHub Actions, 배포 자동화의 심장! (`.github/workflows/release.yml`)

자, 이제 오늘의 하이라이트, GitHub Actions 워크플로우를 살펴볼 시간입니다! 이 워크플로우 파일 (`.github/workflows/release.yml`) 이 바로 우리 아이콘 라이브러리를 자동으로 빌드하고 배포하는 심장 역할을 합니다.

```yaml
# .github/workflows/release.yml
name: Release Packages

on:
  push:
    branches:
      - main  # main 브랜치에 푸시될 때 실행
      - master # 또는 master 브랜치

jobs:
  build-packages: # 1. 패키지를 빌드하고 아티팩트로 만드는 잡
    runs-on: ubuntu-latest
    permissions:
      contents: read # 코드 체크아웃을 위한 읽기 권한
      # packages: write # 이 잡에서는 직접 배포하지 않으므로 필요 X
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v3
        with:
          node-version: 16 # 프로젝트에 맞는 노드 버전 사용
          # registry-url: https://npm.pkg.github.com/ # 이 잡에서는 불필요
      - uses: pnpm/action-setup@v2 # pnpm 사용 시
        with:
          version: 8 # pnpm 버전

      - name: Install dependencies
        run: pnpm install --frozen-lockfile # 의존성 설치

      - name: Build packages (from compiled files to package structure)
        run: pnpm build:packages # 2편에서 만든, packages/* 폴더를 생성하는 스크립트

      - name: Upload packages artifact
        uses: actions/upload-artifact@v4 # 빌드된 packages 폴더를 아티팩트로 업로드
        with:
          name: packages-dist # 아티팩트 이름
          path: packages/     # 업로드할 경로

  publish-packages: # 2. 빌드된 패키지들을 실제로 배포하는 잡
    needs: build-packages # build-packages 잡이 성공해야 실행됨
    runs-on: ubuntu-latest
    permissions:
      contents: read # 코드 체크아웃 (필요하다면)
      packages: write # GitHub Packages에 쓰기 위한 필수 권한!
    strategy:
      matrix: # 이 매트릭스에 배포할 패키지 이름을 나열합니다!
        package:
          # 사용자가 제공한 README의 패키지 목록을 참고하여 작성
          - 'all' # 통합 패키지
          - 'cute-filled'
          - 'cute-light'
          - 'cute-regular'
          - 'duotone'
          - 'filled'
          - 'light'
          - 'original'
          - 'original-mono'
          - 'regular'
          - 'sharp'
          - 'two-tone'
          # ... 여러분의 모든 개별 스타일 패키지 이름들
    steps:
      - uses: actions/checkout@v4 # 소스 코드가 필요하다면 체크아웃
      - uses: actions/setup-node@v3
        with:
          node-version: 16
          registry-url: https://npm.pkg.github.com/ # 배포할 레지스트리 명시!
      - uses: pnpm/action-setup@v2
        with:
          version: 8

      # `pnpm install`은 여기서 다시 할 필요가 없을 수도 있습니다.
      # `publish` 명령 자체가 패키지 내부의 prepublish 스크립트를 실행하기 때문입니다.
      # 만약 패키지 루트에서 실행해야 하는 스크립트가 있다면 필요할 수 있습니다.
      # 사용자 제공 코드에서는 `pnpm install`을 다시 하고 있으므로 일단 유지합니다.
      - name: Install dependencies (potentially for publish scripts)
        run: pnpm install --frozen-lockfile

      - name: Download packages artifact
        uses: actions/download-artifact@v4 # 이전 잡에서 업로드한 아티팩트 다운로드
        with:
          name: packages-dist # 아티팩트 이름 동일하게
          path: packages/     # 다운로드 받을 경로 (루트의 packages 폴더)

      - name: Check if package directory exists
        id: check_package_dir
        run: |
          if [ -d "packages/${{ matrix.package }}" ]; then
            echo "dir_exists=true" >> $GITHUB_OUTPUT
          else
            echo "dir_exists=false" >> $GITHUB_OUTPUT
            echo "Directory packages/${{ matrix.package }} not found!"
          fi

      - name: Publish package ${{ matrix.package }}
        if: steps.check_package_dir.outputs.dir_exists == 'true' # 해당 패키지 폴더가 있을 때만 실행
        working-directory: ./packages/${{ matrix.package }} # 해당 패키지 폴더로 이동
        run: pnpm publish --no-git-checks
        env:
          # 여기서 GITHUB_TOKEN을 사용합니다! .npmrc의 _authToken 변수와 연결됩니다.
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # 사용자 코드에서는 GH_PAT를 사용했지만, GITHUB_TOKEN 사용을 권장합니다.
          # 만약 GH_PAT를 계속 사용해야 한다면, secrets에 GH_PAT를 등록하고 아래처럼 사용합니다.
          # GH_PAT: ${{ secrets.GH_PAT_FOR_PUBLISH }}
```

이 워크플로우는 크게 두 개의 잡 (`build-packages` 와 `publish-packages`) 으로 나뉩니다.

*   **`build-packages` 잡:**
	1.  소스 코드를 체크아웃하고 Node.js 와 pnpm 환경을 설정합니다.
	2.  `pnpm install` 로 모든 의존성을 설치합니다. (루트 및 워크스페이스 패키지들)
	3.  `pnpm build:packages` 명령을 실행합니다. 이 명령은 2 편에서 만든 `scripts/build-packages.js` 를 실행하여, 컴파일된 결과물 (`dist/*`) 을 바탕으로 `packages` 폴더 안에 각 스타일별 하위 패키지들을 생성하고, 각 패키지 내부에 `dist` 폴더와 진입점 파일 (`index.js` 등) 을 채워 넣는 작업까지 완료합니다.
	4.  이렇게 완성된 `packages/` 폴더 전체를 `upload-artifact` 액션을 사용하여 아티팩트 (`packages-dist`) 로 업로드합니다. 아티팩트로 만들어두면 다음 잡에서 빌드 과정을 반복하지 않고 바로 결과물을 가져다 쓸 수 있어 효율적입니다.

*   **`publish-packages` 잡:**
	1.  `needs: build-packages` 설정을 통해 `build-packages` 잡이 성공적으로 끝나야만 실행됩니다.
	2.  `permissions: packages: write` 설정을 통해 이 잡이 GitHub Packages 에 패키지를 발행할 수 있는 권한을 갖도록 합니다. (이게 정말 중요해요!)
	3.  `strategy: matrix: package: […]` 부분이 핵심입니다! 여기에 배포하고 싶은 모든 패키지의 이름 (실제 `packages/` 폴더 아래의 디렉토리 이름) 을 나열하면, GitHub Actions 는 나열된 각 패키지에 대해 개별적인 배포 작업을 병렬 또는 순차적으로 실행합니다. 즉, 패키지가 10 개라면 10 개의 배포 작업이 자동으로 돌아가는 거죠! 정말 강력하지 않나요?
	4.  `download-artifact` 액션을 사용하여 이전 잡에서 업로드했던 `packages-dist` 아티팩트를 다시 `packages/` 경로로 다운로드합니다.
	5.  `Check if package directory exists`: 매트릭스로부터 받은 패키지 이름에 해당하는 디렉토리가 실제로 `packages/` 폴더 내에 존재하는지 확인합니다. (혹시 모를 오류 방지!)
	6.  `Publish package …`:
		*   `if: steps.check_package_dir.outputs.dir_exists == 'true'`: 해당 패키지 폴더가 존재할 때만 실행합니다.
		*   `working-directory: ./packages/${{ matrix.package }}`: 현재 작업 디렉토리를 배포할 패키지 (예: `packages/filled`) 로 변경합니다.
		*   `pnpm publish --no-git-checks`: 드디어 배포 명령 실행!
		*   `env: NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`: 이 부분이 인증의 핵심입니다. `.npmrc` 파일에 설정된 `_authToken` 변수에 GitHub Actions 가 자동으로 제공하는 `secrets.GITHUB_TOKEN` 값을 전달하여 GitHub Packages 에 인증합니다. 별도의 PAT 를 생성하고 `secrets` 에 등록할 필요 없이, `permissions` 설정만 잘 되어있다면 `GITHUB_TOKEN` 만으로도 충분합니다! (만약 `GH_PAT` 를 꼭 사용해야 한다면, GitHub 저장소의 `Settings > Secrets and variables > Actions` 에 해당 PAT 값을 시크릿으로 등록하고 `env: GH_PAT: ${{ secrets.MY_GH_PAT_SECRET_NAME }}` 처럼 사용해야 합니다.)

이제 `main` (또는 `master`) 브랜치에 코드를 푸시하기만 하면, 이 모든 과정이 자동으로 실행되어 여러분의 아이콘 패키지들이 GitHub Packages 에 착착 배포됩니다! 🎉

### 배포 후 확인: 내 아이콘, 잘 올라갔을까?

배포가 성공적으로 완료되면, GitHub 저장소 페이지의 오른쪽 사이드바에 있는 "Packages" 섹션에서 배포된 패키지들을 확인할 수 있습니다. 각 패키지를 클릭하면 버전 히스토리, 설치 방법 등 상세 정보도 볼 수 있죠.

버전 관리는 어떻게 할까요? 현재 설정된 스크립트 (`scripts/build-packages.js` 의 `getRootVersion` 및 `createPackageJsonContent` 함수) 를 보면, 모든 하위 패키지들은 루트 `package.json` 의 버전을 따라가도록 되어 있습니다. 따라서 배포 전에 루트 `package.json` 의 버전을 수동으로 올리거나, 저희가 이전에 다루었던 [HeadVer와 Husky를 이용한 버전 자동화](https://velog.io/@kmsk99/Husky%EB%A5%BC-%ED%99%9C%EC%9A%A9%ED%95%9C-HeadVer-%EB%B2%84%EC%A0%84-%EA%B4%80%EB%A6%AC-GitHub-Actions%EC%97%90%EC%84%9C-%EB%A1%9C%EC%BB%AC-%EC%BB%A4%EB%B0%8B-%EC%9E%90%EB%8F%99%ED%99%94%EB%A1%9C-%EC%9D%B4%EC%A0%84) 같은 시스템을 연동하여 커밋 시 자동으로 버전을 업데이트하고, 이 업데이트된 버전으로 배포되도록 구성할 수도 있습니다.

### 3 편을 마치며: 자동화된 아이콘 라이브러리, 이제 여러분의 손으로!

길고 길었던 " 나만의 SVG 아이콘 라이브러리 만들기 여정기 " 가 드디어 막을 내립니다. SVG 변환에서 시작하여 컴파일, 패키징, 그리고 오늘 함께한 자동 배포까지! 이제 여러분은 단순한 아이콘 파일 묶음이 아닌, 체계적으로 관리되고 손쉽게 배포할 수 있는 어엿한 아이콘 ' 라이브러리 ' 를 갖게 되셨습니다.

이 3 편의 시리즈가 여러분의 프로젝트에 조금이나마 영감을 주고, 반복적인 작업에서 벗어나 더 창의적인 일에 집중할 수 있도록 돕는 작은 불씨가 되었기를 바랍니다. 물론, 여기서 소개된 방법만이 정답은 아닙니다. 여러분의 상황과 취향에 맞게 얼마든지 변형하고 발전시킬 수 있다는 점을 기억해주세요!

혹시 이 과정에 대해 궁금한 점이나, " 저는 이렇게 더 멋지게 해봤어요!" 하는 경험이 있다면 언제든지 댓글로 공유해주세요. 함께 배우고 성장하는 것만큼 즐거운 일은 없으니까요. 😊

지금까지 긴 여정을 함께해주셔서 감사합니다! 이제 여러분도 멋진 아이콘 라이브러리를 만들어 세상에 선보이세요!

# Reference

# 연결문서
- [[ESLint·Prettier·Husky 자동화를 정착시키기까지]]
- [[Husky를 활용한 HeadVer 버전 관리 - GitHub Actions에서 로컬 커밋 자동화로 이전]]
- [[나만의 SVG 아이콘 라이브러리 만들기 여정기 (1편) - React 컴포넌트 변환과 컴파일 자동화]]
