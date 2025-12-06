import { defineCollection, z } from 'astro:content';

const projects = defineCollection({
	type: 'content',
	schema: z.object({
		title: z.string(),
		created: z.string(),
		modified: z.string().optional(),
		tags: z.array(z.string()).optional(),
		summary: z.string().optional(),
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
	}),
});

const assets = defineCollection({
	type: 'data',
	schema: z.object({}),
});

export const collections = { projects, posts, retrospectives, assets };

