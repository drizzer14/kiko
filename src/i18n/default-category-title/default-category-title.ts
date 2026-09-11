import { i18n } from '../index';

// The exact English seed titles from drizzle/migrations/0002_seed_categories.sql,
// keyed by stable slug. A row whose title still equals its seed title is an
// un-renamed default and is safe to translate; any other title is user-typed and
// must be shown verbatim. This map is the ONLY link between the seed and the
// display layer — no schema "is default" flag exists.
const DEFAULT_CATEGORY_SEED_TITLES = {
  groceries: 'Groceries',
  dining: 'Dining',
  transport: 'Transport',
  shopping: 'Shopping',
  utilities: 'Utilities',
  entertainment: 'Entertainment',
  health: 'Health',
  cash: 'Cash',
  transfers: 'Transfers',
  other: 'Other',
};

// The literal union of seeded slugs, derived from the map above so it can
// never drift out of sync with it. Narrowing `key: string` to this union (via
// `isSeedCategoryKey` below) before it reaches `i18n.t` is what lets tsc
// verify `categories.${key}` against the real catalog keys, the same
// narrow-then-call pattern used at other dynamic-key call sites (e.g.
// `accounts.screen.tsx`'s `forms.account.${item.kind}`, where `item.kind` is
// already a literal union from the schema).
type SeedCategoryKey = keyof typeof DEFAULT_CATEGORY_SEED_TITLES;

const isSeedCategoryKey = (key: string): key is SeedCategoryKey =>
  Object.hasOwn(DEFAULT_CATEGORY_SEED_TITLES, key);

/**
 * The display title for a category, translated only when it is an un-renamed
 * seeded default. If the stored title still matches the English seed title for
 * its key, return the catalog's translated label (categories.<key>); otherwise
 * the user has renamed it (or it is a custom category), so return the stored
 * title unchanged. Never mutates a row.
 */
export const resolveDefaultCategoryTitle = (key: string, storedTitle: string): string => {
  if (isSeedCategoryKey(key) && storedTitle === DEFAULT_CATEGORY_SEED_TITLES[key]) {
    return i18n.t(`categories.${key}`);
  }

  return storedTitle;
};
