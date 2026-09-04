// A transaction stores a category as a stable key (the MCC category name,
// lowercased — see Task 13's slug convention). The categories table maps that
// key to the user-editable title + icon + optional color, so the display
// resolves through the table rather than any hard-coded map. `color` is the
// category's stored `#RRGGBB` hex, or null when none is picked (the chart layer
// then falls back to the per-key palette hash via resolveCategoryColor).
type CategoryDisplay = { title: string; icon: string; color: string | null };

// Shown when a category cannot be resolved and the table has no seeded `other`
// row (e.g. before the seed migration runs). A null/empty category also lands
// here so its label matches the filter bar's own "Uncategorized" chip. `color`
// is null so the chart falls back to the neutral key's palette hue.
export const NEUTRAL_CATEGORY: CategoryDisplay = {
  title: 'Uncategorized',
  icon: 'creditcard',
  color: null,
};

// Build the key → display lookup a screen resolves each row's category through.
// Sourced from the categories live query so a rename (or recolor) flows straight
// through to every row without touching the stored transaction key. Kept here,
// next to the resolver that consumes it, so both screens build the map the same
// way. A row with no stored color carries `color: null`.
export const buildCategoryDisplayMap = (
  categories: readonly { key: string; title: string; icon: string; color?: string | null }[],
): ReadonlyMap<string, CategoryDisplay> =>
  new Map(
    categories.map((category) => [
      category.key,
      { title: category.title, icon: category.icon, color: category.color ?? null },
    ]),
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
