import { View } from 'react-native';
import type { ComponentProps } from 'react';
import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import { calendarMonthsBetween } from '@kiko/dates';
import { buildSpendingLedger } from '@kiko/statistics/spending-ledger';
import type DataTable from '@kiko/design-system/components/data-table';
import { buildCategoryDisplayMap } from '@kiko/categories/category-display';
import {
  CARD,
  transactionRow,
  worldInput,
} from '@kiko/statistics/spending-ledger/__fixtures__/spending-ledger-world';

import CashFlowTable from '.';

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
type CashFlowTableProps = ComponentProps<typeof CashFlowTable>;

const NOW = new Date(2025, 5, 15, 12).getTime();
const MONTHS_OF_2025 = calendarMonthsBetween(
  new Date(2025, 0, 1).getTime(),
  new Date(2025, 5, 30).getTime(),
);
const [JANUARY, FEBRUARY, MARCH, , , JUNE] = MONTHS_OF_2025;

const displayMap = () =>
  buildCategoryDisplayMap([
    { key: 'groceries', title: 'Groceries', icon: 'cart' },
    { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
  ]);

const entry = (id: string, minorUnits: number, time: number) =>
  transactionRow({
    id,
    holdingId: 'card',
    category: 'groceries',
    amountMinorUnits: minorUnits,
    time,
  });

// The first row sits before the period, so January is the first complete month. Cells, Jan to Jun:
// income 3000, 0, 1000, 0, 0, 100; expenses 1000, 500, 1500, 0, 0, 0.
const WORLD = [
  entry('before-period', -1_00, new Date(2024, 11, 20, 12).getTime()),
  entry('salary-jan', 3_000_00, JANUARY.start + 1_000),
  entry('spend-jan', -1_000_00, JANUARY.start + 2_000),
  entry('spend-feb', -500_00, FEBRUARY.start + 1_000),
  entry('pay-mar', 1_000_00, MARCH.start + 1_000),
  entry('spend-mar', -1_500_00, MARCH.start + 2_000),
  entry('pay-jun', 100_00, JUNE.start + 1_000),
];

const propsOf = (
  transactions: ReturnType<typeof transactionRow>[],
  overrides: Partial<CashFlowTableProps> = {},
): CashFlowTableProps => ({
  ledger: buildSpendingLedger(worldInput({ transactions, shownHoldings: [CARD] })),
  months: MONTHS_OF_2025,
  now: NOW,
  categoryDisplay: displayMap(),
  rateTable: {},
  baseCurrency: 'UAH',
  defaultCategoryKey: 'other',
  topContent: <View testID="table-controls" />,
  ...overrides,
});

const shown = async (props: CashFlowTableProps) => {
  mockDataTable.mockClear();
  const rendered = await render(<CashFlowTable {...props} />);
  const table = mockDataTable.mock.calls.at(-1)?.[0] as TableProps;

  return { rendered, table };
};

const cellsOf = (table: TableProps, key: string) =>
  table.rows.find((row) => row.key === key)?.cells ?? [];

const textsOf = (table: TableProps, key: string) => cellsOf(table, key).map((cell) => cell.text);

describe('CashFlowTable', () => {
  it('has a column per month, then Total and Average, the sums marked', async () => {
    const { table } = await shown(propsOf(WORLD));

    expect(table.columns.map((column) => column.header)).toEqual([
      'Jan 2025',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Total',
      'Average',
    ]);
    expect(table.columns.map((column) => column.isSum === true)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it('has income, expenses, net in bold, then the savings rate', async () => {
    const { table } = await shown(propsOf(WORLD));

    expect(table.rows.map((row) => row.label)).toEqual([
      'Income',
      'Expenses',
      'Net',
      'Savings rate',
    ]);
    expect(table.rows.map((row) => row.isSummary === true)).toEqual([false, false, true, false]);
    expect(new Set(table.rows.map((row) => row.key)).size).toBe(4);
  });

  it('writes the money cells as whole units, with the Total and the Average of complete months', async () => {
    const { table } = await shown(propsOf(WORLD));

    expect(textsOf(table, 'income')).toEqual([
      '3,000',
      '0',
      '1,000',
      '0',
      '0',
      '100',
      '4,100',
      '800',
    ]);
    expect(textsOf(table, 'expenses')).toEqual([
      '1,000',
      '500',
      '1,500',
      '0',
      '0',
      '0',
      '3,000',
      '600',
    ]);
    expect(textsOf(table, 'net')).toEqual([
      '2,000',
      '-500',
      '-500',
      '0',
      '0',
      '100',
      '1,100',
      '200',
    ]);
  });

  it('gives a cell its row and month as the label and its full amount as the value', async () => {
    const { table } = await shown(propsOf(WORLD));
    const net = cellsOf(table, 'net');

    expect(net[1].accessibilityLabel).toBe('Net, February 2025');
    expect(net[1].accessibilityValue).toBe('-500.00 ₴');
    expect(net[6].accessibilityLabel).toBe('Net, Total');
    expect(net[7].accessibilityLabel).toBe('Net, Average');
    expect(net[7].accessibilityValue).toBe('200.00 ₴');
  });

  it('marks a negative net cell and no other', async () => {
    const { table } = await shown(propsOf(WORLD));

    expect(cellsOf(table, 'net').map((cell) => cell.tone)).toEqual([
      undefined,
      'negative',
      'negative',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(cellsOf(table, 'income').every((cell) => cell.tone === undefined)).toBe(true);
  });

  describe('the savings rate', () => {
    it('is net over income as a whole percent, negative allowed, with a dash where income is zero', async () => {
      const { table } = await shown(propsOf(WORLD));

      expect(textsOf(table, 'savings-rate')).toEqual([
        '67%',
        '–',
        '-50%',
        '–',
        '–',
        '100%',
        '27%',
        '25%',
      ]);
    });

    it('speaks the percent with its decimals', async () => {
      const { table } = await shown(propsOf(WORLD));
      const cells = cellsOf(table, 'savings-rate');

      expect(cells[0].accessibilityValue).toBe('66.67%');
      expect(cells[6].accessibilityValue).toBe('26.83%');
      expect(cells[6].accessibilityLabel).toBe('Savings rate, Total');
      expect(cells[0].accessibilityLabel).toBe('Savings rate, January 2025');
    });

    it('marks a negative rate and no other', async () => {
      const { table } = await shown(propsOf(WORLD));

      expect(cellsOf(table, 'savings-rate').map((cell) => cell.tone)).toEqual([
        undefined,
        undefined,
        'negative',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
    });

    it('reads a dash as a word, not as silence', async () => {
      const { table } = await shown(propsOf(WORLD));
      const cells = cellsOf(table, 'savings-rate');

      expect(cells[1].text).toBe('–');
      expect(cells[1].accessibilityValue).toBe('No income, so no savings rate');
    });

    it('says in the Average that no month is complete rather than that no income came', async () => {
      const { table } = await shown(
        propsOf([entry('pay-jun', 100_00, JUNE.start + 1_000)], { months: [JUNE] }),
      );
      const average = cellsOf(table, 'savings-rate')[2];

      expect(average.text).toBe('–');
      expect(average.accessibilityValue).toBe('No complete month yet');
    });

    it('does not mark or sign a rate that rounds to zero', async () => {
      const { table } = await shown(
        propsOf([
          entry('before-period', -1_00, new Date(2024, 11, 20, 12).getTime()),
          entry('pay-jan', 100_000_00, JANUARY.start + 1_000),
          entry('spend-jan', -100_050_00, JANUARY.start + 2_000),
        ]),
      );
      const january = cellsOf(table, 'savings-rate')[0];

      expect(january.text).toBe('0%');
      expect(january.tone).toBeUndefined();
    });
  });

  it('opens at the third month from the end', async () => {
    const { table } = await shown(propsOf(WORLD));

    expect(table.initialColumnIndex).toBe(3);
  });

  describe('the caption', () => {
    it('names the base currency and the rate, and the running month', async () => {
      const { table } = await shown(propsOf(WORLD));

      expect(table.caption).toBe(
        "Cash flow in UAH, in whole units, at today's rate. The latest month is not over yet, so the average leaves it out.",
      );
    });

    it('leaves the running month out of the caption for a year that is over', async () => {
      const pastYear = calendarMonthsBetween(
        new Date(2024, 0, 1).getTime(),
        new Date(2024, 11, 31).getTime(),
      );
      const { table } = await shown(propsOf(WORLD, { months: pastYear }));

      expect(table.caption).toBe("Cash flow in UAH, in whole units, at today's rate.");
    });
  });

  describe('with nothing to show', () => {
    it('gives the empty state, with the controls above it', async () => {
      const { rendered, table } = await shown(propsOf([]));

      expect(table.emptyContent).toBeTruthy();
      expect(rendered.getByTestId('cash-flow-table-empty')).toBeTruthy();
      expect(rendered.getByTestId('table-controls')).toBeTruthy();
    });

    it('gives no empty state when the period has money in it', async () => {
      const { table } = await shown(propsOf(WORLD));

      expect(table.emptyContent).toBeUndefined();
    });

    it('gives no empty state for a period that only spends', async () => {
      const { table } = await shown(propsOf([entry('spend-feb', -500_00, FEBRUARY.start + 1_000)]));

      expect(table.emptyContent).toBeUndefined();
    });
  });
});
