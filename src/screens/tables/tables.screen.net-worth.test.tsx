import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { calendarMonthOf } from '@kiko/dates';
import { act, fireEvent, renderHook } from '@testing-library/react-native';
import { answerFilterData } from '@kiko/test-support/statistics-filter-data';
import { mockUseLiveQuery } from '@kiko/test-support/mock-statistics-data-layer';
import { useStatisticsFilterSelection } from '@kiko/design-system/use-statistics-filter-selection';
import { resetStatisticsFilterSelection } from '@kiko/test-support/reset-statistics-filter-selection';

import { monthTitle } from './month-column-label';
import { answerWith, renderTables, spokenValue } from './__fixtures__/tables-screen-world';

jest.mock('@kiko/navigation/pane-stack', () => ({ useIsScreenVisible: () => true }));

describe('TablesScreen', () => {
  beforeEach(() => {
    mockUseLiveQuery.mockImplementation(answerFilterData);
  });

  afterEach(resetStatisticsFilterSelection);

  describe('the net worth table', () => {
    const THIS_MONTH = monthTitle(calendarMonthOf(Date.now()), i18n.t);
    // A closed account is the one an archived pick names: its holding must not reach the table.
    const withArchivedAccount = () =>
      mockUseLiveQuery.mockImplementation(
        answerWith((tables, answer) => {
          if (tables[0] === 'accounts') {
            return [
              ...(answer.data as object[]),
              { id: 'old', name: 'Old', kind: 'bank', color: null, archivedAt: 1 },
            ];
          }

          return tables[0] === 'holdings'
            ? [
                ...(answer.data as object[]),
                {
                  id: 'h-old',
                  accountId: 'old',
                  currency: 'UAH',
                  type: 'cash',
                  balanceMinorUnits: 700_000,
                  metadata: null,
                  closedAt: null,
                },
              ]
            : undefined;
        }),
      );

    it('shows it when the route carries it, and writes a pick of it to the route params', async () => {
      const { getByTestId, queryByTestId, navigation } = await renderTables({ view: 'netWorth' });

      expect(getByTestId('net-worth-table')).toBeTruthy();
      expect(queryByTestId('category-table')).toBeNull();

      await fireEvent.press(getByTestId('tables-view-option-categories'));
      await fireEvent.press(getByTestId('tables-view-option-netWorth'));

      expect(navigation.setParams).toHaveBeenCalledWith({ view: 'netWorth' });
    });

    it('reads the value of each account and of all of them at today for the running month', async () => {
      const { getByLabelText } = await renderTables({ view: 'netWorth' });

      expect(spokenValue(getByLabelText(`Cash, ${THIS_MONTH}`))).toBe('1,000.00 ₴');
      expect(spokenValue(getByLabelText(`Bank, ${THIS_MONTH}`))).toBe('500.00 ₴');
      expect(spokenValue(getByLabelText(`All, ${THIS_MONTH}`))).toBe('1,500.00 ₴');
    });

    it('names the base currency and the rates in the caption', async () => {
      const { getByTestId } = await renderTables({ view: 'netWorth' });

      expect(getByTestId('net-worth-table-caption')).toHaveTextContent(
        "Net worth by account in UAH, in whole units, at the rate of each month's end.",
        { exact: false },
      );
    });

    it('hides the category filter, and keeps the account filter and the period', async () => {
      const { getByTestId, queryByTestId } = await renderTables({ view: 'netWorth' });

      expect(queryByTestId('tables-category-filter')).toBeNull();
      expect(getByTestId('tables-account-filter')).toBeTruthy();
      expect(getByTestId('tables-period')).toBeTruthy();
    });

    it('holds a category pick without changing a figure of the table', async () => {
      const held = await renderHook(() => useStatisticsFilterSelection());

      await act(async () => {
        held.result.current.toggleCategory('groceries');
      });

      const { getByLabelText } = await renderTables({ view: 'netWorth' });

      expect(spokenValue(getByLabelText(`Cash, ${THIS_MONTH}`))).toBe('1,000.00 ₴');
      expect(spokenValue(getByLabelText(`Bank, ${THIS_MONTH}`))).toBe('500.00 ₴');
      expect(spokenValue(getByLabelText(`All, ${THIS_MONTH}`))).toBe('1,500.00 ₴');
      await held.unmount();
    });

    it('narrows to an account held from Statistics', async () => {
      const held = await renderHook(() => useStatisticsFilterSelection());

      await act(async () => {
        held.result.current.toggleAccount('b');
      });

      const { getByLabelText, queryByLabelText } = await renderTables({ view: 'netWorth' });

      expect(spokenValue(getByLabelText(`All, ${THIS_MONTH}`))).toBe('500.00 ₴');
      expect(queryByLabelText(`Cash, ${THIS_MONTH}`)).toBeNull();
      await held.unmount();
    });

    it('reads a held pick of an archived account as all, and leaves the archived account out', async () => {
      withArchivedAccount();

      const held = await renderHook(() => useStatisticsFilterSelection());

      await act(async () => {
        held.result.current.toggleAccount('old');
      });

      const { getByLabelText, queryByLabelText } = await renderTables({ view: 'netWorth' });

      expect(spokenValue(getByLabelText(`All, ${THIS_MONTH}`))).toBe('1,500.00 ₴');
      expect(queryByLabelText(`Old, ${THIS_MONTH}`)).toBeNull();
      await held.unmount();
    });

    it('shows the table, not the spinner, while the rate history is still loading', async () => {
      const { getByTestId, queryByTestId } = await renderTables({ view: 'netWorth' });

      expect(getByTestId('net-worth-table')).toBeTruthy();
      expect(queryByTestId('tables-net-worth-loading')).toBeNull();
    });

    it('shows the loading state, with the filters, while there is no value yet', async () => {
      mockUseLiveQuery.mockImplementation(
        answerWith((tables) => (tables[0] === 'holdings' ? [] : undefined)),
      );

      const { getByTestId } = await renderTables({ view: 'netWorth' });

      expect(getByTestId('tables-net-worth-loading')).toBeTruthy();
      expect(getByTestId('tables-account-filter')).toBeTruthy();
      expect(getByTestId('tables-period')).toBeTruthy();
    });
  });

  describe('a switch of language while the net worth table shows', () => {
    let rendered: Awaited<ReturnType<typeof renderTables>>;

    beforeEach(async () => {
      rendered = await renderTables({ view: 'netWorth' });
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('writes the caption, the header and the row labels in the new language at once', () => {
      expect(rendered.getByTestId('net-worth-table-caption')).toHaveTextContent(
        'Капітал за рахунками в UAH',
        { exact: false },
      );
      expect(
        rendered.getAllByText('Зміна', { includeHiddenElements: true }).length,
      ).toBeGreaterThan(0);
      expect(rendered.queryByText('Change', { includeHiddenElements: true })).toBeNull();
      expect(
        rendered.getAllByText('Усього', { includeHiddenElements: true }).length,
      ).toBeGreaterThan(0);
    });
  });
});
