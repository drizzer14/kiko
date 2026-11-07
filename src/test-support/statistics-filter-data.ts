import { DAY_MS } from '@kiko/dates';
import type { TransactionRow } from '@kiko/db';
import { toUtcMidnight } from '@kiko/rates/history-entry';
import { act, fireEvent } from '@testing-library/react-native';

import { localDaysFrom } from './local-days-from';

export const ACCOUNT_FILTER = 'statistics-account-filter';
export const CATEGORY_FILTER = 'statistics-category-filter';

const now = Date.now();

const ACCOUNTS = [
  { id: 'a', name: 'Cash', kind: 'cash', color: null },
  { id: 'b', name: 'Bank', kind: 'bank', color: null },
];

const HOLDINGS = [
  {
    id: 'h1',
    accountId: 'a',
    currency: 'UAH',
    type: 'cash',
    balanceMinorUnits: 100_000,
    metadata: null,
    closedAt: null,
  },
  {
    id: 'h2',
    accountId: 'b',
    currency: 'UAH',
    type: 'card',
    balanceMinorUnits: 50_000,
    metadata: null,
    closedAt: null,
  },
];

const CATEGORIES = [
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'transport', title: 'Transport', icon: 'car' },
];

/**
 * The ledger columns a test sets on a row, as the database returns them. It has no `mcc`,
 * `counterIban` or `description`.
 */
type FilterTransaction = Pick<
  TransactionRow,
  | 'id'
  | 'holdingId'
  | 'time'
  | 'amountMinorUnits'
  | 'category'
  | 'setsBalance'
  | 'changeGroupId'
  | 'exchangePairId'
  | 'exchangeCounterpartHoldingId'
  | 'untrackedCounterpart'
  | 'loanHoldingId'
>;

// A matcher keeps a row on `=== null` or `!== null`, so a column left out reads as a value, never
// as no value: every column starts as the database gives it for a plain row.
const PLAIN_ROW = {
  category: null,
  setsBalance: false,
  changeGroupId: null,
  exchangePairId: null,
  exchangeCounterpartHoldingId: null,
  untrackedCounterpart: null,
  loanHoldingId: null,
};

/** A plain transaction row with the columns a test sets, the rest as the database gives them. */
export const transactionRowOf = (
  row: Pick<FilterTransaction, 'id' | 'holdingId' | 'time' | 'amountMinorUnits'> &
    Partial<FilterTransaction>,
): FilterTransaction => ({ ...PLAIN_ROW, ...row });

// Each row is a categorized spending on one account, so the pie and the trend have both to show.
const TRANSACTIONS = [
  transactionRowOf({
    id: 'e1',
    holdingId: 'h1',
    time: localDaysFrom(now, -2),
    amountMinorUnits: -300_00,
    category: 'groceries',
  }),
  transactionRowOf({
    id: 'e2',
    holdingId: 'h2',
    time: localDaysFrom(now, -2),
    amountMinorUnits: -100_00,
    category: 'transport',
  }),
];

const HISTORY = [
  { base: 'USD', quote: 'UAH', day: toUtcMidnight(now) - 5 * DAY_MS, rate: '40', source: 'nbu' },
];

const SPAN = [{ earliest: TRANSACTIONS[0].time, latest: TRANSACTIONS[0].time }];

const BY_TABLE: Record<string, unknown[]> = {
  accounts: ACCOUNTS,
  holdings: HOLDINGS,
  currency_rates: [],
  settings: [{ baseCurrency: 'UAH' }],
  transactions: TRANSACTIONS,
  currency_rate_history: HISTORY,
  categories: CATEGORIES,
  price_points: [],
};

/**
 * What every `useLiveQuery` of Home and Statistics reads: two accounts with a holding each, and a
 * categorized spending on each, keyed by the first table the query watches.
 */
export const answerFilterData = (query: { kind?: string }, tables: string[]) => ({
  data: tables[0] === 'transactions' && query.kind === 'span' ? SPAN : (BY_TABLE[tables[0]] ?? []),
  isLoading: false,
  isFresh: true,
});

type PressTarget = Parameters<typeof fireEvent.press>[0];

/** Opens one filter menu, taps an option row, then dismisses the sheet through its backdrop. */
export const pressFilterOption = async (
  getByTestId: (id: string) => PressTarget,
  menuTestID: string,
  value: string,
): Promise<void> => {
  await act(async () => {
    await fireEvent.press(getByTestId(menuTestID));
  });
  await act(async () => {
    await fireEvent.press(getByTestId(`${menuTestID}-option-${value}`));
  });
  await act(async () => {
    await fireEvent.press(getByTestId(`${menuTestID}-backdrop`));
  });
};
