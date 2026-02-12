import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { SITE } from '../config/seo';

export async function GET(context: { site: URL }) {
	const posts = await getCollection('posts');

	const sortedPosts = posts.sort((a, b) => {
		const dateA = new Date(a.data.created).getTime();
		const dateB = new Date(b.data.created).getTime();
		return dateB - dateA;
	});

	return rss({
		title: SITE.title,
		description: SITE.description,
		site: context.site ?? SITE.url,
		items: sortedPosts.map((post) => {
			const segments = post.id.split('/');
			const slugRaw = segments[segments.length - 1];
			const slug = slugRaw.replace(/\.md$/i, '');
			return {
				title: post.data.title,
				description: post.data.summary ?? '',
				pubDate: new Date(post.data.created),
				link: `/post/${slug}`,
				categories: post.data.tags ?? [],
			};
		}),
		customData: `<language>ko</language>`,
	});
}
