// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { remarkWikiLinks } from './src/plugins/remarkWikiLinks.ts';
import fs from 'node:fs';
import path from 'node:path';

// 예약 글(publishAt이 빌드 시각보다 미래)은 사이트맵에서 뺀다. 화면 공개는 브라우저가, 사이트맵·RSS는 다음 빌드가 맡는다.
function scheduledSlugs() {
	const out = new Set();
	const walk = (dir) => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) walk(p);
			else if (e.name.endsWith('.md')) {
				const m = fs.readFileSync(p, 'utf8').match(/^publishAt:\s*["']?([^"'\n]+)["']?\s*$/m);
				if (m && Date.parse(m[1]) > Date.now() && process.env.SHOW_SCHEDULED !== '1') out.add(e.name.replace(/\.md$/i, ''));
			}
		}
	};
	walk(path.resolve('src/content'));
	return out;
}
const hidden = scheduledSlugs();

// https://astro.build/config
export default defineConfig({
	site: 'https://kmsk99.github.io',
	markdown: {
		remarkPlugins: [remarkWikiLinks],
		shikiConfig: {
			themes: { light: 'github-light', dark: 'github-dark' },
			defaultColor: false,
			wrap: false,
		},
	},
	integrations: [
		sitemap({
			filter: (page) => {
				const slug = decodeURIComponent(new URL(page).pathname).match(/^\/post\/([^/]+?)(?:\.md)?\/?$/)?.[1];
				return !(slug && hidden.has(slug));
			},
		}),
	],
});
