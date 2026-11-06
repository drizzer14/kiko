import type { ComponentProps } from 'react';
import { StyleSheet, Text } from 'react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import {
  asNavigationProp,
  asRouteProp,
  navigationSpy,
  paramsAfter,
} from '@kiko/test-support/navigation-props';
import { calendarMonthOf } from '@kiko/dates';
import {
  registerLightThemeFirst,
  restoreThemeOrder,
} from '@kiko/test-support/light-theme-registered';
import {
  answerFilterData,
  pressFilterOption,
  transactionRowOf,
} from '@kiko/test-support/statistics-filter-data';
import { darkTheme } from '@kiko/design-system/theme';
import Screen from '@kiko/design-system/components/screen';
import { reportWindow } from '@kiko/test-support/window-size';
import { localDaysFrom } from '@kiko/test-support/local-days-from';
import type { BackfillStatus } from '@kiko/rates/history-backfill';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { mockUseLiveQuery } from '@kiko/test-support/mock-statistics-data-layer';
import { useDateRangeSelection } from '@kiko/design-system/use-date-range-selection';
import { categoryColor, resolveCategoryColor } from '@kiko/statistics/category-breakdown';
import { act, fireEvent, render, renderHook, within } from '@testing-library/react-native';
import { useStatisticsFilterSelection } from '@kiko/design-system/use-statistics-filter-selection';
import { resetStatisticsFilterSelection } from '@kiko/test-support/reset-statistics-filter-selection';

import TablesScreen from './tables.screen';
import { monthTitle } from './month-column-label';

jest.mock('@kiko/navigation/pane-stack', () => ({ useIsScreenVisible: () => true }));

type Props = ComponentProps<typeof TablesScreen>;

const SPENT_AT = localDaysFrom(Date.now(), -2);
const SPENT_IN = monthTitle(calendarMonthOf(SPENT_AT), i18n.t);

const answerWith =
  (override: (tables: string[], answer: ReturnType<typeof answerFilterData>) => unknown) =>
  (query: { kind?: string }, tables: string[]) => {
    const answer = answerFilterData(query, tables);

    return { ...answer, data: override(tables, answer) ?? answer.data };
  };

const screenElement = (params: Props['route']['params'], navigation = navigationSpy()) => (
  <TablesScreen
    route={asRouteProp<Props['route']>('Tables', params)}
    navigation={asNavigationProp<Props['navigation']>(navigation)}
  />
);

const renderTables = async (params: Props['route']['params'] = undefined) => {
  const navigation = navigationSpy();
  const rendered = await render(screenElement(params, navigation), {
    wrapper: GestureRootWrapper,
  });

  return { navigation, ...rendered };
};

const spokenValue = (node: { props: { accessibilityValue?: { text?: string } } }) =>
  node.props.accessibilityValue?.text;

describe('TablesScreen', () => {
  beforeEach(() => {
    mockUseLiveQuery.mockImplementation(answerFilterData);
  });

  afterEach(resetStatisticsFilterSelection);

  describe('the category table', () => {
    it('shows each category of the data in the month it was spent, with the full amount spoken', async () => {
      const { getByLabelText } = await renderTables();

      expect(spokenValue(getByLabelText(`Groceries, ${SPENT_IN}`))).toBe('300.00 ₴');
      expect(spokenValue(getByLabelText(`Transport, ${SPENT_IN}`))).toBe('100.00 ₴');
      expect(spokenValue(getByLabelText(`All, ${SPENT_IN}`))).toBe('400.00 ₴');
    });

    it('names the base currency and the rate in the caption', async () => {
      const { getByTestId } = await renderTables();

      expect(getByTestId('category-table-caption')).toHaveTextContent(
        "Spending by category in UAH, in whole units, at today's rate.",
        { exact: false },
      );
    });

    it('leaves out a negative row that sets a balance, as the donut does', async () => {
      mockUseLiveQuery.mockImplementation(
        answerWith((tables, answer) =>
          tables[0] === 'transactions'
            ? [
                ...(answer.data as object[]),
                transactionRowOf({
                  id: 'opening',
                  holdingId: 'h1',
                  time: SPENT_AT,
                  amountMinorUnits: -999_00,
                  category: 'groceries',
                  setsBalance: true,
                }),
              ]
            : undefined,
        ),
      );

      const { getByLabelText } = await renderTables();

      expect(spokenValue(getByLabelText(`Groceries, ${SPENT_IN}`))).toBe('300.00 ₴');
    });

    describe('beside a credit of the amount of a real debit on another holding', () => {
      const creditOf = (setsBalance: boolean) =>
        transactionRowOf({
          id: 'credit',
          holdingId: 'h1',
          time: SPENT_AT + 1_000,
          amountMinorUnits: 100_00,
          category: 'groceries',
          setsBalance,
        });
      const seedCredit = (setsBalance: boolean) =>
        mockUseLiveQuery.mockImplementation(
          answerWith((tables, answer) =>
            tables[0] === 'transactions'
              ? [...(answer.data as object[]), creditOf(setsBalance)]
              : undefined,
          ),
        );

      it('counts the debit when the credit sets a balance, as the donut does', async () => {
        seedCredit(true);

        const { getByLabelText } = await renderTables();

        expect(spokenValue(getByLabelText(`Transport, ${SPENT_IN}`))).toBe('100.00 ₴');
        expect(spokenValue(getByLabelText(`All, ${SPENT_IN}`))).toBe('400.00 ₴');
      });

      it('leaves the debit out when the two rows are a pair of own holdings', async () => {
        seedCredit(false);

        const { getByLabelText, queryByLabelText } = await renderTables();

        expect(queryByLabelText(`Transport, ${SPENT_IN}`)).toBeNull();
        expect(spokenValue(getByLabelText(`All, ${SPENT_IN}`))).toBe('300.00 ₴');
      });
    });
  });

  describe('while the data loads', () => {
    it('shows the loading state, never an empty state or a table', async () => {
      mockUseLiveQuery.mockImplementation(() => ({ data: [], isLoading: true, isFresh: false }));

      const { getByTestId, queryByTestId, queryByText } = await renderTables();

      expect(getByTestId('tables-loading')).toBeTruthy();
      expect(queryByTestId('category-table-caption')).toBeNull();
      expect(queryByText('No spending in this period')).toBeNull();
    });
  });

  describe('with no spending', () => {
    it('shows the empty state and no table of zeros', async () => {
      mockUseLiveQuery.mockImplementation(
        answerWith((tables) => (tables[0] === 'transactions' ? [] : undefined)),
      );

      const { getByText, queryByTestId } = await renderTables();

      expect(getByText('No spending in this period')).toBeTruthy();
      expect(queryByTestId('category-table-caption')).toBeNull();
    });

    it('keeps the filters and the period on screen, so the empty period can be left', async () => {
      mockUseLiveQuery.mockImplementation(
        answerWith((tables) => (tables[0] === 'transactions' ? [] : undefined)),
      );

      const { getByTestId } = await renderTables();

      expect(getByTestId('tables-account-filter')).toBeTruthy();
      expect(getByTestId('tables-category-filter')).toBeTruthy();
      expect(getByTestId('tables-period')).toBeTruthy();
    });
  });

  // Under the shown native header, the header owns the top inset; a top edge here left a blank
  // band the height of the inset between the bar and the content.
  describe('the safe area under the header', () => {
    // The package's SafeAreaView hands the native view all four edges, a dropped one as 'off'.
    const EDGES_UNDER_HEADER = {
      top: 'off',
      right: 'additive',
      bottom: 'additive',
      left: 'additive',
    };

    it('drops the top edge when the table shows', async () => {
      const { getByTestId } = await renderTables();

      expect(getByTestId('screen-content').parent?.props.edges).toEqual(EDGES_UNDER_HEADER);
    });

    it('drops the top edge while the data loads', async () => {
      mockUseLiveQuery.mockImplementation(() => ({ data: [], isLoading: true, isFresh: false }));

      const { getByTestId } = await renderTables();

      expect(getByTestId('screen-content').parent?.props.edges).toEqual(EDGES_UNDER_HEADER);
    });

    it('drops the top edge in the empty state', async () => {
      mockUseLiveQuery.mockImplementation(
        answerWith((tables) => (tables[0] === 'transactions' ? [] : undefined)),
      );

      const { getByTestId } = await renderTables();

      expect(getByTestId('screen-content').parent?.props.edges).toEqual(EDGES_UNDER_HEADER);
    });
  });

  // The pane cap keeps a form from stretching across a wide window; a table of twelve months is
  // wider than it, so the screen takes the whole window in each of its three states.
  describe('the width on a regular window', () => {
    const rootStyleOf = (rendered: Awaited<ReturnType<typeof renderTables>>) =>
      StyleSheet.flatten(rendered.getByTestId('screen-content').parent?.props.style);

    beforeEach(() => {
      reportWindow('regular', 1376, 1032);
    });

    afterEach(() => {
      reportWindow('compact', 393, 852);
    });

    it('is capped for a plain Screen of the same window, so the cases below are a change', async () => {
      const plain = await render(
        <Screen belowHeader>
          <Text>content</Text>
        </Screen>,
      );

      expect(
        StyleSheet.flatten(plain.getByTestId('screen-content').parent?.props.style).maxWidth,
      ).toBe(darkTheme.layout.paneMaxWidth);
    });

    it('is not capped while the table shows', async () => {
      expect(rootStyleOf(await renderTables()).maxWidth).toBeUndefined();
    });

    it('is not capped while the data loads', async () => {
      mockUseLiveQuery.mockImplementation(() => ({ data: [], isLoading: true, isFresh: false }));

      expect(rootStyleOf(await renderTables()).maxWidth).toBeUndefined();
    });

    it('is not capped in the empty state', async () => {
      mockUseLiveQuery.mockImplementation(
        answerWith((tables) => (tables[0] === 'transactions' ? [] : undefined)),
      );

      expect(rootStyleOf(await renderTables()).maxWidth).toBeUndefined();
    });
  });

  describe('the controls', () => {
    it('scroll with the caption, above it, inside the table', async () => {
      const { getByTestId } = await renderTables();
      const top = getByTestId('category-table-top');

      expect(within(top).getByTestId('tables-account-filter')).toBeTruthy();
      expect(within(top).getByTestId('tables-category-filter')).toBeTruthy();
      expect(within(top).getByTestId('tables-period')).toBeTruthy();
      expect(within(top).getByTestId('category-table-caption')).toBeTruthy();
    });
  });

  describe('a filter sheet that is open while a pick crosses between the table and the empty state', () => {
    const OPTION = 'tables-account-filter-option-c';
    const withIdleAccount = answerWith((tables, answer) => {
      if (tables[0] === 'accounts') {
        return [...(answer.data as object[]), { id: 'c', name: 'Idle', kind: 'cash', color: null }];
      }

      if (tables[0] === 'holdings') {
        return [
          ...(answer.data as object[]),
          {
            id: 'h3',
            accountId: 'c',
            currency: 'UAH',
            type: 'cash',
            balanceMinorUnits: 1_000,
            metadata: null,
            closedAt: null,
          },
        ];
      }

      return undefined;
    });

    it('stays open both ways: into the empty state, and back to the table', async () => {
      mockUseLiveQuery.mockImplementation(withIdleAccount);

      const { getByTestId, getByText, queryByTestId } = await renderTables();

      // The sheet is not rendered while it is closed, so the option rows below prove it is open.
      expect(queryByTestId(OPTION)).toBeNull();

      await act(async () => {
        await fireEvent.press(getByTestId('tables-account-filter'));
      });
      await act(async () => {
        await fireEvent.press(getByTestId(OPTION));
      });

      expect(getByText('No spending in this period')).toBeTruthy();
      expect(queryByTestId('category-table-body-row')).toBeNull();
      expect(getByTestId(OPTION)).toBeTruthy();

      await act(async () => {
        await fireEvent.press(getByTestId(OPTION));
      });

      expect(getByTestId('category-table-body-row')).toBeTruthy();
      expect(queryByTestId('category-table-empty')).toBeNull();
      expect(getByTestId(OPTION)).toBeTruthy();
    });
  });

  describe('the period', () => {
    it('opens on the last 12 months when the route carries no period', async () => {
      const { getByTestId } = await renderTables();

      expect(getByTestId('tables-period')).toHaveTextContent('Last 12 months', { exact: false });
    });

    it('shows the year the route carries', async () => {
      const year = new Date().getFullYear();
      const { getByTestId } = await renderTables({ period: { kind: 'year', year } });

      expect(getByTestId('tables-period')).toHaveTextContent(String(year), { exact: false });
    });

    it('reads a year the data does not reach as the last 12 months', async () => {
      const { getByTestId } = await renderTables({ period: { kind: 'year', year: 1999 } });

      expect(getByTestId('tables-period')).toHaveTextContent('Last 12 months', { exact: false });
    });

    it('writes a pick to the route params, so a remount opens on it', async () => {
      const year = new Date().getFullYear();
      const first = await renderTables();

      await fireEvent.press(first.getByTestId('tables-period'));
      await fireEvent.press(first.getByTestId(`tables-period-option-year-${year}`));

      expect(first.navigation.setParams).toHaveBeenCalledWith({
        period: { kind: 'year', year },
      });
      await first.unmount();

      const second = await renderTables(
        paramsAfter(first.navigation, {}) as Props['route']['params'],
      );

      expect(second.getByTestId('tables-period')).toHaveTextContent(String(year), {
        exact: false,
      });
    });
  });

  describe('the filters shared with Statistics', () => {
    it('narrows the table and its All row to an account held from Statistics', async () => {
      const held = await renderHook(() => useStatisticsFilterSelection());

      await act(async () => {
        held.result.current.toggleAccount('b');
      });

      const { getByLabelText, queryByLabelText } = await renderTables();

      expect(spokenValue(getByLabelText(`Transport, ${SPENT_IN}`))).toBe('100.00 ₴');
      expect(queryByLabelText(`Groceries, ${SPENT_IN}`)).toBeNull();
      expect(spokenValue(getByLabelText(`All, ${SPENT_IN}`))).toBe('100.00 ₴');
      await held.unmount();
    });

    it('narrows the table and its All row to a category held from Statistics', async () => {
      const held = await renderHook(() => useStatisticsFilterSelection());

      await act(async () => {
        held.result.current.toggleCategory('groceries');
      });

      const { getByLabelText, queryByLabelText } = await renderTables();

      expect(spokenValue(getByLabelText(`All, ${SPENT_IN}`))).toBe('300.00 ₴');
      expect(queryByLabelText(`Transport, ${SPENT_IN}`)).toBeNull();
      await held.unmount();
    });

    it('holds an account picked here for Statistics too', async () => {
      const { getByTestId } = await renderTables();

      await pressFilterOption(getByTestId, 'tables-account-filter', 'a');

      const reader = await renderHook(() => useStatisticsFilterSelection());

      expect(reader.result.current.selectedAccounts).toEqual(new Set(['a']));
      await reader.unmount();
    });

    // A payment and its return share a group, and a date edit moved the payment a month earlier:
    // the period nets the group out, so the category has no period slice, yet a cell of its own.
    describe('a category that a month spends on and the period nets out', () => {
      const PAID_AT = calendarMonthOf(calendarMonthOf(SPENT_AT).start - 1).start + 1_000;
      const PAID_IN = monthTitle(calendarMonthOf(PAID_AT), i18n.t);
      const withNettedOutCategory = answerWith((tables, answer) => {
        if (tables[0] === 'categories') {
          return [
            ...(answer.data as object[]),
            { key: 'refunded', title: 'Refunded', icon: 'arrow.uturn.left' },
          ];
        }

        if (tables[0] === 'transactions') {
          return [
            ...(answer.data as object[]),
            transactionRowOf({
              id: 'paid',
              holdingId: 'h1',
              time: PAID_AT,
              amountMinorUnits: -200_00,
              category: 'refunded',
              changeGroupId: 'refund-group',
            }),
            transactionRowOf({
              id: 'returned',
              holdingId: 'h1',
              time: SPENT_AT,
              amountMinorUnits: 250_00,
              changeGroupId: 'refund-group',
            }),
          ];
        }

        return undefined;
      });

      it('is offered by the category menu, and a pick of another category removes its row', async () => {
        mockUseLiveQuery.mockImplementation(withNettedOutCategory);

        const { getByTestId, getByLabelText, queryByLabelText } = await renderTables();

        expect(spokenValue(getByLabelText(`Refunded, ${PAID_IN}`))).toBe('200.00 ₴');

        await act(async () => {
          await fireEvent.press(getByTestId('tables-category-filter'));
        });

        expect(getByTestId('tables-category-filter-option-refunded')).toBeTruthy();

        await act(async () => {
          await fireEvent.press(getByTestId('tables-category-filter-option-groceries'));
        });

        expect(queryByLabelText(`Refunded, ${PAID_IN}`)).toBeNull();
        expect(spokenValue(getByLabelText(`All, ${PAID_IN}`))).toBe('0.00 ₴');
        expect(spokenValue(getByLabelText(`All, ${SPENT_IN}`))).toBe('300.00 ₴');
      });
    });

    it('offers the categories of the period, and keeps a held pick that is not in it', async () => {
      const held = await renderHook(() => useStatisticsFilterSelection());

      await act(async () => {
        held.result.current.toggleCategory('transport');
      });

      const { getByTestId } = await renderTables();

      await fireEvent.press(getByTestId('tables-category-filter'));

      expect(getByTestId('tables-category-filter-option-groceries')).toBeTruthy();
      expect(getByTestId('tables-category-filter-option-transport')).toBeTruthy();
      await held.unmount();
    });

    it('tints a category option through the light map in the light scheme', async () => {
      registerLightThemeFirst();

      try {
        const { getByTestId } = await renderTables();

        await fireEvent.press(getByTestId('tables-category-filter'));

        const tint = getByTestId('tables-category-filter-option-groceries').queryAll(
          (node) => node.props.name === 'cart',
        )[0]?.props.tintColor;

        expect(tint).toBe(resolveCategoryColor(null, 'groceries', 'light'));
        expect(tint).not.toBe(categoryColor('groceries'));
      } finally {
        restoreThemeOrder();
      }
    });
  });

  describe('the shared date filter', () => {
    it('is neither read nor changed', async () => {
      const filter = await renderHook(() => useDateRangeSelection(Date.now()));
      const from = new Date(localDaysFrom(Date.now(), -300));
      const to = new Date(localDaysFrom(Date.now(), -290));

      await act(async () => {
        filter.result.current.applyDateRange(from, to);
      });

      const { getByLabelText } = await renderTables();

      expect(spokenValue(getByLabelText(`Groceries, ${SPENT_IN}`))).toBe('300.00 ₴');
      expect(filter.result.current.dateFrom).toEqual(from);
      expect(filter.result.current.dateTo).toEqual(to);

      await act(async () => {
        filter.result.current.clearDateRange();
      });
      await filter.unmount();
    });
  });

  describe('the view', () => {
    it('opens on the category table when the route carries no view', async () => {
      const { getByTestId, queryByTestId } = await renderTables();

      expect(getByTestId('category-table')).toBeTruthy();
      expect(queryByTestId('cash-flow-table')).toBeNull();
      expect(getByTestId('tables-view-selected')).toBeTruthy();
    });

    it('shows the cash flow table when the route carries it', async () => {
      const { getByTestId, queryByTestId } = await renderTables({ view: 'cashFlow' });

      expect(getByTestId('cash-flow-table')).toBeTruthy();
      expect(queryByTestId('category-table')).toBeNull();
    });

    it('writes a pick to the route params, either way', async () => {
      const first = await renderTables();

      await fireEvent.press(first.getByTestId('tables-view-option-cashFlow'));

      expect(first.navigation.setParams).toHaveBeenCalledWith({ view: 'cashFlow' });
      await first.unmount();

      const second = await renderTables({ view: 'cashFlow' });

      await fireEvent.press(second.getByTestId('tables-view-option-categories'));

      expect(second.navigation.setParams).toHaveBeenCalledWith({ view: 'categories' });
    });
  });

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

    it('reads the income, the expenses, the net and the savings rate of the month', async () => {
      withRows(SALARY);

      const { getByLabelText } = await renderTables({ view: 'cashFlow' });

      expect(spokenValue(getByLabelText(`Income, ${SPENT_IN}`))).toBe('500.00 ₴');
      expect(spokenValue(getByLabelText(`Expenses, ${SPENT_IN}`))).toBe('400.00 ₴');
      expect(spokenValue(getByLabelText(`Net, ${SPENT_IN}`))).toBe('100.00 ₴');
      expect(spokenValue(getByLabelText(`Savings rate, ${SPENT_IN}`))).toBe('20%');
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

      const { getByLabelText } = await renderTables({ view: 'cashFlow' });

      expect(spokenValue(getByLabelText(`Income, ${SPENT_IN}`))).toBe('500.00 ₴');
      expect(spokenValue(getByLabelText(`Expenses, ${SPENT_IN}`))).toBe('400.00 ₴');
      expect(spokenValue(getByLabelText(`Net, ${SPENT_IN}`))).toBe('100.00 ₴');
      await held.unmount();
    });

    it('narrows to an account held from Statistics', async () => {
      withRows(SALARY);

      const held = await renderHook(() => useStatisticsFilterSelection());

      await act(async () => {
        held.result.current.toggleAccount('b');
      });

      const { getByLabelText } = await renderTables({ view: 'cashFlow' });

      expect(spokenValue(getByLabelText(`Income, ${SPENT_IN}`))).toBe('0.00 ₴');
      expect(spokenValue(getByLabelText(`Expenses, ${SPENT_IN}`))).toBe('100.00 ₴');
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

      const { getByLabelText } = await renderTables({ view: 'cashFlow' });

      expect(spokenValue(getByLabelText(`Expenses, ${SPENT_IN}`))).toBe('400.00 ₴');
      expect(spokenValue(getByLabelText(`Income, ${SPENT_IN}`))).toBe('0.00 ₴');
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

        const { getByLabelText } = await renderTables({ view: 'cashFlow' });

        expect(spokenValue(getByLabelText(`Expenses, ${SPENT_IN}`))).toBe('400.00 ₴');
        expect(spokenValue(getByLabelText(`Income, ${SPENT_IN}`))).toBe('0.00 ₴');
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

        const { getByLabelText } = await renderTables({ view: 'cashFlow' });

        expect(spokenValue(getByLabelText(`Income, ${SPENT_IN}`))).toBe('250.00 ₴');
        expect(spokenValue(getByLabelText(`Expenses, ${SPENT_IN}`))).toBe('400.00 ₴');
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

  describe('a switch of language while the table shows', () => {
    let rendered: Awaited<ReturnType<typeof renderTables>>;

    beforeEach(async () => {
      rendered = await renderTables();
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('writes the caption, the headers and the labels in the new language at once', () => {
      expect(rendered.getByTestId('category-table-caption')).toHaveTextContent(
        'Витрати за категоріями в UAH',
        { exact: false },
      );
      expect(
        rendered.getAllByText('Разом', { includeHiddenElements: true }).length,
      ).toBeGreaterThan(0);
      expect(rendered.queryByText('Total', { includeHiddenElements: true })).toBeNull();
      expect(rendered.getByTestId('tables-period')).toHaveTextContent('Останні 12 місяців', {
        exact: false,
      });
    });
  });

  describe('a switch of base currency while the table shows', () => {
    it('converts the amounts and names the new currency at once', async () => {
      const { getByTestId, getByLabelText, rerender } = await renderTables();

      mockUseLiveQuery.mockImplementation(
        answerWith((tables) => {
          if (tables[0] === 'settings') {
            return [{ baseCurrency: 'USD' }];
          }

          return tables[0] === 'currency_rates'
            ? [{ base: 'USD', quote: 'UAH', rate: '40', source: 'nbu' }]
            : undefined;
        }),
      );
      await rerender(screenElement(undefined));

      expect(getByTestId('category-table-caption')).toHaveTextContent('in USD', { exact: false });
      expect(spokenValue(getByLabelText(`Groceries, ${SPENT_IN}`))).toBe('$7.50');
    });
  });

  describe('the rate-history backfill', () => {
    // The data-layer helper already stubs `runBackfill` with a run that never ends, and its mock
    // is the one the store calls; the spy only counts the calls and settles one.
    const backfillModule = jest.requireMock('@kiko/rates/history-backfill') as {
      runBackfill: () => Promise<BackfillStatus>;
    };
    const runBackfillSpy = jest.spyOn(backfillModule, 'runBackfill');

    afterAll(() => {
      runBackfillSpy.mockRestore();
    });

    it('starts the run when Tables is the first screen to open', async () => {
      await renderTables();

      expect(runBackfillSpy).toHaveBeenCalledTimes(1);
    });

    it('starts no run when it is pushed after a settled run', async () => {
      runBackfillSpy.mockResolvedValueOnce({ state: 'complete', lastDay: Date.now() });

      await renderTables();
      await act(async () => {});
      await renderTables();

      expect(runBackfillSpy).toHaveBeenCalledTimes(1);
    });
  });
});
