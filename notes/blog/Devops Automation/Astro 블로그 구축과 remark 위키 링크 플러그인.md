---
tags:
  - Astro
  - SSG
  - SEO
  - Blog
  - GitHub Pages
title: Astro SSG 포트폴리오 블로그 구축
created: 2025-12-04
modified: 2026-02-13
---

# 배경

포트폴리오와 기술 블로그를 하나의 사이트로 운영하기 위해 Astro 5 기반 SSG(Static Site Generation) 블로그를 구축했다. 의존성을 최소화하면서도 Content Collections, JSON-LD 구조화 데이터, RSS, sitemap, Google Analytics까지 갖춘 완성된 블로그를 만드는 것이 목표였다.

# 의존성과 구성

```json
{
  "dependencies": {
    "@astrojs/rss": "^4.0.15",
    "@astrojs/sitemap": "^3.6.0",
    "astro": "^5.16.4",
    "es-hangul": "^2.3.8",
    "gray-matter": "^4.0.3"
  }
}
```

5개 의존성으로 전체 블로그를 구성했다. `es-hangul`은 한글을 로마자로 변환해 URL 슬러그를 생성할 때, `gray-matter`는 remark 플러그인에서 frontmatter를 파싱할 때 사용한다.

Astro 설정에서 커스텀 remark 플러그인과 sitemap 통합을 등록한다.

```js
import { remarkWikiLinks } from './src/plugins/remarkWikiLinks.ts';

export default defineConfig({
  site: 'https://kmsk99.github.io',
  markdown: {
    remarkPlugins: [remarkWikiLinks],
  },
  integrations: [sitemap()],
});
```

# Content Collections

Astro의 Content Collections로 세 가지 컬렉션을 정의했다. 각 컬렉션은 동일한 Zod 스키마를 공유한다.

```ts
import { defineCollection, z } from 'astro:content';

const posts = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    created: z.string(),
    modified: z.string().optional(),
    tags: z.array(z.string()).optional(),
    summary: z.string().optional(),
  }),
});

const projects = defineCollection({ type: 'content', schema: /* 동일 */ });
const retrospectives = defineCollection({ type: 'content', schema: /* 동일 */ });
const assets = defineCollection({ type: 'data', schema: z.object({}) });

export const collections = { projects, posts, retrospectives, assets };
```

Zod 스키마로 frontmatter를 검증하므로, 필수 필드가 빠진 마크다운 파일은 빌드 시점에 에러가 난다. Obsidian에서 작성한 파일의 frontmatter 형식과 일치시켜두면 별도 변환 없이 그대로 사용할 수 있다.

`assets` 컬렉션은 이미지 파일을 위한 것으로 `type: 'data'`로 정의한다.

# 동적 라우팅

`post/[slug].astro`에서 세 컬렉션의 모든 문서를 하나의 경로로 통합한다.

```astro
---
export async function getStaticPaths() {
  const collections = [
    ...(await getCollection('posts')),
    ...(await getCollection('projects')),
    ...(await getCollection('retrospectives')),
  ];

  const seen = new Set<string>();
  const paths = [];

  for (const entry of collections) {
    const segments = entry.id.split('/');
    const slugRaw = segments[segments.length - 1];
    const slug = slugRaw.replace(/\.md$/i, '');

    if (!slug || seen.has(slug)) continue;
    seen.add(slug);

    paths.push({ params: { slug }, props: { entry } });

    if (slugRaw.endsWith('.md') && !seen.has(slugRaw)) {
      seen.add(slugRaw);
      paths.push({ params: { slug: slugRaw }, props: { entry } });
    }
  }
  return paths;
}
---

{entry.collection === 'projects' ? (
  <ProjectLayout entry={entry as any} />
) : entry.collection === 'retrospectives' ? (
  <RetrospectiveLayout entry={entry as any} />
) : (
  <PostLayout entry={entry as any} />
)}
```

`seen` Set으로 슬러그 중복을 방지한다. Obsidian에서는 폴더가 다르면 같은 파일명이 가능하지만, URL 슬러그는 파일명 기준이므로 먼저 등록된 것이 우선한다. `.md` 확장자로 끝나는 기존 링크에 대한 호환 경로도 함께 생성한다.

# 위키 링크 플러그인

Obsidian의 `[[문서명]]` 위키 링크를 HTML 링크로 변환하는 remark 플러그인을 직접 작성했다.

## 링크 인덱스 빌드

플러그인이 처음 실행될 때 `content/` 폴더를 순회해 모든 문서의 제목, 슬러그, 파일명을 인덱스에 등록한다.

```ts
const linkIndex = new Map<string, string>();
let isIndexed = false;

function safeSlug(value: string) {
  return value
    .toString()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function addToIndex(key: string | undefined, href: string) {
  if (!key) return;
  const trimmed = key.trim();
  const normalizedKey = safeSlug(trimmed);
  if (!linkIndex.has(trimmed)) linkIndex.set(trimmed, href);
  if (!linkIndex.has(normalizedKey)) linkIndex.set(normalizedKey, href);
}
```

`safeSlug`은 NFKD 정규화 후 `\p{L}` (유니코드 문자)과 `\p{N}` (유니코드 숫자)만 유지한다. 한글, 일본어 등 비라틴 문자가 슬러그에서 사라지지 않는다.

각 마크다운 파일에서 frontmatter의 `title`, 파일 경로 기반 `slug`, 파일명 `basename`을 모두 인덱스에 등록한다.

```ts
function walkContent(dir: string, baseHref: string, relativeDir = '') {
  if (!fs.existsSync(dir)) return;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      walkContent(path.join(dir, entry.name), baseHref, path.join(relativeDir, entry.name));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const slug = path.join(relativeDir, entry.name.replace(path.extname(entry.name), ''))
        .split(path.sep).join('/');
      const basename = slug.split('/').pop();
      const href = basename ? `/post/${basename}` : `${baseHref}/${slug}`;

      const raw = fs.readFileSync(path.join(dir, entry.name), 'utf8');
      const { data } = matter(raw);

      addToIndex(data?.title, href);
      addToIndex(slug, href);
      if (basename) addToIndex(basename, href);
    }
  }
}
```

## AST 변환

remark 플러그인은 마크다운 AST를 순회하면서 `[[...]]` 패턴을 찾아 변환한다.

```ts
export const remarkWikiLinks: Plugin<[], Root> = () => {
  buildIndex();

  return (tree) => {
    visit(tree, 'text', (node, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      const value = (node as Text).value;
      if (!value.includes('[[')) return;

      const newNodes = toNodes(value);
      if (newNodes.length === 1 && newNodes[0].type === 'text') return;
      parent.children.splice(index, 1, ...newNodes);
      return index + newNodes.length;
    });
  };
};
```

`toNodes` 함수가 텍스트를 파싱해 `[[label]]`은 링크 노드로, `![[image]]`는 이미지 노드로 변환한다.

```ts
function toNodes(text: string): PhrasingContent[] {
  const nodes: PhrasingContent[] = [];
  const pattern = /(!)?\[\[([^[\]]+)\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    const [full, bang, labelRaw] = match;
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    const label = labelRaw.trim();
    if (bang) {
      nodes.push({ type: 'image', url: label.startsWith('http') ? label : `./${label}`, alt: label });
    } else {
      nodes.push({ type: 'link', url: resolveHref(label), children: [{ type: 'text', value: label }] });
    }
    lastIndex = match.index + full.length;
  }
  if (lastIndex < text.length) {
    nodes.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return nodes;
}
```

`resolveHref`는 인덱스에서 여러 키로 검색을 시도한다. 원본 텍스트, `.md` 제거 버전, 정규화 슬러그 순으로 매칭하고, 찾지 못하면 검색 페이지로 리다이렉트한다.

```ts
function resolveHref(label: string) {
  buildIndex();
  const cleaned = stripMdSuffix(label);
  const normalized = safeSlug(cleaned);
  return (
    linkIndex.get(label) ??
    linkIndex.get(label.trim()) ??
    linkIndex.get(cleaned) ??
    linkIndex.get(normalized) ??
    `/search?q=${encodeURIComponent(label)}`
  );
}
```

# SEO

## Seo 컴포넌트

모든 페이지에서 사용하는 `Seo.astro` 컴포넌트가 메타 태그와 Open Graph, Twitter Card, JSON-LD를 한 번에 처리한다.

```astro
<title>{title}</title>
<meta name="description" content={description} />
<meta name="robots" content={robots} />
{canonicalUrl && <link rel="canonical" href={canonicalUrl} />}
{tags.length > 0 && <meta name="keywords" content={tags.join(', ')} />}
<meta property="og:type" content={type} />
<meta property="og:title" content={title} />
<meta property="og:description" content={description} />
{canonicalUrl && <meta property="og:url" content={canonicalUrl} />}
{resolvedImage && <meta property="og:image" content={resolvedImage} />}
<meta name="twitter:card" content="summary_large_image" />
```

`noindex` prop으로 특정 페이지를 검색 엔진에서 제외할 수 있고, `article` 타입일 때는 `article:published_time`, `article:modified_time`, `article:tag` 메타를 추가한다.

## JSON-LD 구조화 데이터

`BaseLayout.astro`에서 페이지 타입에 따라 WebSite, BreadcrumbList, BlogPosting 스키마를 구성한다.

```ts
const structuredData = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    url: siteUrl,
    name: SITE.title,
    description: SITE.description,
    inLanguage: 'ko',
  },
  ...(breadcrumbStructured ? [breadcrumbStructured] : []),
  ...(seoType === 'article' ? [{
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    datePublished: publishedTime,
    dateModified: modifiedTime ?? publishedTime,
    author: { '@type': 'Person', name: SITE.author.name, url: SITE.author.url },
    keywords: tags,
  }] : []),
];
```

BreadcrumbList는 Google 검색 결과에서 사이트 구조를 보여주는 데 사용된다.

## SEO 설정

중앙 설정 파일에서 사이트 메타데이터를 관리한다.

```ts
export const SITE = {
  title: '김민석 · Astro 포트폴리오',
  description: '김민석의 포트폴리오와 기술 블로그.',
  url: 'https://kmsk99.github.io',
  siteName: '김민석 블로그',
  locale: 'ko_KR',
  defaultImage: '/favicon.svg',
  author: { name: '김민석', url: 'https://kmsk99.github.io' },
};
```

`absoluteUrl` 헬퍼가 상대 경로를 절대 URL로 변환해 Open Graph 이미지 등에서 올바른 URL이 사용되도록 한다.

# RSS 피드

```ts
export async function GET(context: { site: URL }) {
  const posts = await getCollection('posts');

  const sortedPosts = posts.sort((a, b) =>
    new Date(b.data.created).getTime() - new Date(a.data.created).getTime()
  );

  return rss({
    title: SITE.title,
    description: SITE.description,
    site: context.site ?? SITE.url,
    items: sortedPosts.map((post) => ({
      title: post.data.title,
      description: post.data.summary ?? '',
      pubDate: new Date(post.data.created),
      link: `/post/${post.id.split('/').pop()?.replace(/\.md$/i, '')}`,
      categories: post.data.tags ?? [],
    })),
    customData: `<language>ko</language>`,
  });
}
```

`@astrojs/rss`가 RSS 2.0 XML을 생성한다. 각 글의 `link`는 동적 라우팅과 동일한 슬러그 규칙을 따른다.

# UI 구성

## 레이아웃

사이드바(카테고리 트리 + 태그 필터)와 메인 콘텐츠 영역을 그리드로 배치한다. sticky 헤더와 backdrop-filter blur로 스크롤 시에도 네비게이션이 유지된다.

```css
.layout-grid {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 24px;
  align-items: flex-start;
}

.site-header {
  position: sticky;
  top: 0;
  backdrop-filter: blur(12px);
  background: rgba(11, 12, 15, 0.7);
  border-bottom: 1px solid var(--border);
  z-index: 10;
}
```

## 카테고리와 태그 필터

사이드바에서 카테고리와 태그를 클라이언트 사이드로 필터링한다. SSG이므로 모든 글이 HTML에 포함되어 있고, JavaScript로 `display: none`을 토글한다.

```js
const applyFilters = () => {
  targets.forEach((el) => {
    const elCategory = el.dataset.category;
    const elTags = el.dataset.tags?.split(',').filter(Boolean) ?? [];
    const matchCategory = currentCategory === '__all' || elCategory === currentCategory;
    const matchTag = currentTag === '__all' || elTags.includes(currentTag);
    el.style.display = matchCategory && matchTag ? '' : 'none';
  });
};
```

URL 파라미터(`?category=...&tag=...`)에서 초기 필터를 읽어 페이지 로드 시 바로 적용한다.

# 배포

GitHub Actions로 main 브랜치에 push하면 자동 빌드/배포된다.

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: withastro/action@v5

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/deploy-pages@v4
```

`withastro/action@v5`가 Node.js 설치, 의존성 설치, `astro build`를 자동으로 처리하고, `deploy-pages`가 GitHub Pages에 배포한다. Google Analytics는 프로덕션 빌드에서만 활성화된다.

```ts
const isProd = import.meta.env.MODE === 'production';
// GA 스크립트는 isProd && GA_ID일 때만 렌더링
```

# 결과

Astro 5 + 5개 의존성으로 다음을 모두 달성했다:
- Content Collections + Zod로 frontmatter 타입 안전성 보장
- 위키 링크 자동 변환으로 Obsidian 호환성 유지
- JSON-LD, Open Graph, Twitter Card, RSS, sitemap으로 SEO 최적화
- 카테고리/태그 클라이언트 필터링으로 SSG에서도 동적 UI 제공
- GitHub Actions로 push 한 번에 빌드부터 배포까지 자동화

# Reference

- https://astro.build/
- https://docs.astro.build/en/guides/content-collections/
- https://unifiedjs.com/learn/guide/create-a-remark-plugin/
- https://github.com/syntax-tree/unist-util-visit
- https://developers.google.com/search/docs/appearance/structured-data

# 연결문서

- [[옵시디언 마크다운을 Astro 블로그로 변환하기]]
- [[HeadVer 버저닝 시스템을 JS 프로덕트에 적용하기]]
- [[ESLint + Prettier + Husky 자동화 구성]]
