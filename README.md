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

## 예약 발행

글 프론트매터에 `publishAt`(ISO 8601, 시간대 포함)을 넣는다.

```yaml
publishAt: "2026-11-13T09:00:00+09:00"
```

- **화면은 정시 공개**: 예약 글 페이지와 목록 항목은 미리 배포되고, 방문자 브라우저가 공개 시각 전에는 숨긴다. 글 페이지에는 "○월 ○일 오전 9:00에 공개됩니다" 안내가 보이고, 열어 둔 화면은 그 시각에 저절로 열린다. 공개 전 페이지에는 `noindex`가 붙는다.
- **검색엔진·구독은 빌드 기준**: RSS·사이트맵·검색창·지식 그래프·이전/다음 글·관련 글·개수는 공개 시각 이후 첫 빌드(`deploy.yml` 매시 정각 UTC 재빌드)에서 들어간다. GitHub 정기 실행은 수 분~수십 분 늦을 수 있다.
- 공개 저장소이고 페이지도 미리 배포되므로, 주소를 알면 페이지 소스에서 본문을 볼 수 있다. 화면 숨김은 보안 장치가 아니다.
- 자바스크립트가 꺼진 방문자에게는 다음 빌드 전까지 숨겨진다.
- 로컬에서 예약 글을 공개 상태로 보려면 `SHOW_SCHEDULED=1 npm run dev`.
- 형식이 잘못된 `publishAt`은 빌드를 실패시킨다.
