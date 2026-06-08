import wixData from 'wix-data';

const WORKS_DATASET_ID = '#dataset1';
const CATEGORIES_COLLECTION = 'lcks7c0hpd'; // ※後でコレクション名に直すかも
const WORKS_CATEGORIES_FIELD_KEY = 'number';

$w.onReady(function () {
  // 初期化が必要ならここ
});

// エディタの「イベント > Change」でこの関数名が自動作成されます
export async function selectTags1_change(event) {
  let selected = event.target.value;

  if (!Array.isArray(selected)) {
    selected = selected ? [selected] : [];
  }

  if (selected.length === 0 || selected.includes('all')) {
    await $w(WORKS_DATASET_ID).setFilter(wixData.filter());
    return;
  }

  const ids = await slugsToCategoryIds(selected);
  if (ids.length === 0) {
    await $w(WORKS_DATASET_ID).setFilter(wixData.filter());
    return;
  }

  await $w(WORKS_DATASET_ID).setFilter(
    wixData.filter().hasSome(WORKS_CATEGORIES_FIELD_KEY, ids)
  );
}

async function slugsToCategoryIds(slugs) {
  const res = await wixData.query(CATEGORIES_COLLECTION)
    .hasSome('slug', slugs)
    .limit(1000)
    .find();

  return res.items.map(i => i._id);
}
