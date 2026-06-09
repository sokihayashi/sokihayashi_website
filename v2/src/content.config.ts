import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Works = 1ファイル=1作品。src/content/works/ に .md を足すだけで増える。
const works = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/works' }),
  schema: z.object({
    title: z.string(),
    client: z.string().optional(),
    role: z.array(z.string()).default([]),
    year: z.number().optional(),
    // 領域別カテゴリ(branding / logo-vi / graphic / web / movie / photo / 3dcg ...)
    category: z.array(z.string()).default([]),
    // カバー画像は後で。今はアクセント色プレースホルダで描画する。
    cover: z.string().optional(),
    accent: z.string().default('#e8e2d6'),
    url: z.string().url().optional(),
    // 表示順(小さいほど先頭)。未指定は後ろ。
    order: z.number().default(999),
    draft: z.boolean().default(false),
  }),
});

export const collections = { works };
