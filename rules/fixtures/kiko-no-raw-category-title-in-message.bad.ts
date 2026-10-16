import i18n from 'i18next';

// Semgrep fixture (POSITIVE): a seeded default category's stored title is its
// English seed text, so feeding the raw `category.title` into a user-facing
// message shows English under `uk`. `kiko-no-raw-category-title-in-message`
// MUST report a finding on every pinned line below — see kiko-translator's
// "A seeded default category is named by its displayed title everywhere".
type Category = { key: string; title: string };

export const labels = (t: typeof i18n.t, category: Category, row: { category: Category }) => {
  // EXPECT-FINDING
  const deleteTitle = t('common.deleteNamed', { name: category.title });

  // EXPECT-FINDING
  const iconLabel = t('common.changeIconLabel', { count: 1, title: category.title });

  // EXPECT-FINDING
  const rowLabel = i18n.t('common.deleteNamed', { title: row.category.title });

  return [deleteTitle, iconLabel, rowLabel];
};
