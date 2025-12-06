import { defineCollection, z } from 'astro:content';

const projects = defineCollection({
	type: 'content',
	schema: z.object({
		title: z.string(),
		created: z.string(),
		modified: z.string().optional(),
		tags: z.array(z.string()).optional(),
		summary: z.string().optional(),
		uploaded: z.boolean().optional(),
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
		uploaded: z.boolean().optional(),
	}),
});

export const collections = { projects, posts };

