// A transaction stores a category as a stable key (the MCC category name,
// lowercased — see Task 13's slug convention). The categories table maps that
// key to the user-editable title + icon, so the display resolves through the
// table rather than any hard-coded map.
type CategoryDisplay = { title: string; icon: string };

// Shown when a category cannot be resolved and the table has no seeded `other`
// row (e.g. before the seed migration runs). A null/empty category also lands
// here so its label matches the filter bar's own "Uncategorized" chip.
export const NEUTRAL_CATEGORY: CategoryDisplay = { title: 'Uncategorized', icon: 'creditcard' };

// Build the key → display lookup a screen resolves each row's category through.
// Sourced from the categories live query so a rename flows straight through to
// every row without touching the stored transaction key. Kept here, next to the
// resolver that consumes it, so both screens build the map the same way.
export const buildCategoryDisplayMap = (
  categories: readonly { key: string; title: string; icon: string }[],
): ReadonlyMap<string, CategoryDisplay> =>
  new Map(
    categories.map((category) => [category.key, { title: category.title, icon: category.icon }]),
  );

export const resolveCategoryDisplay = (
  category: string | null,
  byKey: ReadonlyMap<string, CategoryDisplay>,
): CategoryDisplay => {
  const key = category?.toLowerCase();

  if (!key) {
    return NEUTRAL_CATEGORY;
  }

  return byKey.get(key) ?? byKey.get('other') ?? NEUTRAL_CATEGORY;
};
