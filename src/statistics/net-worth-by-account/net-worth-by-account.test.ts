import { toMajor } from '@kiko/currency/money';
import { calendarMonthsBetween } from '@kiko/dates';
import type { CurrencyRateHistoryRow } from '@kiko/db';
import { holdingInstrument } from '@kiko/prices/instrument';
import { buildPriceBook, dayKeyOf } from '@kiko/prices/price-book';
import { buildFilterScope } from '@kiko/statistics/statistics-filter-scope';
import {
  accountRow,
  holdingRow,
} from '@kiko/statistics/spending-ledger/__fixtures__/spending-ledger-world';

import { buildNetWorthSeries } from '../net-worth-series';
import type { SeriesTransaction } from '../holding-value-at';

import { buildNetWorthByAccount, monthEndInstants } from '.';

type HistoryRow = Pick<CurrencyRateHistoryRow, 'base' | 'quote' | 'day' | 'rate'>;
type NetWorthByAccountInput = Parameters<typeof buildNetWorthByAccount>[0];

const at = (year: number, monthIndex: number, day: number, hour = 12): number =>
  new Date(year, monthIndex, day, hour).getTime();

const NOW = at(2026, 5, 15);
// January to June 2026; June is the month that is still running.
const MONTHS = calendarMonthsBetween(at(2026, 0, 1), NOW);
const [JANUARY, FEBRUARY, , , , JUNE] = MONTHS;
const BASELINE = JANUARY.start - 1;

// In the order the accounts query returns them. The property account was created before the
// savings account, so it sits between the main accounts, yet the Accounts screen lists it after
// them.
const BANK = accountRow({ id: 'bank', kind: 'bank' });
const PROPERTY = accountRow({ id: 'property', kind: 'property' });
const SAVINGS = accountRow({ id: 'savings', kind: 'bank' });
const DEBT = accountRow({ id: 'debt', kind: 'debt' });
const EMPTY = accountRow({ id: 'empty', kind: 'bank' });
const ARCHIVED = accountRow({ id: 'archived', kind: 'bank', archivedAt: at(2026, 1, 1) });
const ACCOUNTS = [BANK, PROPERTY, SAVINGS, DEBT, EMPTY, ARCHIVED];

const CARD = holdingRow({
  id: 'card',
  accountId: 'bank',
  type: 'card',
  balanceMinorUnits: 100_000,
});
const USD = holdingRow({
  id: 'usd',
  accountId: 'bank',
  currency: 'USD',
  balanceMinorUnits: 10_000,
});
// A card in debit: it nets in its account's row.
const CREDIT_CARD = holdingRow({
  id: 'credit',
  accountId: 'bank',
  type: 'card',
  balanceMinorUnits: -30_000,
});
const CLOSED_AT_FEBRUARY_END = holdingRow({
  id: 'closed-at-february-end',
  accountId: 'savings',
  balanceMinorUnits: 50_000,
  closedAt: FEBRUARY.end,
});
const CLOSED_IN_MARCH = holdingRow({
  id: 'closed-in-march',
  accountId: 'savings',
  balanceMinorUnits: 7_000,
  closedAt: at(2026, 2, 20),
});
const FLAT = holdingRow({ id: 'flat', accountId: 'property', balanceMinorUnits: 20_000_000 });
const LOAN = holdingRow({
  id: 'loan',
  accountId: 'debt',
  type: 'loan',
  metadata: {
    kind: 'personal',
    principalMinorUnits: 100_000_00,
    startDate: at(2026, 0, 1),
    schedule: 'none',
  },
});
const ARCHIVED_CASH = holdingRow({
  id: 'archived-cash',
  accountId: 'archived',
  balanceMinorUnits: 9_000_000,
});
const HOLDINGS = [
  CARD,
  USD,
  CREDIT_CARD,
  CLOSED_AT_FEBRUARY_END,
  CLOSED_IN_MARCH,
  FLAT,
  LOAN,
  ARCHIVED_CASH,
];

const TRANSACTIONS = new Map<string, SeriesTransaction[]>([
  [
    'card',
    [
      { time: at(2026, 1, 10), amountMinorUnits: 20_000 },
      { time: at(2026, 3, 3), amountMinorUnits: -5_000 },
    ],
  ],
]);

const BOOK = buildPriceBook([
  {
    instrument: holdingInstrument('loan'),
    day: dayKeyOf(at(2026, 0, 1)),
    price: '100000',
    currency: 'UAH',
    source: 'manual',
  },
]);

const usdRow = (day: number, rate: string): HistoryRow => ({
  base: 'USD',
  quote: 'UAH',
  day: dayKeyOf(day),
  rate,
});

// The history starts at the end of March, so January and February take its earliest row.
const HISTORY = [
  usdRow(at(2026, 2, 31), '40'),
  usdRow(at(2026, 3, 30), '41'),
  usdRow(at(2026, 4, 31), '42'),
];
const LIVE_RATES = { USD: 45 };

// The card is 85,000 in January, 105,000 after the 10 February credit and 100,000 once the 3 April
// debit is paid. The dollars are 10,000 minor units, and the credit card holds -30,000.
const BANK_CELLS = [
  85_000 + 10_000 * 40 - 30_000,
  105_000 + 10_000 * 40 - 30_000,
  105_000 + 10_000 * 40 - 30_000,
  100_000 + 10_000 * 41 - 30_000,
  100_000 + 10_000 * 42 - 30_000,
  100_000 + 10_000 * 45 - 30_000,
];

const scope = () =>
  buildFilterScope({ accounts: ACCOUNTS, holdings: HOLDINGS, selectedAccounts: new Set<string>() });

const inputOf = (overrides: Partial<NetWorthByAccountInput> = {}): NetWorthByAccountInput => {
  const { filteredAccounts, netWorthHoldings } = scope();

  return {
    accounts: filteredAccounts,
    holdings: netWorthHoldings,
    transactionsByHolding: TRANSACTIONS,
    historyRows: HISTORY,
    baseCurrency: 'UAH',
    months: MONTHS,
    liveRateTable: LIVE_RATES,
    now: NOW,
    book: BOOK,
    ...overrides,
  };
};

const NOTHING = { rows: [], allCells: [], allChange: 0 };

// The net-worth line over the holdings it is fed, from `from` to `to`.
const linePointsOf = (from: number, to: number) =>
  buildNetWorthSeries({
    holdings: scope().netWorthHoldings,
    transactionsByHolding: TRANSACTIONS,
    historyRows: HISTORY,
    baseCurrency: 'UAH',
    range: { from, to },
    liveRateTable: LIVE_RATES,
    today: NOW,
    book: BOOK,
  }).points;

const lineAmountAt = (t: number): number => linePointsOf(t, t)[0].amount;

const rowOf = (accountId: string, overrides: Partial<NetWorthByAccountInput> = {}) =>
  buildNetWorthByAccount(inputOf(overrides)).rows.find((row) => row.accountId === accountId);

describe('monthEndInstants', () => {
  it('ends each past month on its own last millisecond and the running month on now', () => {
    expect(monthEndInstants(MONTHS, NOW)).toEqual([
      ...MONTHS.slice(0, -1).map((month) => month.end),
      NOW,
    ]);
  });

  it('keeps the last millisecond of a month that is over, for a period that ends before now', () => {
    expect(monthEndInstants([JANUARY, FEBRUARY], NOW)).toEqual([JANUARY.end, FEBRUARY.end]);
  });

  it('is empty with no month', () => {
    expect(monthEndInstants([], NOW)).toEqual([]);
  });
});

describe('buildNetWorthByAccount', () => {
  describe('the All row against the net-worth line', () => {
    it.each(MONTHS.map((_, index) => index))(
      'is the line at the same instant, through toMajor, in column %i',
      (index) => {
        const { allCells } = buildNetWorthByAccount(inputOf());

        expect(allCells).toHaveLength(MONTHS.length);
        expect(toMajor(allCells[index], 'UAH')).toBe(
          lineAmountAt(monthEndInstants(MONTHS, NOW)[index]),
        );
      },
    );

    it("ends on the line's last point, the one at now", () => {
      const { allCells } = buildNetWorthByAccount(inputOf());

      expect(toMajor(allCells.at(-1) ?? Number.NaN, 'UAH')).toBe(
        linePointsOf(JANUARY.start, NOW).at(-1)?.amount,
      );
    });

    it('is the sum of the rows', () => {
      const { rows, allCells } = buildNetWorthByAccount(inputOf());

      expect(allCells).toEqual(
        MONTHS.map((_, index) => rows.reduce((sum, row) => sum + row.cells[index], 0)),
      );
    });
  });

  describe('the cells of a row', () => {
    it('values a month before the first stored row of a pair at that pair earliest row', () => {
      expect(rowOf('bank')?.cells.slice(0, 3)).toEqual(BANK_CELLS.slice(0, 3));
    });

    it('values a later month at the rate of its own end, and the running month at the live rate', () => {
      expect(rowOf('bank')?.cells.slice(3)).toEqual(BANK_CELLS.slice(3));
    });

    it('nets a loan in its own row, as a negative', () => {
      expect(rowOf('debt')?.cells).toEqual(MONTHS.map(() => -100_000_00));
    });

    it('nets a debit card into the row of its account', () => {
      const without = rowOf('bank', {
        holdings: scope().netWorthHoldings.filter((holding) => holding.id !== 'credit'),
      });

      expect(
        rowOf('bank')?.cells.map((cell, index) => cell - (without?.cells[index] ?? 0)),
      ).toEqual(MONTHS.map(() => -30_000));
    });

    it('is zero for a closed holding at the instant it closed and after, and its value before', () => {
      // One closed on the last millisecond of February (the column's own instant), one in March.
      expect(rowOf('savings')?.cells).toEqual([57_000, 7_000, 0, 0, 0, 0]);
    });

    it('values a holding that no history is needed for, in every column', () => {
      expect(rowOf('property')?.cells).toEqual(MONTHS.map(() => 20_000_000));
    });
  });

  describe('which accounts get a row', () => {
    it('gives no row to an account with no holding', () => {
      expect(buildNetWorthByAccount(inputOf()).rows.map((row) => row.accountId)).not.toContain(
        'empty',
      );
    });

    it('leaves an archived account out of its row and out of the All row', () => {
      const result = buildNetWorthByAccount(inputOf());

      expect(result.rows.map((row) => row.accountId)).not.toContain('archived');
      expect(toMajor(result.allCells[0], 'UAH')).toBe(
        lineAmountAt(monthEndInstants(MONTHS, NOW)[0]),
      );
    });

    it('keeps an account whose holdings are all closed', () => {
      expect(rowOf('savings')).toBeDefined();
    });
  });

  describe('the order of the rows', () => {
    it("is the Accounts screen's: the main accounts as the grid orders them, then property, then debt", () => {
      expect(buildNetWorthByAccount(inputOf()).rows.map((row) => row.accountId)).toEqual([
        'bank',
        'savings',
        'property',
        'debt',
      ]);
    });

    it("follows the grid's order, not the account name or id", () => {
      const reordered = [SAVINGS, DEBT, PROPERTY, BANK];

      expect(
        buildNetWorthByAccount(inputOf({ accounts: reordered })).rows.map((row) => row.accountId),
      ).toEqual(['savings', 'bank', 'property', 'debt']);
    });
  });

  describe('Change', () => {
    it('is the last column less the value at the end of the month before the first column', () => {
      // The baseline is the end of December, before any row of the ledger: the card at 85,000, the
      // dollars at the earliest rate (40), the credit card at -30,000.
      expect(rowOf('bank')?.change).toBe(BANK_CELLS[5] - BANK_CELLS[0]);
    });

    it('is negative for an account that lost value', () => {
      expect(rowOf('savings')?.change).toBe(-57_000);
    });

    it('is the line change for the All row', () => {
      const { allChange } = buildNetWorthByAccount(inputOf());

      expect(toMajor(allChange, 'UAH')).toBeCloseTo(lineAmountAt(NOW) - lineAmountAt(BASELINE), 2);
    });

    it('reads the month before the period for a period of the running month alone', () => {
      const bank = rowOf('bank', { months: [JUNE] });

      expect(bank?.cells).toEqual([BANK_CELLS[5]]);
      expect(bank?.change).toBe(BANK_CELLS[5] - BANK_CELLS[4]);
    });
  });

  describe('with nothing to value', () => {
    it('is empty with no holding', () => {
      expect(buildNetWorthByAccount(inputOf({ holdings: [] }))).toEqual(NOTHING);
    });

    it('is empty when a foreign holding has no stored history, as the line is', () => {
      expect(buildNetWorthByAccount(inputOf({ historyRows: [] }))).toEqual(NOTHING);
    });

    it('still values a world of the base currency alone with no stored history', () => {
      const result = buildNetWorthByAccount(
        inputOf({ historyRows: [], holdings: [CARD], accounts: [BANK] }),
      );

      expect(result.rows.map((row) => row.accountId)).toEqual(['bank']);
      expect(result.rows[0].cells.at(-1)).toBe(100_000);
    });

    it('is empty with no month', () => {
      expect(buildNetWorthByAccount(inputOf({ months: [] }))).toEqual(NOTHING);
    });
  });
});
