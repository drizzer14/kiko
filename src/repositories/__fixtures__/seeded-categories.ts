// The 10 rows the Task 13 migration seeds (key / title / icon), mirrored as a
// single test fixture so a screen test that needs the production-seeded
// categories references one source of truth instead of re-inlining the literal
// (which jscpd would flag as a cross-file clone).
type SeededCategory = { key: string; title: string; icon: string };

export const SEEDED_CATEGORIES: SeededCategory[] = [
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'dining', title: 'Dining', icon: 'fork.knife' },
  { key: 'transport', title: 'Transport', icon: 'car' },
  { key: 'shopping', title: 'Shopping', icon: 'bag' },
  { key: 'utilities', title: 'Utilities', icon: 'bolt' },
  { key: 'entertainment', title: 'Entertainment', icon: 'gamecontroller' },
  { key: 'health', title: 'Health', icon: 'cross.case' },
  { key: 'cash', title: 'Cash', icon: 'banknote' },
  { key: 'transfers', title: 'Transfers', icon: 'arrow.left.arrow.right' },
  { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
];
