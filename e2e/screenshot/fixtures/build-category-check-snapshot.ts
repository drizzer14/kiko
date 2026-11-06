// The demo snapshot plus the rows a person needs to check the category automation on a
// simulator (`README.md`, "The category check file"). It is a check file, not a reviewer or
// screenshot file: the committed demo files stay as they are and this layers on top of the
// English one. Pure like `build-demo-snapshot.ts`: no DB, no clock.
import { maxOf } from '@kiko/numbers';
import type { DataSnapshot } from '@kiko/data-transfer';
import type { CategoryRow, TransactionRow } from '@kiko/db';

import { buildDemoCalendar } from '../seed/demo-calendar';
import { buildScreenshotDataset } from '../seed/screenshot-seed';

import { buildDemoSnapshot } from './build-demo-snapshot';

// The app writes a v4 UUID for a user-made category, which the secret scan reads as an API key;
// the key is plain text to every reader, so a readable one stands in.
export const LONG_TITLE_CATEGORY_KEY = 'custom-home-renovation';
export const LONG_TITLE = 'Home renovation and garden supplies';

type CheckRow = {
  description: string;
  amountMinorUnits: number;
  daysAgo: number;
  category: string;
  mcc?: number;
  setByHand?: boolean;
};

// What a 1.3 install held: rows with a code the MCC map gained in 1.4, still in `other`. The
// one-time back-fill moves each of them on import, except the row the user picked by hand.
const UPGRADE_ROWS: CheckRow[] = [
  {
    description: 'Hotel Dnipro',
    amountMinorUnits: -620_000,
    daysAgo: 3,
    category: 'other',
    mcc: 7011,
  },
  {
    description: 'Ryanair',
    amountMinorUnits: -410_000,
    daysAgo: 8,
    category: 'other',
    mcc: 4511,
  },
  {
    description: 'Wizz Air',
    amountMinorUnits: -285_000,
    daysAgo: 12,
    category: 'other',
    mcc: 3100,
  },
  {
    description: 'Sunrise Travel Agency',
    amountMinorUnits: -1_150_000,
    daysAgo: 16,
    category: 'other',
    mcc: 4722,
  },
  {
    description: 'Bistro Zamok',
    amountMinorUnits: -64_000,
    daysAgo: 6,
    category: 'other',
    mcc: 5811,
  },
  {
    description: 'Spa Hotel Carpathia',
    amountMinorUnits: -890_000,
    daysAgo: 19,
    category: 'entertainment',
    mcc: 7011,
    setByHand: true,
  },
];

// One merchant filed twice under the long-titled category and left once in `other`: its review
// line shows that category as a chip. The gaps are uneven, so the rows cannot read as a series.
const CHIP_ROWS: CheckRow[] = [
  {
    description: 'Bud Depot',
    amountMinorUnits: -184_000,
    daysAgo: 4,
    category: LONG_TITLE_CATEGORY_KEY,
    setByHand: true,
  },
  {
    description: 'Bud Depot',
    amountMinorUnits: -96_500,
    daysAgo: 13,
    category: LONG_TITLE_CATEGORY_KEY,
    setByHand: true,
  },
  { description: 'Bud Depot', amountMinorUnits: -142_000, daysAgo: 26, category: 'other' },
];

// One merchant with two rows in `other` and one the app already filed under groceries by its
// code: a rule on its name moves all three, though the review line lists two.
const CONFIRM_ROWS: CheckRow[] = [
  { description: 'Podil Bakery', amountMinorUnits: -8_400, daysAgo: 3, category: 'other' },
  { description: 'Podil Bakery', amountMinorUnits: -9_600, daysAgo: 11, category: 'other' },
  {
    description: 'Podil Bakery',
    amountMinorUnits: -7_800,
    daysAgo: 24,
    category: 'groceries',
    mcc: 5411,
  },
];

const CHECK_ROWS: CheckRow[] = [...UPGRADE_ROWS, ...CHIP_ROWS, ...CONFIRM_ROWS];

export const buildCategoryCheckSnapshot = (anchor: number): DataSnapshot => {
  const demo = buildDemoSnapshot(buildScreenshotDataset('en', anchor));
  const calendar = buildDemoCalendar(anchor);
  // The first holding is the main Monobank card, the one the demo's rows sit on.
  const [card] = demo.holdings;
  const opening = demo.transactions
    .filter((row) => row.holdingId === card.id)
    .reduce((earliest, row) => (row.time < earliest.time ? row : earliest));
  const spent = CHECK_ROWS.reduce((total, row) => total - row.amountMinorUnits, 0);
  const rowOf = (row: CheckRow, index: number): TransactionRow => ({
    ...opening,
    id: `txn-${demo.transactions.length + index + 1}`,
    amountMinorUnits: row.amountMinorUnits,
    time: calendar.at(row.daysAgo),
    description: row.description,
    category: row.category,
    mcc: row.mcc ?? null,
    categorySetByHand: row.setByHand ?? false,
  });
  const longTitleCategory: CategoryRow = {
    key: LONG_TITLE_CATEGORY_KEY,
    title: LONG_TITLE,
    icon: 'hammer',
    color: null,
    sortOrder: maxOf(demo.categories.map((category) => category.sortOrder)) + 1,
  };

  return {
    ...demo,
    // The new rows are paid from the card, so its opening deposit grows by their total and the
    // card keeps its end balance.
    transactions: [
      ...demo.transactions.map((row) =>
        row.id === opening.id ? { ...row, amountMinorUnits: row.amountMinorUnits + spent } : row,
      ),
      ...CHECK_ROWS.map(rowOf),
    ],
    categories: [...demo.categories, longTitleCategory],
    // The file reads as one a 1.3 install wrote, so the one-time move runs on import. The key
    // stays in the row, so the restore keeps the file's own Travel category.
    settings: demo.settings.map((row) => ({ ...row, mccCategoriesBackfilled: false })),
  };
};
