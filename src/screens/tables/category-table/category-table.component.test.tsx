import { View } from 'react-native';
import type { ComponentProps } from 'react';
import { act, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { calendarMonthsBetween } from '@kiko/dates';
import { rowDescriberOf } from '@kiko/statistics/cell-rows';
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
  describeRow: rowDescriberOf(worldInput().holdings, i18n.t),
  sheetGeneration: 0,
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

  // A date edit moved a payment away from its group's return, so a month cell and the Total do not
  // agree. The average reads the cells and stays the mean of what the row shows month by month,
  // which a reader can check from the row; it does not follow the Total.
  describe('a payment whose return fell in the month before it', () => {
    const paid = (amountMinorUnits: number, returnedMinorUnits: number) => [
      spend('before-period', 'transport', 1_00, new Date(2024, 11, 20, 12).getTime()),
      transactionRow({
        id: 'paid',
        holdingId: 'card',
        category: 'groceries',
        amountMinorUnits: -amountMinorUnits,
        changeGroupId: 'group',
        time: MARCH.start + 1_000,
      }),
      transactionRow({
        id: 'returned',
        holdingId: 'card',
        category: null,
        amountMinorUnits: returnedMinorUnits,
        changeGroupId: 'group',
        time: FEBRUARY.end - 1_000,
      }),
    ];

    it('averages the cells of the complete months, not the Total over them', async () => {
      const { table } = await shown(propsOf(paid(212_00, 20_00)));
      const cells = cellsOf(table, 'category-groceries');

      // January to May: the cells are 0, 0, 212, 0, 0; the Total is 192. 212 / 5 = 42.4, where
      // 192 / 5 would be 38.4.
      expect(cells.slice(0, 5).map((cell) => cell.text)).toEqual(['0', '0', '212', '0', '0']);
      expect(cells[6].text).toBe('192');
      expect(cells[7].text).toBe('42');
    });

    it('can show an average above zero on a row with a Total of zero', async () => {
      const { table } = await shown(propsOf(paid(20_00, 30_00)));
      const cells = cellsOf(table, 'category-groceries');

      expect(cells[6].text).toBe('0');
      expect(cells[7].text).toBe('4');
    });
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

    it('passes no empty state while there are rows', async () => {
      const { table, rendered } = await shown(propsOf(WORLD));

      expect(table.emptyContent).toBeUndefined();
      expect(rendered.queryByTestId('category-table-empty')).toBeNull();
    });
  });

  describe('with no spending in the period', () => {
    it('keeps the top content on screen, so an empty period can be left', async () => {
      const { rendered } = await shown(propsOf([]));

      expect(rendered.getByTestId('table-controls')).toBeTruthy();
      expect(rendered.getByTestId('category-table-empty')).toBeTruthy();
    });

    it('passes the empty state to the table, which draws it under the same top content', async () => {
      const { rendered, table } = await shown(propsOf([]));

      expect(table.emptyContent).toBeDefined();
      expect(table.topContent).toBeDefined();
      expect(rendered.getByText('No spending in this period')).toBeTruthy();
      expect(
        rendered.getByText('Pick another period, or other accounts or categories, to see a table.'),
      ).toBeTruthy();
    });

    it('shows the empty state when the picked categories have no spending in the period', async () => {
      const { table, rendered } = await shown(
        propsOf(WORLD, { excludedCategories: new Set(['groceries', 'transport']) }),
      );

      expect(table.emptyContent).toBeDefined();
      expect(rendered.getByTestId('category-table-empty')).toBeTruthy();
    });
  });

  describe('a cell that opens the rows behind it', () => {
    const HINT = i18n.t('tables.cellRows.hint');
    // 0 January, 1 February, 2 March, 3 April, 4 May, 5 June, 6 Total, 7 Average.
    const MONTH_AND_TOTAL = [0, 1, 4, 5, 6];

    const pressed = async (props: CategoryTableProps, key: string, column: number) => {
      const { rendered, table } = await shown(props);

      await act(async () => {
        cellsOf(table, key)[column].onPress?.();
      });

      return { rendered, table };
    };

    const rowIdsOf = (rendered: Awaited<ReturnType<typeof shown>>['rendered']) =>
      rendered.getAllByTestId(/^cell-row-/).map((row) => row.props.testID);

    it.each(MONTH_AND_TOTAL)(
      'opens from column %i of a category row, with its hint',
      async (column) => {
        const { table } = await shown(propsOf(WORLD));
        const cell = cellsOf(table, 'category-groceries')[column];

        expect(cell.onPress).toBeInstanceOf(Function);
        expect(cell.accessibilityHint).toBe(HINT);
      },
    );

    it.each(MONTH_AND_TOTAL)(
      'opens from column %i of the All row, with its hint',
      async (column) => {
        const { table } = await shown(propsOf(WORLD));
        const cell = cellsOf(table, 'all')[column];

        expect(cell.onPress).toBeInstanceOf(Function);
        expect(cell.accessibilityHint).toBe(HINT);
      },
    );

    it.each(['category-groceries', 'category-transport', 'all'])(
      'does not open from the Average of %s',
      async (key) => {
        const { table } = await shown(propsOf(WORLD));
        const average = cellsOf(table, key)[7];

        expect(average.onPress).toBeUndefined();
        expect(average.accessibilityHint).toBeUndefined();
      },
    );

    it('does not open from a cell of zero, which has no rows behind it', async () => {
      const { table } = await shown(propsOf(WORLD));

      expect(cellsOf(table, 'category-groceries')[2].text).toBe('0');
      expect(cellsOf(table, 'category-groceries')[2].onPress).toBeUndefined();
    });

    it('shows no sheet until a cell is pressed', async () => {
      const { rendered } = await shown(propsOf(WORLD));

      expect(rendered.queryByTestId('cell-rows-sheet')).toBeNull();
    });

    it('titles the sheet with the row and the month, and lists the rows of that cell only', async () => {
      const { rendered } = await pressed(propsOf(WORLD), 'category-groceries', 1);

      expect(rendered.getByText('Groceries, February 2025')).toBeTruthy();
      expect(rowIdsOf(rendered)).toEqual(['cell-row-g-feb']);
    });

    it('adds the rows into the amount its cell speaks, in the Total of a category too', async () => {
      const { rendered, table } = await pressed(propsOf(WORLD), 'category-groceries', 6);
      const cell = cellsOf(table, 'category-groceries')[6];

      expect(rendered.getByText('Groceries, Total')).toBeTruthy();
      expect(rowIdsOf(rendered)).toHaveLength(4);
      expect(
        within(rendered.getByTestId('cell-rows-total')).getByText(cell.accessibilityValue),
      ).toBeTruthy();
    });

    it('lists every category under the All cell of a month, newest first', async () => {
      const { rendered } = await pressed(propsOf(WORLD), 'all', 1);

      expect(rowIdsOf(rendered)).toEqual(['cell-row-t-feb', 'cell-row-g-feb']);
    });

    it('lists only the categories a held pick keeps under the All cell', async () => {
      const { rendered } = await pressed(
        propsOf(WORLD, { excludedCategories: new Set(['transport']) }),
        'all',
        1,
      );

      expect(rowIdsOf(rendered)).toEqual(['cell-row-g-feb']);
    });

    it('labels a row with no description as Home labels it, by its holding', async () => {
      const { rendered } = await pressed(propsOf(WORLD), 'category-groceries', 1);

      expect(
        within(rendered.getByTestId('cell-row-g-feb')).getByText(
          i18n.t('transactions.defaultDescriptionExpense', { name: CARD.name }),
        ),
      ).toBeTruthy();
    });

    it('keeps the total of the sheet equal to its cell when the ledger changes under it', async () => {
      const props = propsOf(WORLD);
      const { rendered } = await pressed(props, 'category-groceries', 1);
      const refreshed = propsOf(
        [...WORLD, spend('g-feb-synced', 'groceries', 25_00, FEBRUARY.start + 3_000)],
        { sheetGeneration: props.sheetGeneration },
      );

      await rendered.rerender(<CategoryTable {...refreshed} />);
      const table = mockDataTable.mock.calls.at(-1)?.[0] as TableProps;

      expect(rowIdsOf(rendered)).toEqual(['cell-row-g-feb-synced', 'cell-row-g-feb']);
      expect(
        within(rendered.getByTestId('cell-rows-total')).getByText(
          cellsOf(table, 'category-groceries')[1].accessibilityValue,
        ),
      ).toBeTruthy();
    });

    it('closes the sheet when the screen stops showing, which moves the generation on', async () => {
      const props = propsOf(WORLD);
      const { rendered } = await pressed(props, 'category-groceries', 1);

      await rendered.rerender(<CategoryTable {...props} sheetGeneration={1} />);

      expect(rendered.queryByText('Groceries, February 2025')).toBeNull();
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
