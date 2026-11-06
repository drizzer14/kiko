import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { act, renderHook } from '@testing-library/react-native';
import { mockUseLiveQuery } from '@kiko/test-support/mock-statistics-data-layer';
import { answerFilterData, transactionRowOf } from '@kiko/test-support/statistics-filter-data';
import { useStatisticsFilterSelection } from '@kiko/design-system/use-statistics-filter-selection';
import { resetStatisticsFilterSelection } from '@kiko/test-support/reset-statistics-filter-selection';

import {
  answerWith,
  renderTables,
  SPENT_AT,
  SPENT_IN,
  spokenValue,
} from './__fixtures__/tables-screen-world';

jest.mock('@kiko/navigation/pane-stack', () => ({ useIsScreenVisible: () => true }));

describe('TablesScreen', () => {
  beforeEach(() => {
    mockUseLiveQuery.mockImplementation(answerFilterData);
  });

  afterEach(resetStatisticsFilterSelection);

  describe('the cash flow table', () => {
    const withRows = (...rows: Parameters<typeof transactionRowOf>[0][]) =>
      mockUseLiveQuery.mockImplementation(
        answerWith((tables, answer) =>
          tables[0] === 'transactions'
            ? [...(answer.data as object[]), ...rows.map(transactionRowOf)]
            : undefined,
        ),
      );
    const SALARY = {
      id: 'salary',
      holdingId: 'h1',
      time: SPENT_AT + 1_000,
      amountMinorUnits: 500_00,
    };

    // The spoken figure of one row of the month the rows were made in.
    const renderFigures = async () => {
      const { getByLabelText } = await renderTables({ view: 'cashFlow' });

      return (label: string) => spokenValue(getByLabelText(`${label}, ${SPENT_IN}`));
    };

    it('reads the income, the expenses, the net and the savings rate of the month', async () => {
      withRows(SALARY);

      const figure = await renderFigures();

      expect(figure('Income')).toBe('500.00 ₴');
      expect(figure('Expenses')).toBe('400.00 ₴');
      expect(figure('Net')).toBe('100.00 ₴');
      expect(figure('Savings rate')).toBe('20%');
    });

    it('writes the income row label in English, the text the language switch must remove', async () => {
      const { getAllByText } = await renderTables({ view: 'cashFlow' });

      expect(
        getAllByText(i18n.t('tables.cashFlow.income', { lng: 'en' }), {
          includeHiddenElements: true,
        }).length,
      ).toBeGreaterThan(0);
    });

    it('names the base currency and the rate in the caption', async () => {
      const { getByTestId } = await renderTables({ view: 'cashFlow' });

      expect(getByTestId('cash-flow-table-caption')).toHaveTextContent(
        "Cash flow in UAH, in whole units, at today's rate.",
        { exact: false },
      );
    });

    it('shows a dash for a month with no income and reads a word for it', async () => {
      const { getByLabelText } = await renderTables({ view: 'cashFlow' });
      const rate = getByLabelText(`Savings rate, ${SPENT_IN}`);

      expect(rate).toHaveTextContent('–', { exact: false });
      expect(spokenValue(rate)).toBe('No income, so no savings rate');
    });

    it('hides the category filter, and keeps the account filter and the period', async () => {
      const { getByTestId, queryByTestId } = await renderTables({ view: 'cashFlow' });

      expect(queryByTestId('tables-category-filter')).toBeNull();
      expect(getByTestId('tables-account-filter')).toBeTruthy();
      expect(getByTestId('tables-period')).toBeTruthy();
    });

    it('holds a category pick without changing a figure of the table', async () => {
      withRows(SALARY);

      const held = await renderHook(() => useStatisticsFilterSelection());

      await act(async () => {
        held.result.current.toggleCategory('groceries');
      });

      const figure = await renderFigures();

      expect(figure('Income')).toBe('500.00 ₴');
      expect(figure('Expenses')).toBe('400.00 ₴');
      expect(figure('Net')).toBe('100.00 ₴');
      await held.unmount();
    });

    it('narrows to an account held from Statistics', async () => {
      withRows(SALARY);

      const held = await renderHook(() => useStatisticsFilterSelection());

      await act(async () => {
        held.result.current.toggleAccount('b');
      });

      const figure = await renderFigures();

      expect(figure('Income')).toBe('0.00 ₴');
      expect(figure('Expenses')).toBe('100.00 ₴');
      await held.unmount();
    });

    it('leaves a row that sets a balance out of the expenses and out of the income', async () => {
      withRows(
        {
          id: 'negative-opening',
          holdingId: 'h1',
          time: SPENT_AT,
          amountMinorUnits: -999_00,
          setsBalance: true,
        },
        {
          id: 'positive-opening',
          holdingId: 'h1',
          time: SPENT_AT,
          amountMinorUnits: 700_00,
          setsBalance: true,
        },
      );

      const figure = await renderFigures();

      expect(figure('Expenses')).toBe('400.00 ₴');
      expect(figure('Income')).toBe('0.00 ₴');
    });

    describe('beside a row that sets a balance, with the same amount on another holding', () => {
      it('counts the real debit in the expenses', async () => {
        withRows({
          id: 'balance-credit',
          holdingId: 'h1',
          time: SPENT_AT + 1_000,
          amountMinorUnits: 100_00,
          setsBalance: true,
        });

        const figure = await renderFigures();

        expect(figure('Expenses')).toBe('400.00 ₴');
        expect(figure('Income')).toBe('0.00 ₴');
      });

      it('counts the real credit in the income', async () => {
        withRows(
          {
            id: 'balance-debit',
            holdingId: 'h2',
            time: SPENT_AT,
            amountMinorUnits: -250_00,
            setsBalance: true,
          },
          { id: 'real-credit', holdingId: 'h1', time: SPENT_AT + 1_000, amountMinorUnits: 250_00 },
        );

        const figure = await renderFigures();

        expect(figure('Income')).toBe('250.00 ₴');
        expect(figure('Expenses')).toBe('400.00 ₴');
      });
    });

    it('shows the empty state and no table of zeros for a period with nothing in it', async () => {
      mockUseLiveQuery.mockImplementation(
        answerWith((tables) => (tables[0] === 'transactions' ? [] : undefined)),
      );

      const { getByText, getByTestId, queryByTestId } = await renderTables({ view: 'cashFlow' });

      expect(getByText('No income or spending in this period')).toBeTruthy();
      expect(queryByTestId('cash-flow-table-caption')).toBeNull();
      expect(getByTestId('tables-account-filter')).toBeTruthy();
      expect(getByTestId('tables-period')).toBeTruthy();
    });
  });

  describe('a switch of language while the cash flow table shows', () => {
    const INCOME_IN_ENGLISH = i18n.t('tables.cashFlow.income', { lng: 'en' });
    let rendered: Awaited<ReturnType<typeof renderTables>>;

    beforeEach(async () => {
      rendered = await renderTables({ view: 'cashFlow' });
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('writes the caption, the view and the row labels in the new language at once', () => {
      expect(rendered.getByTestId('cash-flow-table-caption')).toHaveTextContent(
        'Рух коштів у UAH',
        { exact: false },
      );
      expect(rendered.getByTestId('tables-view-selected')).toBeTruthy();
      expect(
        rendered.getAllByText('Надходження', { includeHiddenElements: true }).length,
      ).toBeGreaterThan(0);
      expect(rendered.queryByText(INCOME_IN_ENGLISH, { includeHiddenElements: true })).toBeNull();
    });
  });
});
