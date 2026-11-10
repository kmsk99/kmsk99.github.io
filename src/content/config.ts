import { defineCollection, z } from 'astro:content';

const projects = defineCollection({
	type: 'content',
	schema: z.object({
		title: z.string(),
		created: z.string(),
		modified: z.string().optional(),
		tags: z.array(z.string()).optional(),
		summary: z.string().optional(),
		// 예약 발행 시각(ISO 8601, 예: 2026-11-13T09:00:00+09:00). 이 시각 전 빌드에서는 글을 빼고 만든다.
		publishAt: z.string().optional(),
	}),
});

const posts = defineCollection({
	type: 'content',
	schema: z.object({
		title: z.string(),
		created: z.string(),
		modified: z.string().optional(),
		tags: z.array(z.string()).optional(),
		summary: z.string().optional(),
		// 예약 발행 시각(ISO 8601, 예: 2026-11-13T09:00:00+09:00). 이 시각 전 빌드에서는 글을 빼고 만든다.
		publishAt: z.string().optional(),
	}),
});

const retrospectives = defineCollection({
	type: 'content',
	schema: z.object({
		title: z.string(),
		created: z.string(),
		modified: z.string().optional(),
		tags: z.array(z.string()).optional(),
		summary: z.string().optional(),
		// 예약 발행 시각(ISO 8601, 예: 2026-11-13T09:00:00+09:00). 이 시각 전 빌드에서는 글을 빼고 만든다.
		publishAt: z.string().optional(),
	}),
});

const assets = defineCollection({
	type: 'data',
	schema: z.object({}),
});

export const collections = { projects, posts, retrospectives, assets };

