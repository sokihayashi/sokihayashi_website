import { defineConfig } from 'astro/config';

// GitHub Pages(プロジェクトページ)用の設定。
// 公開URL: https://sokihayashi.github.io/sokihayashi_website/
//
// ▼独自ドメインに移行するとき
//   base を '/' に変えて、site を本番ドメイン(例 https://soki-hayashi.com)にする。
export default defineConfig({
  site: 'https://sokihayashi.github.io',
  base: '/sokihayashi_website',
});
