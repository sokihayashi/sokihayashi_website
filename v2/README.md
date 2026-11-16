# Soki Hayashi — v2(新サイト・開発中)

現行の Wix サイトはそのまま運用しつつ、裏で育てているコード製の新ポートフォリオ。
方針の全体は [`../docs/v2-direction.md`](../docs/v2-direction.md) にある。

## いまの状態

- 考え方: 価値は最初からある。形だけがない。掬って、器に流し込むと、形になる。
- トップ(PC)は**斜めの軸**。水滴(HYDRA)を切ると、飛沫が器の口へ飛び、器に液が上がり、満ちると澄んで作品が見える。
- トップ(スマホ)は**真縦**。ブラウザ本来のスクロールで、1画面に1案件。
- 1器=1案件。中央の列が代表8件、外側の列(PCのみ)がそのほかの案件。最後に空の器(Contact)。
- 作品は27案件。画像は `public/img/wall/` にある(Wix は参照していない)。
- 文字は少なく。説明文は、本人の公開文があるものだけ入っている。

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
summary: ""                       # 短い説明。本人の言葉があるときだけ
client: "クライアント"            # 任意
role: ["Art Direction", "Logo"]   # 任意
year: 2025                        # 任意
domain: ["branding", "graphic"]   # branding / graphic / photography / movie / 3d / uiux-web / sculpture
stance: "client"                  # client / original
images: [16, 17, 18]              # public/img/wall/ の通し番号。先頭が表紙
featured: true                    # トップの中央の列に出すか
order: 1                          # 小さいほど先頭
provisional: true                 # 内容を確認したら消す
---

本文(任意)。
```

## 確認用の指定

トップの URL の末尾に付けると、その状態で開ける。

| 指定 | 意味 |
|---|---|
| `#w=3` | 3番目の案件から、満ちた状態で開く(戻る・共有でも使われる) |
| `#a=40` | 軸の角度(度)。90=縦 / 28=斜め / 0=横(PCのみ) |
| `#p=2400` | 送り位置(px。PCのみ) |

一覧は `/works/?d=branding&s=client` で絞り込んだ状態を開ける。

## このあと

- [ ] 案件の束ね方・名前・年・依頼主・役割を本人が確認する(全件 `provisional: true`)
- [ ] 未分類の16枚の扱い
- [ ] 軸の角度と、トップに出す8件を決める
- [ ] HYDRA を埋め込み枠から出し、素の WebGL の描画面1枚へ(飛沫も同じシェーダーで描く)
- [ ] 低性能端末では水滴を静止画にする
- [ ] ページ移動の演出(押した器の液が、詳細の表紙へ移る)
- [ ] 書体を決める(いまは仮)
- [ ] Contact のフォーム
- [ ] Cloudflare Pages への接続と独自ドメイン
