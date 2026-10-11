# Mason의 기술 블로그

제품 개발에서 마주친 문제와 해결 과정, 기술 탐구와 프로젝트 기록을 모으는 개인 블로그입니다.

**[블로그 읽기 → kmsk99.github.io](https://kmsk99.github.io)**

## 이 저장소

Astro로 만든 블로그의 소스와 게시용 콘텐츠를 관리합니다. Obsidian에서 작성한 Markdown을 변환해 게시하고 GitHub Actions로 GitHub Pages에 배포합니다.

- 글·프로젝트·회고를 Astro content collection으로 관리
- Obsidian 위키 링크와 첨부 이미지를 웹 경로로 변환
- 카테고리 탐색, 사이트맵과 RSS 제공

## 로컬 실행

```sh
npm ci
npm run dev
```

개발 서버는 `http://localhost:4321`에서 열립니다.

```sh
npm run build
npm run preview
```

커밋된 `src/content/`만으로 빌드할 수 있어 원본 Obsidian 볼트는 필요하지 않습니다.

## 콘텐츠와 배포

| 경로 | 역할 |
| --- | --- |
| `src/content/` | 게시용 글·프로젝트·회고와 이미지 |
| `src/pages/` | 페이지와 라우팅 |
| `src/components/`, `src/layouts/` | 화면 구성 |
| `scripts/migrate-tech-blog.mjs` | Obsidian 원문 변환 |
| `docs/` | 콘텐츠 구조와 작성 지침 |

글 원본은 별도 Obsidian 볼트에서 관리합니다. 원문 수정 후 `npm run migrate:blog`로 게시용 콘텐츠를 다시 생성합니다. 이 명령은 기존 콘텐츠 디렉터리를 다시 채우므로, 일반적인 로컬 실행에는 필요하지 않습니다.

`main`에 push하면 [GitHub Actions](.github/workflows/deploy.yml)가 빌드하고 GitHub Pages에 배포합니다.

[콘텐츠 작업 흐름](docs/content-structure-workflow.md) · [글쓰기 원칙](docs/writing-style.md) · [카테고리](docs/blog-categories.md)
