import { View } from 'react-native';
import type { ComponentProps } from 'react';
import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import { calendarMonthsBetween } from '@kiko/dates';
import { EMPTY_PRICE_BOOK, dayKeyOf } from '@kiko/prices/price-book';
import type DataTable from '@kiko/design-system/components/data-table';
import {
  accountRow,
  holdingRow,
} from '@kiko/statistics/spending-ledger/__fixtures__/spending-ledger-world';

import NetWorthTable from '.';

const mockDataTable = jest.fn();

jest.mock('@kiko/design-system/components/data-table', () => ({
  __esModule: true,
  default: (props: { topContent?: unknown; emptyContent?: unknown }) => {
    mockDataTable(props);

    return require('react').createElement(
      require('react-native').View,
      null,
      props.topContent,
      props.emptyContent,
    );
  },
}));

type TableProps = ComponentProps<typeof DataTable>;
type NetWorthTableProps = ComponentProps<typeof NetWorthTable>;

const at = (year: number, monthIndex: number, day: number, hour = 12): number =>
  new Date(year, monthIndex, day, hour).getTime();

const NOW = at(2026, 5, 15);
const MONTHS = calendarMonthsBetween(at(2026, 0, 1), NOW);

const BANK = accountRow({ id: 'bank', kind: 'bank', name: 'Bank' });
// Its stored name is the sentinel, so the screen shows the kind's own name.
const LOANS = accountRow({ id: 'loans', kind: 'debt', name: '' });
const CARD = holdingRow({ id: 'card', accountId: 'bank', balanceMinorUnits: 100_000 });
const USD = holdingRow({
  id: 'usd',
  accountId: 'bank',
  currency: 'USD',
  balanceMinorUnits: 10_000,
});
const OWED = holdingRow({ id: 'owed', accountId: 'loans', balanceMinorUnits: -50_000 });

const TRANSACTIONS = [
  {
    id: 'opening',
    holdingId: 'card',
    time: at(2026, 1, 10),
    amountMinorUnits: 20_000,
    source: 'manual' as const,
  },
];

const usdRow = (day: number, rate: string) => ({
  base: 'USD' as const,
  quote: 'UAH' as const,
  day: dayKeyOf(day),
  rate,
});

// The history starts at the end of March, so January and February take its earliest row.
const HISTORY = [
  usdRow(at(2026, 2, 31), '40'),
  usdRow(at(2026, 3, 30), '41'),
  usdRow(at(2026, 4, 31), '42'),
];

const propsOf = (overrides: Partial<NetWorthTableProps> = {}): NetWorthTableProps => ({
  accounts: [BANK, LOANS],
  holdings: [CARD, USD, OWED],
  transactions: TRANSACTIONS,
  historyRows: HISTORY,
  months: MONTHS,
  now: NOW,
  rateTable: { USD: 45 },
  priceBook: EMPTY_PRICE_BOOK,
  baseCurrency: 'UAH',
  backfillState: 'complete',
  topContent: <View testID="table-controls" />,
  ...overrides,
});

const shown = async (props: NetWorthTableProps) => {
  mockDataTable.mockClear();
  const rendered = await render(<NetWorthTable {...props} />);
  const table = mockDataTable.mock.calls.at(-1)?.[0] as TableProps;

  return { rendered, table };
};

const cellsOf = (table: TableProps, key: string) =>
  table.rows.find((row) => row.key === key)?.cells ?? [];

const textsOf = (table: TableProps, key: string) => cellsOf(table, key).map((cell) => cell.text);

// Nothing to value: the account holds nothing, so the builder gives no row.
const NO_VALUES = { holdings: [] };

describe('NetWorthTable', () => {
  it('has a column per month, then Change, which is marked as a sum', async () => {
    const { table } = await shown(propsOf());

    expect(table.columns.map((column) => column.header)).toEqual([
      'Jan 2026',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Change',
    ]);
    expect(table.columns.map((column) => column.isSum === true)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it('has a row per account in the order given, then All in bold', async () => {
    const { table } = await shown(propsOf());

    expect(table.rows.map((row) => row.label)).toEqual(['Bank', 'Loans', 'All']);
    expect(table.rows.map((row) => row.isSummary === true)).toEqual([false, false, true]);
    expect(new Set(table.rows.map((row) => row.key)).size).toBe(3);
  });

  it('writes the value of each month end in whole units, then the change', async () => {
    const { table } = await shown(propsOf());

    // The card is 800 in January and 1,000 from the 10 February credit on; the 100 dollars are
    // 4,000 at the earliest rate, then 4,100, 4,200 and, today, 4,500.
    expect(textsOf(table, 'account-bank')).toEqual([
      '4,800',
      '5,000',
      '5,000',
      '5,100',
      '5,200',
      '5,500',
      '700',
    ]);
    expect(textsOf(table, 'account-loans')).toEqual([
      '-500',
      '-500',
      '-500',
      '-500',
      '-500',
      '-500',
      '0',
    ]);
    expect(textsOf(table, 'all')).toEqual([
      '4,300',
      '4,500',
      '4,500',
      '4,600',
      '4,700',
      '5,000',
      '700',
    ]);
  });

  it('names an implicit account as the Accounts screen does', async () => {
    const { table } = await shown(propsOf());

    expect(table.rows[1].label).toBe('Loans');
  });

  it('gives a cell its account and month as the label and its full amount as the value', async () => {
    const { table } = await shown(propsOf());
    const bank = cellsOf(table, 'account-bank');

    expect(bank[1].accessibilityLabel).toBe('Bank, February 2026');
    expect(bank[1].accessibilityValue).toBe('5,000.00 ₴');
    expect(bank[6].accessibilityLabel).toBe('Bank, Change');
    expect(bank[6].accessibilityValue).toBe('700.00 ₴');
    expect(cellsOf(table, 'all')[5].accessibilityLabel).toBe('All, June 2026');
  });

  it('marks a negative cell and no other', async () => {
    const { table } = await shown(propsOf());

    expect(cellsOf(table, 'account-loans').map((cell) => cell.tone)).toEqual([
      'negative',
      'negative',
      'negative',
      'negative',
      'negative',
      'negative',
      undefined,
    ]);
    expect(cellsOf(table, 'account-bank').every((cell) => cell.tone === undefined)).toBe(true);
  });

  it('leaves out an account with no holding', async () => {
    const { table } = await shown(
      propsOf({
        accounts: [BANK, LOANS, accountRow({ id: 'empty', kind: 'bank', name: 'Empty' })],
      }),
    );

    expect(table.rows.map((row) => row.label)).toEqual(['Bank', 'Loans', 'All']);
  });

  it('opens at the third month from the end', async () => {
    const { table } = await shown(propsOf());

    expect(table.initialColumnIndex).toBe(3);
  });

  // A balance has no rows behind it that add up to it: it is a valuation at a month's end.
  it('opens no rows from any cell, a month, the Change or an account or All row alike', async () => {
    const { table } = await shown(propsOf());

    expect(table.rows.length).toBeGreaterThan(1);

    for (const row of table.rows) {
      for (const cell of row.cells) {
        expect(cell.onPress).toBeUndefined();
        expect(cell.accessibilityHint).toBeUndefined();
      }
    }
  });

  describe('the caption', () => {
    it('names the base currency and the rates, and that the latest month is today', async () => {
      const { table } = await shown(propsOf());

      expect(table.caption).toBe(
        "Net worth by account in UAH, in whole units, at the rate of each month's end. A month before a currency's rate history starts uses its earliest stored rate, and a currency with no history uses today's rate. The latest month shows today's value.",
      );
    });

    it('leaves the latest month out for a year that is over', async () => {
      const pastYear = calendarMonthsBetween(at(2025, 0, 1), at(2025, 11, 31));
      const { table } = await shown(propsOf({ months: pastYear }));

      expect(table.caption).toBe(
        "Net worth by account in UAH, in whole units, at the rate of each month's end. A month before a currency's rate history starts uses its earliest stored rate, and a currency with no history uses today's rate.",
      );
    });
  });

  describe('while the rate history is loading', () => {
    it('shows the loading state, with the controls above it, when there is no value yet', async () => {
      const { rendered, table } = await shown(propsOf({ ...NO_VALUES, backfillState: 'loading' }));

      expect(rendered.getByTestId('tables-net-worth-loading')).toBeTruthy();
      expect(rendered.getByTestId('table-controls')).toBeTruthy();
      expect(rendered.queryByTestId('net-worth-table-empty')).toBeNull();
      expect(table.emptyContent).toBeTruthy();
    });

    it('shows the table, not the spinner, when there are values', async () => {
      const { rendered, table } = await shown(propsOf({ backfillState: 'loading' }));

      expect(rendered.queryByTestId('tables-net-worth-loading')).toBeNull();
      expect(table.emptyContent).toBeUndefined();
      expect(table.rows).toHaveLength(3);
    });
  });

  describe('with nothing to show', () => {
    it.each(['idle', 'complete'] as const)(
      'gives the empty state, with the controls above it, when the run is %s',
      async (backfillState) => {
        const { rendered, table } = await shown(propsOf({ ...NO_VALUES, backfillState }));

        expect(table.emptyContent).toBeTruthy();
        expect(rendered.getByTestId('net-worth-table-empty')).toBeTruthy();
        expect(rendered.getByTestId('table-controls')).toBeTruthy();
        expect(rendered.queryByTestId('tables-net-worth-loading')).toBeNull();
      },
    );

    it('gives the empty state when a foreign holding has no stored history', async () => {
      const { rendered } = await shown(propsOf({ historyRows: [], backfillState: 'idle' }));

      expect(rendered.getByTestId('net-worth-table-empty')).toBeTruthy();
    });

    it('gives the empty state, not a table of nothing, when the run failed', async () => {
      const { rendered } = await shown(propsOf({ ...NO_VALUES, backfillState: 'failed' }));

      expect(rendered.getByTestId('net-worth-table-empty')).toBeTruthy();
    });
  });

  describe('when the run failed', () => {
    it("shows the table, whose caption says the fallback is today's rate", async () => {
      const { rendered, table } = await shown(propsOf({ backfillState: 'failed' }));

      expect(table.rows).toHaveLength(3);
      expect(table.emptyContent).toBeUndefined();
      expect(rendered.queryByTestId('tables-net-worth-loading')).toBeNull();
      expect(table.caption).toContain("a currency with no history uses today's rate");
    });
  });

  it('shows no empty state when the period has values', async () => {
    const { table } = await shown(propsOf());

    expect(table.emptyContent).toBeUndefined();
  });
});
