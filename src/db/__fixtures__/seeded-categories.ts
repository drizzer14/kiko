// The 10 default categories a user ends up with (key / title / icon), mirrored
// as a single test fixture so a screen test that needs the production categories
// references one source of truth instead of re-inlining the literal (which jscpd
// would flag as a cross-file clone). 0002_seed_categories inserts these
// key/title rows with a `car` transport icon; 0014_default_category_colors then
// refines the transport icon to `bus`, so the effective default this fixture
// models is `bus`. The seed migration's own raw icons are asserted directly
// against the seed SQL in categories.repo.test.
type SeededCategory = { key: string; title: string; icon: string };

export const SEEDED_CATEGORIES: SeededCategory[] = [
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'dining', title: 'Dining', icon: 'fork.knife' },
  { key: 'transport', title: 'Transport', icon: 'bus' },
  { key: 'shopping', title: 'Shopping', icon: 'bag' },
  { key: 'utilities', title: 'Utilities', icon: 'bolt' },
  { key: 'entertainment', title: 'Entertainment', icon: 'gamecontroller' },
  { key: 'health', title: 'Health', icon: 'cross.case' },
  { key: 'cash', title: 'Cash', icon: 'banknote' },
  { key: 'transfers', title: 'Transfers', icon: 'arrow.left.arrow.right' },
  { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
];
