import { defineConfig } from 'astro/config';

// 公開先ごとに URL が変わるので、環境変数で切り替えられるようにしてある。
//
//   何も指定しない … GitHub Pages(確認用)
//     https://sokihayashi.github.io/sokihayashi_website/
//
//   Cloudflare Pages / 独自ドメイン … ビルド時に次の2つを指定する
//     SITE_URL=https://www.soki-hayashi.com
//     BASE_PATH=/
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://sokihayashi.github.io',
  base: process.env.BASE_PATH ?? '/sokihayashi_website',
});
