import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

const SOURCE_BASE = '/Users/gimminseog/Documents/Minseok/4.Projects/kmsk99.github.io/기술 블로그';
const ATTACH_BASE = '/Users/gimminseog/Documents/Minseok/9.Settings/Attachments';
const TARGET_BASE = '/Users/gimminseog/Documents/Minseok/4.Projects/kmsk99.github.io/src/content/posts';

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
	const [categoryRaw] = rel.split(path.sep);
	const category = slugify(categoryRaw || 'misc');

	const stat = await fs.stat(file);
	const raw = await fs.readFile(file, 'utf8');
	const parsed = matter(raw);

	const title = parsed.data.title || path.basename(file, '.md');
	const slug = parsed.data.slug ? parsed.data.slug : slugify(title);
	const created = parsed.data.created || stat.birthtime.toISOString();
	const modified = parsed.data.modified || stat.mtime.toISOString();

	const targetDir = path.join(TARGET_BASE, category, slug);
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

	console.log(`[OK] ${rel} -> ${path.relative(TARGET_BASE, targetDir)}/index.md`);
}

async function main() {
	// 기존 게시물 제거 후 새로 마이그레이션
	await fs.rm(TARGET_BASE, { recursive: true, force: true });
	await ensureDir(TARGET_BASE);
	const files = await walk(SOURCE_BASE);
	for (const file of files) {
		await migrateFile(file);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

