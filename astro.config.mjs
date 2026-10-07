// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { remarkWikiLinks } from './src/plugins/remarkWikiLinks.ts';

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
	integrations: [sitemap()],
});
