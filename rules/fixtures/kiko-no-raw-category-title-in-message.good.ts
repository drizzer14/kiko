import i18n from 'i18next';

// Semgrep fixture (NEGATIVE): every message names the category by its
// displayed title — `resolveDefaultCategoryTitle` for a stored row, or a
// `resolveCategoryDisplay(...)` result, whose `title` is already translated.
// An account's own `.title`, or a category title outside a message, must not
// match `kiko-no-raw-category-title-in-message`.
type Category = { key: string; title: string };

declare const resolveDefaultCategoryTitle: (key: string, storedTitle: string) => string;

declare const resolveCategoryDisplay: (key: string) => { title: string };

export const labels = (t: typeof i18n.t, category: Category, account: { title: string }) => {
  const displayName = resolveDefaultCategoryTitle(category.key, category.title);

  const deleteTitle = t('common.deleteNamed', { name: displayName });

  const accountTitle = t('common.deleteNamed', { name: account.title });

  const storedTitle = category.title;

  return [deleteTitle, accountTitle, storedTitle];
};

export const rowLabel = (t: typeof i18n.t, key: string) => {
  const category = resolveCategoryDisplay(key);

  return t('categories.deleteLabel', { title: category.title });
};
