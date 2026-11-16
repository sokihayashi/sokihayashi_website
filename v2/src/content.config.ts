import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Works = 1ファイル=1作品。src/content/works/ に .md を足すだけで増える。
//
// タグは2軸:
//   domain … 領域(何を作ったか)。複数可。
//   stance … 立場(依頼仕事か、自主制作か)。
// 説明も2種類:
//   summary … 短文(60〜80字)。一覧と詳細の冒頭に出る。
//   本文    … 長文(300〜400字)。課題・判断・やったこと・結果。
export const DOMAINS = {
  branding: 'Branding',
  graphic: 'Graphic',
  photography: 'Photography',
  movie: 'Movie',
  '3d': '3D',
  'uiux-web': 'UIUX・Web',
  sculpture: '立体',
} as const;

export const STANCES = {
  client: 'Client work',
  original: 'Original work',
} as const;

const domainKeys = Object.keys(DOMAINS) as [keyof typeof DOMAINS, ...(keyof typeof DOMAINS)[]];

const works = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/works' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    client: z.string().optional(),
    role: z.array(z.string()).default([]),
    year: z.number().optional(),
    domain: z.array(z.enum(domainKeys)).min(1),
    stance: z.enum(['client', 'original']).default('client'),
    // カバー画像は後で。今はアクセント色のプレースホルダで描画する。
    cover: z.string().optional(),
    accent: z.string().default('#e8e2d6'),
    // 外部の関連リンク(プレスリリース等)。詳細ページの末尾に出す。
    url: z.string().url().optional(),
    // トップに出すか。
    featured: z.boolean().default(true),
    // 表示順(小さいほど先頭)。
    order: z.number().default(999),
    // true の間は、タグや文面が未確認の仮データであることを示す。
    provisional: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

export const collections = { works };
