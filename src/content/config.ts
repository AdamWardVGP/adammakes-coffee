import { defineCollection, z } from "astro:content";

const blog = defineCollection({
    schema: z.object({
        title: z.string(),
        date: z.date(),
        description: z.string().optional(),
    }),
});

const recipes = defineCollection({
    schema: z.object({
        title: z.string(),
        date: z.date(),
        description: z.string().optional(),
    }),
});

const cats = defineCollection({
    schema: z.object({
        title: z.string(),
        date: z.date(),
        description: z.string().optional(),
        photos: z.array(z.object({
            src: z.string(),
            caption: z.string().optional(),
        })).optional(),
    }),
});

export const collections = {
    blog,
    recipes,
    cats,
};