// @ts-check
import { defineConfig } from 'astro/config';
import { remarkWikiLinks } from './src/plugins/remarkWikiLinks.ts';

// https://astro.build/config
export default defineConfig({
    site: 'https://kmsk99.github.io',
	markdown: {
		remarkPlugins: [remarkWikiLinks],
	},
});
