export const SITE = {
	title: '김민석 · Astro 포트폴리오',
	description: '김민석의 포트폴리오와 기술 블로그.',
	url: 'https://kmsk99.github.io',
	siteName: '김민석 블로그',
	locale: 'ko_KR',
	defaultImage: '/favicon.svg',
	author: {
		name: '김민석',
		url: 'https://kmsk99.github.io',
	},
};

const siteToString = (site?: string | URL) => {
	if (!site) return undefined;
	return typeof site === 'string' ? site : site.toString();
};

export const absoluteUrl = (value?: string, site?: string | URL) => {
	if (!value) return undefined;
	if (/^https?:\/\//i.test(value)) return value;

	const base = siteToString(site);
	if (!base) return value;

	return new URL(value, base).toString();
};
