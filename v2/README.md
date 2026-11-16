# Soki Hayashi — v2(新サイト・開発中)

現行の Wix サイトはそのまま運用しつつ、裏で育てているコード製の新ポートフォリオ。
方針の全体は [`../docs/v2-direction.md`](../docs/v2-direction.md) にある。

## いまの状態

- トップは**斜めスクロールのステージ**。スクロール(スワイプ)がそのまま「切る」になる。
- ヒーローは既存の HYDRA(`public/hydra/`)。スクロールの向きでカットを送っている。
- 作品は**2軸のタグ**(領域 / 立場)で絞り込める。外れたカードは切られて消える。
- 作品データは仮。公開済みの実績名と一文だけを入れてある(`provisional: true`)。

## スタック

- **Astro 5** … 静的に書き出す。作品は Markdown。
- **Lenis / GSAP** … トップ以外のページのなめらかスクロールと出現演出。
- トップのステージは自前実装(`src/scripts/stage.ts`)。ライブラリなし。
- 公開先(予定):Cloudflare Pages の無料プラン。確認用に GitHub Pages も使える。

## 動かし方

```bash
cd v2
npm install      # 初回のみ
npm run dev      # http://localhost:4321/sokihayashi_website/ で確認
npm run build    # 本番ビルド(dist/ に出力)
npm run preview  # ビルド結果を確認
```

Cloudflare Pages や独自ドメインに出すときは、ビルド時に環境変数を指定する。

```bash
SITE_URL=https://www.soki-hayashi.com BASE_PATH=/ npm run build
```

## 作品の足し方

`src/content/works/` に .md を1ファイル足すと、トップ・一覧・詳細に反映される。

```md
---
title: "作品名"
summary: "何を、誰のために作ったか。60〜80字。"
client: "クライアント"
role: ["Art Direction", "Logo"]
year: 2025
domain: ["branding", "graphic"]   # branding / graphic / photography / movie / 3d / uiux-web / sculpture
stance: "client"                  # client / original
accent: "#d9c7a3"                 # 画像が入るまでの色
url: "https://..."                # 関連リンク(任意)
featured: true                    # トップに出すか
order: 1                          # 小さいほど先頭
provisional: true                 # 内容を確認したら消す
---

本文。課題・判断・やったこと・結果を300〜400字で。
```

## 確認用の指定

トップの URL の末尾に付けると、その状態で開ける。

| 指定 | 意味 |
|---|---|
| `#a=40` | 軸の角度(度)。90=縦 / 28=斜め / 0=横 |
| `#p=2400` | スクロール位置(px) |
| `#f=branding` | 領域で絞り込み |
| `#s=original` | 立場で絞り込み |

組み合わせは `#a=40&p=2400&f=branding`。

## このあと

- [ ] 角度と緩急を決める(画面右下の角度切り替えは試作用。決まったら外す)
- [ ] カバー画像に対応する
- [ ] 作品の実データに差し替える
- [ ] 詳細ページを横スクロールの帯にする
- [ ] ページ移動を「切って次へ」の演出にする
- [ ] HYDRA を埋め込み枠から出し、ページ全体に常駐する描画面へ移す
- [ ] 低性能端末向けの軽い版
- [ ] Cloudflare Pages への接続と独自ドメイン
