import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Root, Text, Link, Image, PhrasingContent } from 'mdast';

const rootDir = process.cwd();
const projectsDir = path.join(rootDir, 'src', 'content', 'projects');
const postsDir = path.join(rootDir, 'src', 'content', 'posts');
const retrospectivesDir = path.join(rootDir, 'src', 'content', 'retrospectives');

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
	if (!trimmed) return;

	const normalizedKey = safeSlug(trimmed);

	if (!linkIndex.has(trimmed)) {
		linkIndex.set(trimmed, href);
	}
	if (!linkIndex.has(normalizedKey)) {
		linkIndex.set(normalizedKey, href);
	}
}

function stripMdSuffix(value: string) {
	return value.replace(/\.md$/i, '');
}

function walkContent(dir: string, baseHref: string, relativeDir = '') {
	if (!fs.existsSync(dir)) return;

	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walkContent(entryPath, baseHref, path.join(relativeDir, entry.name));
			continue;
		}

		if (entry.isFile() && entry.name.endsWith('.md')) {
			const slug = path.join(relativeDir, entry.name.replace(path.extname(entry.name), '')).split(path.sep).join('/');
			const basename = slug.split('/').pop();
			const href = basename ? `/post/${basename}` : `${baseHref}/${slug}`;
			const raw = fs.readFileSync(entryPath, 'utf8');
			const { data } = matter(raw);
			const title = typeof data?.title === 'string' ? data.title : undefined;

			addToIndex(title, href);
			addToIndex(slug, href);
			if (basename) addToIndex(basename, href);
		}
	}
}

function buildIndex() {
	if (isIndexed) return;

	walkContent(projectsDir, '/projects');
	walkContent(postsDir, '/posts');
	walkContent(retrospectivesDir, '/retrospectives');

	isIndexed = true;
}

function resolveHref(label: string) {
	buildIndex();

	const cleaned = stripMdSuffix(label);
	const normalized = safeSlug(cleaned);
	return (
		linkIndex.get(label) ??
		linkIndex.get(label.trim()) ??
		linkIndex.get(cleaned) ??
		linkIndex.get(cleaned.trim()) ??
		linkIndex.get(normalized) ??
		`/search?q=${encodeURIComponent(label)}`
	);
}

function toNodes(text: string): PhrasingContent[] {
	const nodes: PhrasingContent[] = [];
	const pattern = /(!)?\[\[([^[\]]+)\]\]/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(text))) {
		const [full, bang, labelRaw] = match;
		if (match.index > lastIndex) {
			nodes.push({ type: 'text', value: text.slice(lastIndex, match.index) } as Text);
		}
		const label = labelRaw.trim();
		if (bang) {
			const image: Image = {
				type: 'image',
				url: label.startsWith('http') ? label : `./${label}`,
				alt: label,
			};
			nodes.push(image);
		} else {
			const href = resolveHref(label);
			const link: Link = {
				type: 'link',
				url: href,
				children: [{ type: 'text', value: label }],
			};
			nodes.push(link);
		}
		lastIndex = match.index + full.length;
	}

	if (lastIndex < text.length) {
		nodes.push({ type: 'text', value: text.slice(lastIndex) } as Text);
	}
	return nodes;
}

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

export default remarkWikiLinks;

