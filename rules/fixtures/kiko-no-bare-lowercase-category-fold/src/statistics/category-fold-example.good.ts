// Semgrep fixture (NEGATIVE, NESTED): mirrors category-fold-example.bad.ts's
// own path (kiko-linter's "Semgrep facts" — see that fixture's own header).
// Resolves through `resolveCategoryKey`, which also folds an unresolvable
// slug, instead of a bare `.toLowerCase() || default`.
import { resolveCategoryKey, type CategoryDisplay } from '@kiko/categories/category-display';

export const groupKey = (
  category: string | null,
  byKey: ReadonlyMap<string, CategoryDisplay>,
  defaultKey: string,
): string => resolveCategoryKey(category, byKey, defaultKey);

// A `.toLowerCase()` used for something OTHER than a category fold (no `||`
// default) never matches this rule.
export const normalizedName = (name: string): string => name.toLowerCase().trim();
