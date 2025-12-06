import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

const ROOT = process.cwd();
const SOURCE_BASE = path.join(ROOT, 'notes');
// 첨부폴더는 상위 두 단계인 .../Minseok/9.Settings/Attachments (Obsidian에서 사용 중)
const ATTACH_BASE = path.resolve(ROOT, '..', '..', '9.Settings', 'Attachments');
const TARGET_POSTS = path.join(ROOT, 'src', 'content', 'posts');
const TARGET_PROJECTS = path.join(ROOT, 'src', 'content', 'projects');

const supportedImageExt = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

const slugify = (value) =>
	value
		.toString()
		.normalize('NFKD')
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.toLowerCase();

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

async function copyImage(imgName, targetDir) {
	const src = path.join(ATTACH_BASE, imgName);
	try {
		const stat = await fs.stat(src);
		if (!stat.isFile()) return false;
		await fs.copyFile(src, path.join(targetDir, imgName));
		return true;
	} catch {
		return false;
	}
}

function normalizeImages(content) {
	// ![[img.png]] -> ![](./img.png)
	return content.replace(/!\[\[([^[\]]+)\]\]/g, (_m, p1) => `![](${p1.trim().startsWith('http') ? p1.trim() : `./${p1.trim()}`})`);
}

async function migrateFile(file) {
	const rel = path.relative(SOURCE_BASE, file);
	const [categoryRaw, ...rest] = rel.split(path.sep);

	const stat = await fs.stat(file);
	const raw = await fs.readFile(file, 'utf8');
	const parsed = matter(raw);

	const title = parsed.data.title || path.basename(file, '.md');
	const slug = parsed.data.slug ? parsed.data.slug : slugify(title);
	const created = parsed.data.created || stat.birthtime.toISOString();
	const modified = parsed.data.modified || stat.mtime.toISOString();

	const isProject = categoryRaw === 'project' || slugify(categoryRaw) === 'project-showcase';
	const postCategory = slugify(rest[0] || 'misc');

	const targetDir = isProject
		? path.join(TARGET_PROJECTS, slug)
		: path.join(TARGET_POSTS, postCategory, slug);
	await ensureDir(targetDir);

	const images = extractImages(parsed.content);
	for (const img of images) {
		if (!supportedImageExt.has(path.extname(img).toLowerCase())) continue;
		const ok = await copyImage(img, targetDir);
		if (!ok) {
			console.warn(`[WARN] 이미지 없음: ${img} (from ${file})`);
		}
	}

	const content = normalizeImages(parsed.content);
	const fm = { ...parsed.data };
	delete fm.uploaded;
	fm.title = title;
	fm.slug = slug;
	fm.created = created;
	fm.modified = modified;
	const next = matter.stringify(content, fm);
	await fs.writeFile(path.join(targetDir, 'index.md'), next, 'utf8');

	const base = isProject ? TARGET_PROJECTS : TARGET_POSTS;
	console.log(`[OK] ${rel} -> ${path.relative(base, targetDir)}/index.md`);
}

async function main() {
	// 기존 게시물 제거 후 새로 마이그레이션
	await fs.rm(TARGET_POSTS, { recursive: true, force: true });
	await fs.rm(TARGET_PROJECTS, { recursive: true, force: true });
	await ensureDir(TARGET_POSTS);
	await ensureDir(TARGET_PROJECTS);
	const files = await walk(SOURCE_BASE);
	for (const file of files) {
		await migrateFile(file);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

