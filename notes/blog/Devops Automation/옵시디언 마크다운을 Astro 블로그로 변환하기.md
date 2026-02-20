---
tags:
  - Obsidian
  - Astro
  - Markdown
  - Migration
  - Automation
title: 옵시디언 마크다운을 Astro 블로그로 변환하기
created: 2026-01-10 10:00
modified: 2026-01-10 14:00
---

# 배경

Obsidian에서 작성한 기술 블로그 마크다운 파일을 Astro Content Collections에 맞게 변환해야 한다. Obsidian은 `[[위키 링크]]`, `![[이미지.png]]` 같은 고유 문법을 사용하고, Attachments 폴더에 이미지를 별도 관리한다. 이런 차이를 자동으로 처리하는 마이그레이션 스크립트를 작성했다.

# 폴더 구조 매핑

Obsidian 노트의 폴더 구조를 Astro Content Collections에 매핑한다.

```
notes/
├── blog/                    → src/content/posts/
│   ├── Architecture Patterns/  → posts/Architecture-Patterns/
│   ├── Data Docs/              → posts/Data-Docs/
│   └── ...
├── project/                 → src/content/projects/
│   └── Project-Showcase/       → projects/Project-Showcase/
└── retrospectives/          → src/content/retrospectives/
    └── 2025-Q1/                → retrospectives/2025-Q1/
```

카테고리 폴더명은 공백을 하이픈으로 치환해 URL 인코딩 문제를 방지한다.

```ts
const folderify = (value = '') =>
  value.trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-]+|[-]+$/g, '');
```

# 슬러그 생성

Astro의 동적 라우팅(`/post/[slug]`)에서 사용할 슬러그를 생성한다. 한글 제목을 URL에 안전한 형태로 변환해야 한다.

```ts
import { romanize } from 'es-hangul';

const baseSlug = (value) =>
  value.normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

const slugify = (value) => {
  let roman = '';
  try {
    roman = romanize(value, { system: 'rr' });
  } catch {
    roman = '';
  }
  const candidate = roman && typeof roman === 'string' ? roman : value;
  return baseSlug(candidate);
};
```

`es-hangul`의 `romanize`로 한글을 개정 로마자 표기법(RR)으로 변환한 뒤 슬러그화한다. "PostGIS RPC로 구역 저장과 공간 조회"가 `postgis-rpc-ro-guyeog-jeojang-gwa-gonggan-johoe` 같은 형태가 된다. 로마자 변환에 실패하면 원본 유니코드를 그대로 사용한다.

frontmatter에 `slug` 필드가 있으면 그것을 우선 사용한다.

```ts
const title = parsed.data.title || path.basename(file, '.md');
const slug = parsed.data.slug ? parsed.data.slug : slugify(title);
```

# 링크 인덱스

위키 링크를 변환하려면 모든 문서의 제목과 슬러그 매핑을 먼저 구축해야 한다.

```ts
const linkIndex = new Map();

async function buildLinkIndex(files) {
  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = matter(raw);
    const title = parsed.data.title || path.basename(file, '.md');
    const slug = parsed.data.slug ? parsed.data.slug : slugify(title);
    const href = `/post/${slug}`;

    addLinkIndex(title, href);
    addLinkIndex(slug, href);
  }
}
```

원본 제목과 슬러그 두 가지 키로 등록해, `[[PostGIS RPC로 구역 저장과 공간 조회]]`와 `[[postgis-rpc-ro-...]]` 모두 같은 URL로 해석된다.

# 이미지 처리

Obsidian의 이미지 참조(`![[image.png]]`, `![alt](image.png)`)를 추출하고, Attachments 폴더에서 이미지를 복사한 뒤 경로를 변환한다.

```ts
function extractImages(content) {
  const results = new Set();
  const wikiImg = /!\[\[([^[\]]+)\]\]/g;
  const mdImg = /!\[[^\]]*]\(([^)]+)\)/g;

  let m;
  while ((m = wikiImg.exec(content))) results.add(m[1].trim());
  while ((m = mdImg.exec(content))) {
    const url = m[1].trim();
    if (!url.startsWith('http')) results.add(path.basename(url));
  }
  return Array.from(results);
}
```

이미지 파일명에 슬러그 기반 해시 접두사를 붙여 충돌을 방지한다.

```ts
function hashPrefix(input) {
  return createHash('md5').update(input).digest('hex').slice(0, 8);
}

const hashKey = hashPrefix(slug || categoryRaw || 'asset');
const nextName = `${hashKey}-${baseSlug(path.basename(img, ext))}${ext}`;
```

"스크린샷 2025-01-15.png"이 `a1b2c3d4-seukeulinsyas-2025-01-15.png`처럼 고유한 이름이 된다.

변환 후 경로는 Content Collections의 상대 경로 규칙에 맞춘다.

```ts
function normalizeImages(content, renameMap, assetPrefix) {
  // ![[img.png]] → ![](../../assets/hash-name.png)
  const wikiFixed = content.replace(/!\[\[([^[\]]+)\]\]/g, (_m, p1) => {
    const raw = p1.trim();
    if (raw.startsWith('http')) return `![](${raw})`;
    const mapped = renameMap.get(raw) ?? raw;
    return `![](${assetPrefix}${mapped})`;
  });

  // ![alt](img.png) → ![alt](../../assets/hash-name.png)
  return wikiFixed.replace(/!\[([^\]]*)]\(([^)]+)\)/g, (_m, alt, url) => {
    const trimmed = url.trim();
    if (trimmed.startsWith('http')) return `![${alt}](${trimmed})`;
    const mapped = renameMap.get(path.basename(trimmed)) ?? path.basename(trimmed);
    return `![${alt}](${assetPrefix}${mapped})`;
  });
}
```

# 위키 링크 변환

`[[타겟|표시 텍스트]]` 형태의 별칭도 처리한다.

```ts
function normalizeLinks(content) {
  const pattern = /(!)?\[\[([^[\]]+)\]\]/g;
  return content.replace(pattern, (full, bang, labelRaw) => {
    if (bang) return full; // 이미지는 이미지 처리 단계에서 처리됨

    const [targetRaw = '', displayRaw = ''] = labelRaw.split('|', 2);
    const target = targetRaw.trim();
    const displayText = (displayRaw || targetRaw).trim();

    const cleaned = target.replace(/\.md$/i, '');
    const keyVariants = [cleaned, cleaned.trim(), baseSlug(cleaned), slugify(cleaned)];

    let href;
    for (const key of keyVariants) {
      href = linkIndex.get(key);
      if (href) break;
    }

    if (!href) return displayText || target;
    return `[${displayText || target}](${href})`;
  });
}
```

여러 키 변형으로 검색을 시도해 매칭 확률을 높인다. 원본 텍스트, `.md` 제거, `baseSlug` 정규화, `slugify` 로마자 변환 순으로 시도한다. 매칭에 실패하면 링크 없이 표시 텍스트만 남긴다.

# 마이그레이션 실행

`migrateFile` 함수가 개별 파일을 변환한다.

```ts
async function migrateFile(file) {
  const rel = path.relative(SOURCE_BASE, file);
  const [categoryRaw, ...rest] = rel.split(path.sep);

  const raw = await fs.readFile(file, 'utf8');
  const parsed = matter(raw);

  const title = parsed.data.title || path.basename(file, '.md');
  const slug = parsed.data.slug ? parsed.data.slug : slugify(title);
  const created = parsed.data.created || stat.birthtime.toISOString();
  const modified = parsed.data.modified || stat.mtime.toISOString();

  const isProject = categoryRaw === 'project';
  const isRetro = categoryRaw === 'retrospectives';

  // 이미지 처리
  const images = extractImages(parsed.content);
  const renameMap = new Map();
  for (const img of images) {
    const nextName = `${hashKey}-${baseSlug(path.basename(img, ext))}${ext}`;
    renameMap.set(img, nextName);
    await copyImage(img, nextName);
  }

  // 콘텐츠 변환
  const contentWithImages = normalizeImages(parsed.content, renameMap, relativeAssetPrefix);
  const content = normalizeLinks(contentWithImages);

  // frontmatter 보존 및 출력
  const fm = { ...parsed.data, title, created, modified };
  const next = matter.stringify(content, fm);
  await fs.writeFile(outputPath, next, 'utf8');
}
```

전체 프로세스:

```ts
async function main() {
  await fs.rm(TARGET_POSTS, { recursive: true, force: true });
  await fs.rm(TARGET_PROJECTS, { recursive: true, force: true });
  await fs.rm(TARGET_RETROS, { recursive: true, force: true });
  await fs.rm(TARGET_ASSETS, { recursive: true, force: true });

  await ensureDir(TARGET_POSTS);
  await ensureDir(TARGET_PROJECTS);
  await ensureDir(TARGET_RETROS);
  await ensureDir(TARGET_ASSETS);

  const files = await walk(SOURCE_BASE);
  await buildLinkIndex(files);

  for (const file of files) {
    await migrateFile(file);
  }
}
```

매 실행마다 기존 출력을 완전히 삭제하고 새로 생성한다. 이렇게 하면 삭제된 노트가 빌드에 남아있는 문제를 방지할 수 있다.

`package.json`에 스크립트를 등록해 한 줄로 실행한다.

```json
{
  "scripts": {
    "migrate:blog": "node scripts/migrate-tech-blog.mjs"
  }
}
```

# 워크플로우

실제 작성과 배포 과정은 다음과 같다:

1. Obsidian에서 마크다운 작성 (위키 링크, 이미지 첨부 자유롭게 사용)
2. `pnpm migrate:blog` 실행 → `src/content/`에 변환된 파일 생성
3. `pnpm dev`로 로컬 확인
4. `git push origin main` → GitHub Actions가 빌드 + 배포

Obsidian에서 노트를 수정하면 마이그레이션 스크립트만 다시 실행하면 된다. frontmatter 형식만 맞추면 Obsidian의 모든 기능(위키 링크, 이미지 첨부, 폴더 구조)을 그대로 사용할 수 있다.

# 결과

마이그레이션 스크립트로 달성한 것:
- Obsidian 위키 링크(`[[...]]`)를 Astro 라우팅에 맞는 마크다운 링크(`[...](/post/...)`)로 자동 변환
- 이미지를 해시 접두사로 네이밍해 충돌 방지하고, Content Collections 경로에 맞게 재배치
- 한글 제목을 로마자 슬러그로 변환해 URL 호환성 확보
- 매번 깨끗한 재생성으로 삭제된 노트의 잔여물 방지
- frontmatter의 `created`, `modified`를 파일 메타데이터에서 자동 추출

# Reference

- https://github.com/jonschlinkert/gray-matter
- https://www.npmjs.com/package/es-hangul
- https://docs.astro.build/en/guides/content-collections/

# 연결문서

- [[Astro SSG 포트폴리오 블로그 구축]]
- [[HeadVer 버저닝 시스템을 JS 프로덕트에 적용하기]]
- [[ESLint + Prettier + Husky 자동화 구성]]
