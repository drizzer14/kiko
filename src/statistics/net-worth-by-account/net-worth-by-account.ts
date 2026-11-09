import { sumOf } from '@kiko/numbers';
import type { CalendarMonth } from '@kiko/dates';
import type { Currency } from '@kiko/currency/currency';
import type { RateTable } from '@kiko/rates/conversion';
import type { PriceBook } from '@kiko/prices/price-book';
import type { AccountRow, CurrencyRateHistoryRow, HoldingRow } from '@kiko/db';
import { accountSectionOf, accountSectionOrder } from '@kiko/holdings/implicit-account';

import { buildHoldingValues } from '../net-worth-series';
import type { SeriesHolding, SeriesTransaction } from '../holding-value-at';

type HistoryRow = Pick<CurrencyRateHistoryRow, 'base' | 'quote' | 'day' | 'rate'>;

type NetWorthByAccountInput = {
  /** In the order the accounts query returns them, with the archived ones already dropped. */
  accounts: readonly Pick<AccountRow, 'id' | 'kind' | 'archivedAt'>[];
  /** Closed holdings too: a closed one is valued up to the instant it closed. */
  holdings: readonly (SeriesHolding & Pick<HoldingRow, 'accountId'>)[];
  transactionsByHolding: Map<string, SeriesTransaction[]>;
  historyRows: HistoryRow[];
  baseCurrency: Currency;
  months: readonly CalendarMonth[];
  liveRateTable: RateTable;
  now: number;
  book: PriceBook;
};

type NetWorthByAccount = {
  /** One row per account that has a holding; cells and change in base-currency minor units. */
  rows: { accountId: string; cells: number[]; change: number }[];
  allCells: number[];
  allChange: number;
};

/**
 * The instant each column reads: the last millisecond of its month, or now for the month that is
 * still running, so the last column of the current month is the line's last point.
 */
export const monthEndInstants = (months: readonly CalendarMonth[], now: number): number[] =>
  months.map((month) => Math.min(month.end, now));

const sectionRankOf = (account: Pick<AccountRow, 'kind' | 'archivedAt'>): number =>
  accountSectionOrder.indexOf(accountSectionOf(account));

const holdingIdsByAccount = (
  holdings: NetWorthByAccountInput['holdings'],
): Map<string, string[]> => {
  const idsByAccount = new Map<string, string[]>();

  for (const holding of holdings) {
    const ids = idsByAccount.get(holding.accountId) ?? [];
    ids.push(holding.id);
    idsByAccount.set(holding.accountId, ids);
  }

  return idsByAccount;
};

/**
 * Each account's value at the end of every month, and the change across the period, over the same
 * per-holding values the net-worth line sums, so an All cell is the line at that instant. A loan
 * or a holding in debit nets inside its account. The change is the last column less the value at
 * the end of the month before the first column, which may lie before the first stored row.
 *
 * Empty where the line is empty (no holding, or a foreign holding with no stored history), and
 * with no month.
 */
export const buildNetWorthByAccount = (input: NetWorthByAccountInput): NetWorthByAccount => {
  const { accounts, holdings, months, now, ...rest } = input;

  if (months.length === 0) {
    return { rows: [], allCells: [], allChange: 0 };
  }

  const [baseline, ...columns] = buildHoldingValues({
    ...rest,
    holdings: [...holdings],
    instants: [months[0].start - 1, ...monthEndInstants(months, now)],
    today: now,
  }).map(({ byHolding }) => byHolding);

  if (baseline === undefined) {
    return { rows: [], allCells: [], allChange: 0 };
  }

  const idsByAccount = holdingIdsByAccount(holdings);
  const changeOf = (cells: number[], opening: number): number => (cells.at(-1) ?? 0) - opening;
  const allCells = columns.map((byHolding) => sumOf([...byHolding.values()]));

  const rows = [...accounts]
    .sort((a, b) => sectionRankOf(a) - sectionRankOf(b))
    .flatMap((account) => {
      const ids = idsByAccount.get(account.id) ?? [];
      const accountValueAt = (byHolding: Map<string, number>): number =>
        sumOf(ids.map((id) => byHolding.get(id) ?? 0));
      const cells = columns.map(accountValueAt);

      return ids.length === 0
        ? []
        : [{ accountId: account.id, cells, change: changeOf(cells, accountValueAt(baseline)) }];
    });

  return { rows, allCells, allChange: changeOf(allCells, sumOf([...baseline.values()])) };
};
