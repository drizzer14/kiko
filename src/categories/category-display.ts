import { i18n } from '../i18n';
import { resolveDefaultCategoryTitle } from '../i18n/default-category-title';

// The seeded catch-all category key. It is the INITIAL value of the
// user-configurable `settings.defaultCategoryKey` (see the schema/migration),
// and the single fallback a screen uses when the settings row has not been read
// yet — so `'other'` lives in ONE place, never scattered across call sites. The
// pure resolvers take the resolved key as a parameter and never reference this.
export const DEFAULT_CATEGORY_KEY = 'other';

// A transaction stores a category as its stable `categories.key` slug (the
// lowercase MCC category name — see `monobank/mcc-category.ts`). The categories
// table maps that key to the user-editable title + icon + optional color, so
// the display resolves through the table rather than any hard-coded map.
// `color` is the category's stored `#RRGGBB` hex, or null when none is picked
// (the chart layer then falls back to the per-key palette hash via
// resolveCategoryColor). Exported so every consumer of a key -> display map
// (the spending breakdown) names the same shape instead of restating it.
export type CategoryDisplay = { title: string; icon: string; color: string | null };

// The ultimate fallback, shown only when a category cannot be resolved AND the
// table has no default-category row either (e.g. before the seed migration
// runs). In normal operation a null/empty/unknown category folds into the
// DEFAULT category instead (see `resolveCategoryDisplay`), so there is no
// separate "Uncategorized" bucket. `color` is null so the chart falls back to
// the neutral key's palette hue. A function (not a static constant) so its
// `title` re-resolves against the active language at call time, rather than
// freezing to whatever language was active when this module first loaded —
// this is a plain (non-component) module, so it reads the i18next instance
// directly rather than `useTranslation()`, the same pattern as
// `src/screens/grid-interaction.ts`.
export const neutralCategory = (): CategoryDisplay => ({
  title: i18n.t('categories.uncategorized'),
  icon: 'creditcard',
  color: null,
});

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
      {
        title: resolveDefaultCategoryTitle(category.key, category.title),
        icon: category.icon,
        color: category.color ?? null,
      },
    ]),
  );

/**
 * Resolve a transaction's stored category to its display. A null, empty, or
 * unresolved category folds into the DEFAULT category (`defaultKey`, a
 * `categories.key` read from settings at the call site — never hardcoded here),
 * so uncategorized spending merges into the default's slice rather than a
 * separate bucket. `neutralCategory()` is the last resort only when the
 * default key itself is not in the map (e.g. before the seed runs).
 */
export const resolveCategoryDisplay = (
  category: string | null,
  byKey: ReadonlyMap<string, CategoryDisplay>,
  defaultKey: string,
): CategoryDisplay => {
  const key = category?.toLowerCase();
  const resolved = key ? byKey.get(key) : undefined;

  return resolved ?? byKey.get(defaultKey) ?? neutralCategory();
};

/**
 * The STABLE identity a transaction's stored category resolves to — the same
 * fold-into-default resolution `resolveCategoryDisplay` uses, but returning
 * the `categories.key` slug instead of the display record. This is the
 * language-independent counterpart of that function's `title`: a slug never
 * changes when the active language does, so a caller that needs to key a
 * selection (e.g. a filter's selected-categories Set) off "which category is
 * this" — not off its current display label — should resolve through this
 * instead of `resolveCategoryDisplay(...).title`. An override's lowercase slug
 * and an un-overridden synced row's capitalized MCC name still collapse onto
 * the same key here, exactly as they collapse onto the same title above.
 */
export const resolveCategoryKey = (
  category: string | null,
  byKey: ReadonlyMap<string, CategoryDisplay>,
  defaultKey: string,
): string => {
  const key = category?.toLowerCase();

  return key !== undefined && key !== '' && byKey.has(key) ? key : defaultKey;
};
