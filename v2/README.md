# Soki Hayashi — v2(新サイト・開発中)

現行のWixサイトはそのまま運用しつつ、**裏で育てるコード製の新ポートフォリオ**です。
驚くギミックの天井をなくす目的で、Astro + GSAP/Lenis で構築しています。

## スタック
- **Astro 5** … 標準でJSゼロ=高速・SEOに強い。動きが要る所だけ後でReact/Three島を追加可。
- **Lenis** … なめらかスクロール
- **GSAP / ScrollTrigger** … スクロール演出
- 公開先(予定):Vercel または Netlify の無料枠

## 動かし方
```bash
cd v2
npm install      # 初回のみ
npm run dev      # http://localhost:4321 で確認
npm run build    # 本番ビルド(dist/ に出力)
npm run preview  # ビルド結果を確認
```

## 作品(Works)の足し方 ★ここが楽
`src/content/works/` に **.md を1ファイル足すだけ**で一覧に反映されます。

```md
---
title: "作品名"
client: "クライアント"
role: ["Logo", "VI"]
year: 2025
category: ["branding"]   # branding / logo-vi / graphic / web / movie / photo / 3dcg / sculpture
accent: "#d9c7a3"        # サムネ未設定時の色(画像対応は後で追加)
order: 1                  # 小さいほど先頭
url: "https://..."       # 詳細リンク(任意)
---

本文(Markdown自由記述)
```

## TODO(このあと)
- [ ] カバー画像対応(`cover` を Astro の画像最適化に接続)
- [ ] カテゴリ絞り込みUI
- [ ] 作品詳細ページ(動的ルート `works/[slug]`)
- [ ] ヒーローの3D/物理など“驚き”演出を1つ作り込む
- [ ] デプロイ設定(Vercel/Netlify)+ 独自ドメイン
- [ ] 実プロフィール文・実作品への差し替え
