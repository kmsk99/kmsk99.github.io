# Astro 포트폴리오/블로그 구조 요약

이 저장소는 Obsidian에서 작성한 Markdown을 그대로 활용해 Astro로 배포하기 위한 최소/확장 가능한 구조다. GitHub Pages 기준으로 설정되어 있으며, 프로젝트·포스트가 content collections로 관리된다.

## 디렉터리 개요
- `public/` : Astro가 가공하지 않는 정적 자산. `favicon.svg`, `robots.txt`, `CNAME`(커스텀 도메인 사용 시)만 둔다.
- `src/content/` : 모든 Markdown 콘텐츠.  
  - `projects/<project>/index.md` + 이미지: 포트폴리오 단위 묶음.  
  - `posts/*.md` : 기술 블로그.  
  - `config.ts` : content collection 스키마 정의.
- `src/pages/` : 라우팅. 인덱스/리스트/슬러그 페이지 자동 생성.
- `src/layouts/` : 페이지 레벨 UI 골격(Base/Project/Post).
- `src/components/` : Header/Footer/Card 등 재사용 UI.
- `src/styles/` : 전역/테마 CSS.

## 사용법 메모
1) 새 프로젝트 추가  
`src/content/projects/new-project/` 생성 후 `index.md` 작성(필요 이미지 동폴더).  
2) 새 포스트 추가  
`src/content/posts/2025-new-post.md` 추가.  
3) 빌드/배포  
`npm run build` → `dist` 생성. GitHub Actions 또는 Pages에 연결.  

Obsidian에서 작성 → Git push만 하면 빌드/배포가 이어지는 흐름을 목표로 한다.

