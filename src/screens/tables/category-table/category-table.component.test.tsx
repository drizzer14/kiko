import { View } from 'react-native';
import type { ComponentProps } from 'react';
import { act, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { calendarMonthsBetween } from '@kiko/dates';
import { buildSpendingLedger } from '@kiko/statistics/spending-ledger';
import type DataTable from '@kiko/design-system/components/data-table';
import { buildCategoryDisplayMap } from '@kiko/categories/category-display';
import {
  CARD,
  transactionRow,
  worldInput,
} from '@kiko/statistics/spending-ledger/__fixtures__/spending-ledger-world';

import CategoryTable from '.';

const mockDataTable = jest.fn();

jest.mock('@kiko/design-system/components/data-table', () => ({
  __esModule: true,
  default: (props: unknown) => {
    mockDataTable(props);

    return null;
  },
}));

type TableProps = ComponentProps<typeof DataTable>;
type CategoryTableProps = ComponentProps<typeof CategoryTable>;

const NOW = new Date(2025, 5, 15, 12).getTime();
const MONTHS_OF_2025 = calendarMonthsBetween(
  new Date(2025, 0, 1).getTime(),
  new Date(2025, 5, 30).getTime(),
);
const [JANUARY, FEBRUARY, MARCH, , MAY, JUNE] = MONTHS_OF_2025;

const displayMap = () =>
  buildCategoryDisplayMap([
    { key: 'groceries', title: 'Groceries', icon: 'cart' },
    { key: 'transport', title: 'Transport', icon: 'car' },
    { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
  ]);

const spend = (id: string, category: string, minorUnits: number, time: number) =>
  transactionRow({ id, holdingId: 'card', category, amountMinorUnits: -minorUnits, time });

const WORLD = [
  spend('before-period', 'transport', 1_00, new Date(2024, 11, 20, 12).getTime()),
  spend('g-jan', 'groceries', 1_234_56, JANUARY.start + 1_000),
  spend('g-feb', 'groceries', 100_00, FEBRUARY.start + 1_000),
  spend('t-feb', 'transport', 50_00, FEBRUARY.start + 2_000),
  spend('g-may', 'groceries', 200_00, MAY.start + 1_000),
  spend('g-jun', 'groceries', 50_00, JUNE.start + 1_000),
];

const propsOf = (
  transactions: ReturnType<typeof transactionRow>[],
  overrides: Partial<CategoryTableProps> = {},
): CategoryTableProps => ({
  ledger: buildSpendingLedger(worldInput({ transactions, shownHoldings: [CARD] })),
  months: MONTHS_OF_2025,
  now: NOW,
  categoryDisplay: displayMap(),
  rateTable: {},
  baseCurrency: 'UAH',
  defaultCategoryKey: 'other',
  excludedCategories: new Set<string>(),
  topContent: <View testID="table-controls" />,
  ...overrides,
});

const shown = async (props: CategoryTableProps) => {
  mockDataTable.mockClear();
  const rendered = await render(<CategoryTable {...props} />);
  const table = mockDataTable.mock.calls.at(-1)?.[0] as TableProps;

  return { rendered, table };
};

const rowOf = (table: TableProps, key: string) => table.rows.find((row) => row.key === key);

const cellsOf = (table: TableProps, key: string) => rowOf(table, key)?.cells ?? [];

describe('CategoryTable', () => {
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
    expect(new Set(table.columns.map((column) => column.key)).size).toBe(8);
  });

  it('has the categories by their period total, then the All row last and in bold', async () => {
    const { table } = await shown(propsOf(WORLD));

    expect(table.rows.map((row) => row.label)).toEqual(['Groceries', 'Transport', 'All']);
    expect(table.rows.map((row) => row.isSummary === true)).toEqual([false, false, true]);
  });

  it('writes a cell as whole units of the base currency with no symbol', async () => {
    const { table } = await shown(propsOf(WORLD));

    expect(cellsOf(table, 'category-groceries').map((cell) => cell.text)).toEqual([
      '1,235',
      '100',
      '0',
      '0',
      '200',
      '50',
      '1,585',
      '307',
    ]);
  });

  it('gives a cell its row and month as the label and its full amount as the value', async () => {
    const { table } = await shown(propsOf(WORLD));
    const cells = cellsOf(table, 'category-groceries');

    expect(cells[0].accessibilityLabel).toBe('Groceries, January 2025');
    expect(cells[0].accessibilityValue).toBe('1,234.56 ₴');
    expect(cells[6].accessibilityLabel).toBe('Groceries, Total');
    expect(cells[6].accessibilityValue).toBe('1,584.56 ₴');
    expect(cells[7].accessibilityLabel).toBe('Groceries, Average');
    expect(cells[7].accessibilityValue).toBe('306.91 ₴');
  });

  it('sums the categories in the All row, month by month and in the total', async () => {
    const { table } = await shown(propsOf(WORLD));

    expect(cellsOf(table, 'all').map((cell) => cell.text)).toEqual([
      '1,235',
      '150',
      '0',
      '0',
      '200',
      '50',
      '1,635',
      '317',
    ]);
  });

  it('averages the complete months only: from the month after the first row, less the running one', async () => {
    const { table } = await shown(propsOf(WORLD));

    // January to May, (1_234_56 + 100_00 + 200_00) / 5 = 306.91 for groceries; June is left out.
    expect(cellsOf(table, 'category-groceries')[7].text).toBe('307');
    expect(cellsOf(table, 'category-transport')[7].text).toBe('10');
  });

  it('starts the average after the first row’s month when that month is in the period', async () => {
    const { table } = await shown(propsOf(WORLD.filter((row) => row.id !== 'before-period')));

    // The first row is January's, so February to May count: (100_00 + 200_00) / 4 = 75.
    expect(cellsOf(table, 'category-groceries')[7].text).toBe('75');
  });

  it('shows a dash and a spoken reason for an average with no complete month', async () => {
    const { table } = await shown(
      propsOf([spend('g-jun', 'groceries', 50_00, JUNE.start + 1_000)], { months: [JUNE] }),
    );
    const average = cellsOf(table, 'category-groceries')[2];

    expect(average.text).toBe('–');
    expect(average.accessibilityValue).toBe('No complete month yet');
  });

  it('opens at the third month from the end, so the last three months show', async () => {
    const { table } = await shown(propsOf(WORLD));

    expect(table.initialColumnIndex).toBe(3);
  });

  it('opens at the first column when there are fewer than three months', async () => {
    const { table } = await shown(propsOf(WORLD, { months: [FEBRUARY, MARCH] }));

    expect(table.initialColumnIndex).toBe(0);
  });

  describe('the caption', () => {
    it('names the base currency, whole units and today’s rate, and the running month', async () => {
      const { table } = await shown(propsOf(WORLD));

      expect(table.caption).toBe(
        "Spending by category in UAH, in whole units, at today's rate. The latest month is not over yet, so the average leaves it out.",
      );
    });

    it('leaves the running month out of the caption for a year that is over', async () => {
      const pastYear = calendarMonthsBetween(
        new Date(2024, 0, 1).getTime(),
        new Date(2024, 11, 31).getTime(),
      );
      const { table } = await shown(propsOf(WORLD, { months: pastYear }));

      expect(table.caption).toBe("Spending by category in UAH, in whole units, at today's rate.");
    });

    it('claims no sum of the cells that are shown', async () => {
      const { table } = await shown(propsOf(WORLD));

      expect(table.caption).not.toMatch(/sum|add up|adds up/i);
    });
  });

  describe('a held category pick', () => {
    it('narrows the rows and the All row to the picked category', async () => {
      const { table } = await shown(propsOf(WORLD, { excludedCategories: new Set(['transport']) }));

      expect(table.rows.map((row) => row.key)).toEqual(['category-groceries', 'all']);
      expect(cellsOf(table, 'all')[1].text).toBe('100');
    });
  });

  describe('the top content', () => {
    it('goes to the table, to scroll away with the caption', async () => {
      const topContent = <View testID="given-controls" />;
      const { table } = await shown(propsOf(WORLD, { topContent }));

      expect(table.topContent).toBe(topContent);
    });
  });

  describe('with no spending in the period', () => {
    it('keeps the top content on screen, so an empty period can be left', async () => {
      const { rendered } = await shown(propsOf([]));

      expect(rendered.getByTestId('table-controls')).toBeTruthy();
      expect(rendered.getByTestId('category-table-empty')).toBeTruthy();
    });

    it('shows the empty state and no table', async () => {
      const { rendered, table } = await shown(propsOf([]));

      expect(table).toBeUndefined();
      expect(rendered.getByText('No spending in this period')).toBeTruthy();
      expect(
        rendered.getByText('Pick another period, or other accounts or categories, to see a table.'),
      ).toBeTruthy();
    });

    it('shows the empty state when the picked categories have no spending in the period', async () => {
      const { table, rendered } = await shown(
        propsOf(WORLD, { excludedCategories: new Set(['groceries', 'transport']) }),
      );

      expect(table).toBeUndefined();
      expect(rendered.getByTestId('category-table-empty')).toBeTruthy();
    });
  });

  describe('under the uk language', () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('writes the headers, the All row and the amounts in Ukrainian', async () => {
      const { table } = await shown(propsOf(WORLD));

      expect(table.columns.map((column) => column.header)).toEqual([
        'Січ 2025',
        'Лют',
        'Бер',
        'Кві',
        'Тра',
        'Чер',
        'Разом',
        'Середнє',
      ]);
      expect(rowOf(table, 'all')?.label).toBe('Усього');
      expect(cellsOf(table, 'category-groceries')[0].text).toBe('1 235');
      expect(table.caption).toContain('Витрати за категоріями в UAH');
    });
  });
});
