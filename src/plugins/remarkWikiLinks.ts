import fs from 'node:fs';
import path from 'node:path';
import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Root, Text, Link, Image, PhrasingContent } from 'mdast';

const rootDir = process.cwd();
const projectsDir = path.join(rootDir, 'src', 'content', 'projects');
const postsDir = path.join(rootDir, 'src', 'content', 'posts');

const projects = new Set<string>();
const posts = new Set<string>();

function safeSlug(value: string) {
	return value
		.toString()
		.normalize('NFKD')
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.toLowerCase();
}

function buildIndex() {
	if (projects.size === 0 && fs.existsSync(projectsDir)) {
		for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				projects.add(entry.name);
			}
		}
	}
	if (posts.size === 0 && fs.existsSync(postsDir)) {
		for (const entry of fs.readdirSync(postsDir, { withFileTypes: true })) {
			if (entry.isFile()) {
				const slug = entry.name.replace(path.extname(entry.name), '');
				posts.add(slug);
			}
		}
	}
}

function resolveHref(label: string) {
	const slug = safeSlug(label);
	if (projects.has(slug)) return `/projects/${slug}`;
	if (posts.has(slug)) return `/posts/${slug}`;
	return `/search?q=${encodeURIComponent(label)}`;
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

