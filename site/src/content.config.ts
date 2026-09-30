import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// YAML parses bare dates as Date objects; accept either and keep YYYY-MM-DD.
const day = z.union([z.string(), z.date()]).transform((v) => (typeof v === "string" ? v : v.toISOString().slice(0, 10)));

const demos = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/demos" }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    url: z.string().url(),
    source: z.string().url().optional(),
    owner: z.string(),
    stack: z.array(z.string()).default([]),
    status: z.enum(["live", "unverified", "retired"]).default("unverified"),
    verified: day.optional(), // YYYY-MM-DD, the last day someone saw it working
    order: z.number().default(100),
  }),
});

const guides = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/guides" }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    demo: z.string().optional(), // slug of the demo this guide belongs to
    updated: day,
    order: z.number().default(100),
  }),
});

export const collections = { demos, guides };
