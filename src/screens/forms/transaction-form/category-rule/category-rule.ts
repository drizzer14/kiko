import { normalizeTransactionName } from '@kiko/transactions/normalize-name';
import { DEFAULT_CATEGORY_KEY, resolveCategoryDisplay } from '@kiko/categories/category-display';

// The rule-matched category for a typed description, or null when no rule
// matches or the normalized name is blank. Matching is JS-normalized (never
// SQL), the same normalize-then-match the sync insert path uses. Kept module-
// level and pure so the description-blur branch stays out of the screen
// component's cognitive-complexity budget.
export const ruleCategoryFor = (
  description: string,
  categoryByNormalizedName: ReadonlyMap<string, string>,
): string | null => {
  const key = normalizeTransactionName(description);

  return key === '' ? null : (categoryByNormalizedName.get(key) ?? null);
};

// Whether `save` needs to raise the propagation-confirm sheet, and with what
// payload: only when the category actually changed AND the affected name is
// non-blank. `upsertCategoryOverride` refuses to write a rule for a blank
// normalized name (it must not become a catch-all), so confirming propagation
// for one asked `Apply "Groceries" to all transactions named ""?` and then
// wrote nothing — the row's own category is already persisted by `writeManual`
// regardless, so `save` just returns to the list instead. Kept module-level
// and pure for the same cognitive-complexity-budget reason as
// `MODE_BEHAVIOR`'s field-error functions.
export const resolveCategoryOverrideRequest = (
  categoryChanged: boolean,
  selectedCategory: string | null,
  name: string,
): { name: string; category: string } | null => {
  if (!categoryChanged || selectedCategory === null || normalizeTransactionName(name) === '') {
    return null;
  }

  return { name, category: selectedCategory };
};

// Resolve the pending override's category into the icon name and the confirm
// copy the "Apply Category to All" sheet shows. The sheet renders the glyph
// white (textPrimary), not its category color, so only the icon name is needed
// here. Kept module-level so its null branch stays out of the screen
// component's cognitive-complexity budget.
type PendingCategoryView = { icon: string; message: string };

// `buildMessage` resolves the catalog's interpolated confirm copy; passed in
// (rather than read from a module-level template) so this helper stays
// translation-agnostic.
export const resolvePendingCategory = (
  pendingOverride: { name: string; category: string } | null,
  categoryByKey: Parameters<typeof resolveCategoryDisplay>[1],
  buildMessage: (category: string, name: string) => string,
): PendingCategoryView | null => {
  if (pendingOverride === null) {
    return null;
  }

  // `pendingOverride.category` is always a user-PICKED, valid category key, so
  // the default-category fallback is never consulted here — the shared constant
  // is passed only to satisfy the resolver's signature (no settings read needed).
  const display = resolveCategoryDisplay(
    pendingOverride.category,
    categoryByKey,
    DEFAULT_CATEGORY_KEY,
  );

  return {
    icon: display.icon,
    message: buildMessage(display.title, pendingOverride.name.trim()),
  };
};
