// The 10 default categories a user ends up with (key / title / icon), mirrored
// as a single test fixture so a screen test that needs the production categories
// references one source of truth instead of re-inlining the literal (which jscpd
// would flag as a cross-file clone). 0002_seed_categories inserts these
// key/title rows with a `car` transport icon and a `cross.case` health icon;
// 0017_default_category_colors then refines the transport icon to `bus`, and
// 0031_icon_health_category refines the health icon to `cross`, so the effective
// defaults this fixture models are `bus` and `cross`. The seed migration's own
// raw icons are asserted directly against the seed SQL in categories.repo.test.
type SeededCategory = { key: string; title: string; icon: string };

export const SEEDED_CATEGORIES: SeededCategory[] = [
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'dining', title: 'Dining', icon: 'fork.knife' },
  { key: 'transport', title: 'Transport', icon: 'bus' },
  { key: 'shopping', title: 'Shopping', icon: 'bag' },
  { key: 'utilities', title: 'Utilities', icon: 'bolt' },
  { key: 'entertainment', title: 'Entertainment', icon: 'gamecontroller' },
  { key: 'health', title: 'Health', icon: 'cross' },
  { key: 'cash', title: 'Cash', icon: 'banknote' },
  { key: 'transfers', title: 'Transfers', icon: 'arrow.left.arrow.right' },
  { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
];

// The ELEVENTH default category (T30, spec 5/D14 — "interest-only
// spending"), seeded by its OWN later migration
// (0039_seed_loan_interest_category, not 0002), so it is a SEPARATE export
// rather than a member of `SEEDED_CATEGORIES` above — every existing
// `SEEDED_CATEGORIES` consumer (categories.repo.test.ts's 0002-seed-SQL
// row-count assertion, schema.category-overrides.test.ts's 0017-color-seed
// key set, category-breakdown.test.ts's "ten keys" hue-collision test) pins
// EXACTLY 0002's original ten rows, and folding this in would desync every
// one of them from the migration each actually asserts against.
export const LOAN_INTEREST_CATEGORY: SeededCategory = {
  key: 'loan_interest',
  title: 'Loan interest',
  icon: 'percent',
};
