// The seeded catch-all category key. It is the INITIAL value of the
// user-configurable `settings.defaultCategoryKey` (see the schema/migration),
// and the single fallback a screen uses when the settings row has not been read
// yet — so `'other'` lives in ONE place, never scattered across call sites. The
// pure resolvers take the resolved key as a parameter and never reference this.
export const DEFAULT_CATEGORY_KEY = 'other';

// A transaction stores a category as a stable key (the MCC category name,
// lowercased — see Task 13's slug convention). The categories table maps that
// key to the user-editable title + icon + optional color, so the display
// resolves through the table rather than any hard-coded map. `color` is the
// category's stored `#RRGGBB` hex, or null when none is picked (the chart layer
// then falls back to the per-key palette hash via resolveCategoryColor).
type CategoryDisplay = { title: string; icon: string; color: string | null };

// The ultimate fallback, shown only when a category cannot be resolved AND the
// table has no default-category row either (e.g. before the seed migration
// runs). In normal operation a null/empty/unknown category folds into the
// DEFAULT category instead (see `resolveCategoryDisplay`), so there is no
// separate "Uncategorized" bucket. `color` is null so the chart falls back to
// the neutral key's palette hue.
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

/**
 * Resolve a transaction's stored category to its display. A null, empty, or
 * unresolved category folds into the DEFAULT category (`defaultKey`, a
 * `categories.key` read from settings at the call site — never hardcoded here),
 * so uncategorized spending merges into the default's slice rather than a
 * separate bucket. `NEUTRAL_CATEGORY` is the last resort only when the default
 * key itself is not in the map (e.g. before the seed runs).
 */
export const resolveCategoryDisplay = (
  category: string | null,
  byKey: ReadonlyMap<string, CategoryDisplay>,
  defaultKey: string,
): CategoryDisplay => {
  const key = category?.toLowerCase();
  const resolved = key ? byKey.get(key) : undefined;

  return resolved ?? byKey.get(defaultKey) ?? NEUTRAL_CATEGORY;
};
