# kmsk99 기술 블로그 & 포트폴리오

Obsidian에서 작성한 Markdown을 그대로 받아 Astro로 빌드해 GitHub Pages로 배포하는 개인 기술 블로그/포트폴리오입니다. 글과 이미지를 한 폴더 단위로 관리하고, 필요 시 React 컴포넌트를 부분적으로 사용하는 구성을 지향합니다.

- 배포: https://kmsk99.github.io (Astro 5 + GitHub Pages)
- 콘텐츠 원본: 볼트(mason-atlas)의 `wiki/projects/personal/tech-blog/notes/` → `scripts/migrate-tech-blog.mjs` → `src/content/`
- 주요 카테고리: Tech Deep Dive, Project Showcase, Tech Pulse, Dev Hacks, Troubleshooter's Corner, Retrospectives

> **글 원본은 이 저장소에 없습니다.** 2026-08-20 에 원본을 볼트(mason-atlas)로 일원화하고
> 이 저장소에서는 `notes/` 를 제거했습니다. `src/content/` 는 마이그레이션 산출물이며,
> GitHub Pages 배포는 커밋된 `src/content/` 만으로 돌아가므로 볼트 없이도 빌드됩니다.
> 글을 고치려면 볼트의 노트를 고치고 `npm run migrate:blog` 를 다시 실행하세요.

## 주요 특징
- Markdown 중심: `src/content/posts|projects|retrospectives`가 Astro content collection으로 관리됩니다.
- 이미지/링크 자동 정리: Obsidian 위키 링크(`[[...]]`)와 첨부 이미지를 build-friendly 경로로 변환하는 마이그레이션 스크립트 제공.
- 검색/내비게이션 친화: 카테고리별 목록 페이지, 상세 페이지, 페이징이 기본 포함.
- SEO 기본값: `@astrojs/sitemap`으로 사이트맵 자동 생성, `site` 설정 완료.
- 위키 링크 지원: 커스텀 `remarkWikiLinks` 플러그인으로 내부 링크 변환.

## 요구 사항
- Node.js 20 LTS 권장 (Astro 5는 Node 18+ 필요)
- npm 10+ (권장)

## 빠른 시작
```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # dist 생성
npm run preview  # 로컬 프리뷰
npm run migrate:blog  # Obsidian 노트를 content collection으로 변환
```

## 폴더 구조 요약
```text
/
├─ docs/                # 구조/카테고리/문체 메모
├─ public/              # 정적 자산 (favicon, robots.txt 등)
├─ scripts/
│  └─ migrate-tech-blog.mjs  # 노트 → content 자동화 스크립트
├─ src/
│  ├─ content/
│  │  ├─ posts/            # Tech Deep Dive, Dev Hacks, Tech Pulse, Troubleshooter's Corner 등
│  │  ├─ projects/         # Project Showcase
│  │  ├─ retrospectives/   # 회고
│  │  └─ assets/           # 마이그레이션된 이미지
│  ├─ pages/               # index, posts, post/[slug], projects, retrospectives, about
│  ├─ components/          # Header, Footer, PostCard, Sidebar, Pagination 등
│  ├─ layouts/             # Base/Post/Project/Retrospective 레이아웃
│  └─ plugins/remarkWikiLinks.ts
└─ astro.config.mjs
```

## 콘텐츠 작성 가이드
### 바로 작성하는 경우
1) 위치  
   - 블로그 글: `src/content/posts/<카테고리>/slug.md`  
   - 프로젝트: `src/content/projects/Project-Showcase/slug.md`  
   - 회고: `src/content/retrospectives/<분류>/slug.md`
2) 프론트매터(필수/선택)  
   - `title`(필수), `created`(필수), `modified?`, `tags?`, `summary?`
3) 이미지  
   - `src/content/assets/`에 파일을 두고 본문에서는 `../../assets/파일명`으로 참조.

### Obsidian에서 마이그레이션하는 경우
1) 노트 위치 (볼트 `mason-atlas` 안, `$VAULT_ROOT` 기본값은 `~/mason-atlas`)  
   - 블로그: `wiki/projects/personal/tech-blog/notes/blog/<카테고리>/<글>.md`  
   - 프로젝트: `wiki/projects/personal/tech-blog/notes/project/Project Showcase/<글>.md`  
   - 회고: `wiki/projects/personal/tech-blog/notes/retrospectives/<분류>/<글>.md`
2) 첨부 이미지  
   - 볼트의 `_attachments/` (스크립트가 여기서 복사)  
   - 볼트가 다른 곳에 있으면: `VAULT_ROOT=/path/to/mason-atlas npm run migrate:blog`  
3) 변환 실행  
   ```bash
   npm run migrate:blog
   ```  
   - 기존 `src/content/{posts,projects,retrospectives,assets}`를 비운 뒤 다시 채웁니다.  
   - 위키 링크(`[[...]]`)는 slug로 매핑, 내부 이미지 링크는 `assets/<해시>-<파일>`로 교체됩니다.

## 라우팅
- `/` : 홈 (최근 포스트/프로젝트 하이라이트)
- `/posts` : 블로그 목록 (카테고리/페이징)
- `/post/:slug` : 글 상세
- `/projects` : 프로젝트 목록
- `/retrospectives` : 회고 목록
- `/about` : 소개

## 배포/운영
- `astro.config.mjs`의 `site`가 `https://kmsk99.github.io`로 설정되어 있으니 GitHub Pages 기본 플로우에 맞춰 빌드 아티팩트를 배포합니다.
- GitHub Actions 혹은 로컬에서 `npm run build` 후 `dist/`를 Pages 브랜치로 업로드하면 됩니다.

## 참고 메모
- `docs/structure.md` : 전체 디렉터리/운영 흐름 요약
- `docs/기술블로그 개략.md` : 콘텐츠 전략 및 관리 원칙
- `docs/기술 블로그 구조와 카테고리.md` : 카테고리 제안/설명
