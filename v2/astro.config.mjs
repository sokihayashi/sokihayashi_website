import { defineConfig } from 'astro/config';

// 公開ドメインが決まったら site を本番URLに差し替え(OGP/sitemap等で使用)
export default defineConfig({
  site: 'https://sokihayashi.example.com',
});
