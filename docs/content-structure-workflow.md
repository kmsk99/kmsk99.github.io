# 콘텐츠 구조 & 운영 워크플로

## 전체 흐름
- Obsidian `notes/` 에서 작성 → `npm run migrate:blog`로 `src/content/`에 정리 → `npm run build`로 `dist/` 생성 → GitHub Pages 배포.
- 이미지/위키 링크를 자동 변환하므로 원본 노트 형식을 크게 바꿀 필요가 없습니다.

## 디렉터리 설명 (필요한 부분만)
- `notes/` : 작성 원본. 예) `notes/blog/<카테고리>/<글>.md`, `notes/project/Project Showcase/<글>.md`, `notes/retrospectives/<분류>/<글>.md`
- `scripts/migrate-tech-blog.mjs` : 노트 → content 변환 스크립트. 첨부 이미지는 `../../9.Settings/Attachments`에서 복사합니다.
- `src/content/`
  - `posts/<카테고리>/slug.md`
  - `projects/Project-Showcase/slug.md`
  - `retrospectives/<분류>/slug.md`
  - `assets/` : 변환된 이미지가 해시 프리픽스로 저장
- `src/pages/` : 라우트 (`/`, `/posts`, `/post/[slug]`, `/projects`, `/retrospectives`, `/about`)
- `src/components/`, `src/layouts/`, `src/plugins/remarkWikiLinks.ts` : UI/플러그인 레이어
- `public/` : 정적 자산 (favicon, robots.txt)

## 작성 규칙 (frontmatter/링크/이미지)
- 필수 frontmatter: `title`, `created` (ISO 또는 `YYYY-MM-DD HH:mm`). 선택: `modified`, `tags`, `summary`.
- 파일명은 슬러그 형태로 작성(공백 대신 하이픈).
- 이미지: Obsidian에서는 `![[file.png]]` 그대로 사용 가능. 마이그레이션 시 `src/content/assets/<해시>-file.png`로 복사되고, 본문 경로는 `../../assets/...`로 치환됩니다.
- 내부 링크: `[[대상]]` 또는 `[[대상|표시]]` 사용 시 slug에 매핑되어 Astro 페이지 링크로 변환됩니다.

## 마이그레이션 절차
1) `notes/`와 첨부(기본: `../../9.Settings/Attachments`)를 최신 상태로 준비  
2) 실행: `npm run migrate:blog`  
3) 스크립트가 `src/content/{posts,projects,retrospectives,assets}`를 초기화 후 다시 채웁니다.  
4) 로그에서 누락된 이미지 경고가 없는지 확인  
5) 필요 시 수동으로 `assets/`에 추가 후 본문 경로를 `../../assets/파일명`으로 수정

## 배포 체크리스트
- `astro.config.mjs`의 `site` 값이 실제 배포 URL(`https://kmsk99.github.io`)과 일치하는지 확인
- `npm run build` → `dist/` 생성
- GitHub Pages 워크플로 또는 수동으로 `dist/`를 Pages 대상 브랜치에 업로드

