import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { createHash } from 'node:crypto';
import { romanize } from 'es-hangul';

const ROOT = process.cwd();
const SOURCE_BASE = path.join(ROOT, 'notes');
// 첨부폴더는 상위 두 단계인 .../Minseok/9.Settings/Attachments (Obsidian에서 사용 중)
const ATTACH_BASE = path.resolve(ROOT, '..', '..', '9.Settings', 'Attachments');
const TARGET_POSTS = path.join(ROOT, 'src', 'content', 'posts');
const TARGET_PROJECTS = path.join(ROOT, 'src', 'content', 'projects');
const TARGET_RETROS = path.join(ROOT, 'src', 'content', 'retrospectives');
const TARGET_ASSETS = path.join(ROOT, 'src', 'content', 'assets');

const supportedImageExt = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const linkIndex = new Map();

const baseSlug = (value) =>
	value
		.toString()
		.normalize('NFKD')
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.toLowerCase();

const slugify = (value) => {
	let roman = '';
	try {
		roman = romanize(value, { system: 'rr' });
	} catch (e) {
		try {
			roman = romanize(value);
		} catch {
			roman = '';
		}
	}
	const candidate = roman && typeof roman === 'string' ? roman : value;
	return baseSlug(candidate);
};

// 폴더명은 영문 기준, 대소문자 유지하며 공백만 하이픈으로 치환
const folderify = (value = '') =>
	value
		.trim()
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^[-]+|[-]+$/g, '');

async function ensureDir(dir) {
	await fs.mkdir(dir, { recursive: true });
}

async function walk(dir) {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walk(full)));
		} else if (entry.isFile() && full.endsWith('.md')) {
			files.push(full);
		}
	}
	return files;
}

function addLinkIndex(key, href) {
	if (!key) return;
	const trimmed = key.trim();
	if (!trimmed) return;
	const normalized = baseSlug(trimmed);
	if (!linkIndex.has(trimmed)) linkIndex.set(trimmed, href);
	if (!linkIndex.has(normalized)) linkIndex.set(normalized, href);
}

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

function extractImages(content) {
	const results = new Set();
	const wikiImg = /!\[\[([^[\]]+)\]\]/g;
	const mdImg = /!\[[^\]]*]\(([^)]+)\)/g;

	let m;
	while ((m = wikiImg.exec(content))) {
		results.add(m[1].trim());
	}
	while ((m = mdImg.exec(content))) {
		const url = m[1].trim();
		if (!url.startsWith('http')) results.add(path.basename(url));
	}
	return Array.from(results);
}

async function copyImage(imgName, destName) {
	const src = path.join(ATTACH_BASE, imgName);
	try {
		const stat = await fs.stat(src);
		if (!stat.isFile()) return false;
		await fs.copyFile(src, path.join(TARGET_ASSETS, destName));
		return true;
	} catch {
		return false;
	}
}

function hashPrefix(input) {
	return createHash('md5').update(input).digest('hex').slice(0, 8);
}

function normalizeImages(content, renameMap, assetPrefix) {
	const replaceName = (name) => renameMap.get(name) ?? name;

	// ![[img.png]] -> ![](../../assets/hash-name.png) (relative path based on assetPrefix)
	const wikiFixed = content.replace(/!\[\[([^[\]]+)\]\]/g, (_m, p1) => {
		const raw = p1.trim();
		if (raw.startsWith('http')) return `![](${raw})`;
		const mapped = replaceName(raw);
		return `![](${assetPrefix}${mapped})`;
	});

	// ![alt](img.png) -> ![alt](../../assets/hash-name.png)
	return wikiFixed.replace(/!\[([^\]]*)]\(([^)]+)\)/g, (_m, alt, url) => {
		const trimmed = url.trim();
		if (trimmed.startsWith('http')) return `![${alt}](${trimmed})`;
		const mapped = replaceName(path.basename(trimmed));
		return `![${alt}](${assetPrefix}${mapped})`;
	});
}

function normalizeLinks(content) {
	const pattern = /(!)?\[\[([^[\]]+)\]\]/g;
	return content.replace(pattern, (full, bang, labelRaw) => {
		if (bang) return full; // 이미지 패턴은 이미지 처리 단계에서 다룸
		const raw = labelRaw.trim();
		// 위키링크 별칭 처리: [[target|display]]
		const [targetRaw = '', displayRaw = ''] = raw.split('|', 2);
		const target = targetRaw.trim();
		const displayText = (displayRaw || targetRaw).trim();
		if (!target) return full; // 대상이 없으면 원본 유지

		const cleaned = target.replace(/\.md$/i, '');
		const keyVariants = [cleaned, cleaned.trim(), baseSlug(cleaned), slugify(cleaned)];
		let href;
		for (const key of keyVariants) {
			href = linkIndex.get(key);
			if (href) break;
		}
		if (!href) return displayText || target; // 찾지 못하면 표시 텍스트만 남김
		return `[${displayText || target}](${href})`;
	});
}

async function migrateFile(file) {
	const rel = path.relative(SOURCE_BASE, file);
	const [categoryRaw, ...rest] = rel.split(path.sep);

	const stat = await fs.stat(file);
	const raw = await fs.readFile(file, 'utf8');
	const parsed = matter(raw);

	const title = parsed.data.title || path.basename(file, '.md');
	const slug = parsed.data.slug ? parsed.data.slug : slugify(title);

	const toDateStr = (v, fallback) => {
		if (v instanceof Date) return v.toISOString().slice(0, 10);
		if (typeof v === 'string' && v) return v;
		return fallback.toISOString().slice(0, 10);
	};
	const created = toDateStr(parsed.data.created, stat.birthtime);
	const modified = toDateStr(parsed.data.modified, stat.mtime);

	const isProject = categoryRaw === 'project';
	const isRetro = categoryRaw === 'retrospectives';
	const postCategoryRaw = rest[0] || 'misc';
	const projectCategoryRaw = rest[0] || 'Project-Showcase';
	const retroCategoryRaw = rest[0] || 'retrospectives';

	// slugify 폴더명: 공백 등을 '-'로 치환해 경로 인코딩 문제 방지
	const postCategorySlug = folderify(postCategoryRaw);
	const projectCategorySlug = folderify(projectCategoryRaw);
	const retroCategorySlug = folderify(retroCategoryRaw);

	let targetDir;
	let relativeAssetPrefix;

	if (isProject) {
		targetDir = path.join(TARGET_PROJECTS, projectCategorySlug);
		relativeAssetPrefix = '../../assets/';
	} else if (isRetro) {
		targetDir = path.join(TARGET_RETROS, retroCategorySlug);
		relativeAssetPrefix = '../../assets/';
	} else {
		targetDir = path.join(TARGET_POSTS, postCategorySlug);
		relativeAssetPrefix = '../../assets/';
	}
	await ensureDir(targetDir);

	const images = extractImages(parsed.content);
	const renameMap = new Map();
	const hashKey = hashPrefix(slug || categoryRaw || 'asset');

	for (const img of images) {
		if (!supportedImageExt.has(path.extname(img).toLowerCase())) continue;
		const ext = path.extname(img);
		const base = baseSlug(path.basename(img, ext));
		const nextName = `${hashKey}-${base}${ext}`;
		renameMap.set(img, nextName);
		const ok = await copyImage(img, nextName);
		if (!ok) {
			console.warn(`[WARN] 이미지 없음: ${img} (from ${file})`);
		}
	}

	const contentWithImages = normalizeImages(parsed.content, renameMap, relativeAssetPrefix);
	const content = normalizeLinks(contentWithImages);
	const fm = { ...parsed.data };
	fm.title = title;
	fm.created = created;
	fm.modified = modified;
	const next = matter.stringify(content, fm);
	const outputPath = path.join(targetDir, `${slug}.md`);
	await fs.writeFile(outputPath, next, 'utf8');

	const base = isProject ? TARGET_PROJECTS : isRetro ? TARGET_RETROS : TARGET_POSTS;
	console.log(`[OK] ${rel} -> ${path.relative(base, outputPath)}`);
}

async function main() {
	// 기존 게시물 제거 후 새로 마이그레이션
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

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

