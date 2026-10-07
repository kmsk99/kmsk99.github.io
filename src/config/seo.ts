export const SITE = {
	title: '김민석 · CTO & Product Engineering',
	description: '제이에이치핏 CTO 김민석의 경력과 기술 기록. 웹·모바일 제품 개발, AI 하네스와 온톨로지 엔지니어링.',
	url: 'https://kmsk99.github.io',
	siteName: '김민석 블로그',
	locale: 'ko_KR',
	defaultImage: '/images/mason-avatar.png',
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
