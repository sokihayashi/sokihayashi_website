// API Reference: https://www.wix.com/velo/reference/api-overview/introduction
//
// このファイルはサイトの全ページで共通して読み込まれます。
// ここでは「構造化データ(JSON-LD)」を設定し、検索エンジンに
// 林宋其(Soki Hayashi)が何者か=Person(人物)として機械可読で伝えます。
// ※見た目には一切影響しません。検索エンジン向けの裏側の情報です。

import wixSeoFrontend from 'wix-seo-frontend';

// --- 構造化データ:Person(人物)スキーマ -------------------------------
// 内容はすべて確定版プロフィールに基づく事実情報です。
// 公開URL等が変わったら、ここの値を更新してください。
const personStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: '林宋其',
    alternateName: 'Soki Hayashi',
    url: 'https://www.soki-hayashi.com',
    jobTitle: ['デザイナー', 'クリエイティブディレクター'],
    description:
        'アナログな素材・技法・歴史への深い理解を起点に、最新のテクノロジーでデジタル上にも手触りのある表現を立ち上げるデザイナー/クリエイティブディレクター。媒体ではなく課題から最適な手段を組み立て、ブランドや事業の構造そのものを設計する。',
    alumniOf: {
        '@type': 'CollegeOrUniversity',
        name: '東京藝術大学',
        sameAs: 'https://www.geidai.ac.jp/'
    },
    knowsAbout: [
        'ブランディング',
        'ロゴデザイン',
        'VI',
        'グラフィックデザイン',
        'Webデザイン',
        'UIデザイン',
        '映像制作',
        '写真',
        '3DCG',
        '立体造形',
        'コンセプト設計'
    ],
    // TODO(林さん): YouTube・各SNS・他媒体の「正式なURL」をここに追加してください。
    // 例: 'https://www.youtube.com/@artoone'
    // 確実なURLが分からない値は、私(Claude)が勝手に入れていません。
    sameAs: []
};

$w.onReady(async function () {
    // 構造化データの設定。万一APIが失敗してもサイト表示には影響させない。
    try {
        await wixSeoFrontend.setStructuredData([personStructuredData]);
    } catch (err) {
        console.error('構造化データの設定に失敗しました:', err);
    }
});
