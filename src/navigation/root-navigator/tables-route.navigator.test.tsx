import { act, fireEvent } from '@testing-library/react-native';
import { mockUseLiveQuery } from '@kiko/test-support/mock-statistics-data-layer';
import { answerFilterData, FILTER_DATA_CLOCK } from '@kiko/test-support/statistics-filter-data';
import { resetStatisticsFilterSelection } from '@kiko/test-support/reset-statistics-filter-selection';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import {
  goToTab,
  navigationRef,
  pickThisQuarter,
  renderRoot,
  setLayout,
  THIS_QUARTER,
} from './__fixtures__/tables-navigator-world';
import { layout } from './__fixtures__/mock-layout';

/**
 * The Statistics screen's button opens the Tables screen on the real RootNavigator, in the Home
 * tab's companion pane and on the Statistics tab, and the period lives in the route params: a
 * fold or an unfold, which remounts the screen, keeps it, and a new push opens on the default.
 */

jest.mock('@kiko/display-regions', () =>
  require('./__fixtures__/mock-layout').displayRegionsModule(),
);

jest.mock('@bottom-tabs/react-navigation', () =>
  require('./__fixtures__/mock-layout').bottomTabsModule(),
);

type StackRoute = {
  name: string;
  params?: { period?: { kind: string; year?: number }; view?: string };
};

const BUTTON = 'statistics-open-tables';

const routesOf = (tab: string): StackRoute[] => {
  const state = navigationRef.getRootState()?.routes.find(({ name }) => name === tab)?.state;

  return (state?.routes ?? []) as StackRoute[];
};

const tablesRouteOf = (tab: string): StackRoute | undefined =>
  routesOf(tab).find(({ name }) => name === 'Tables');

describe('the Tables route on the real RootNavigator', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: FILTER_DATA_CLOCK });
    layout.mode = 'single';
    mockUseLiveQuery.mockImplementation(answerFilterData);
  });

  afterEach(async () => {
    await resetStatisticsFilterSelection();
    jest.useRealTimers();
  });

  it('opens from the button on the Statistics tab', async () => {
    const rendered = await renderRoot();

    await goToTab('StatisticsTab');
    await fireEvent.press(rendered.getByTestId(BUTTON));

    expect(tablesRouteOf('StatisticsTab')).toBeDefined();
    expect(rendered.getByTestId('tables-period')).toHaveTextContent('This year', {
      exact: false,
    });
  });

  it('opens from the button on the Statistics screen that is the Home companion', async () => {
    layout.mode = 'columns';
    const rendered = await renderRoot();

    await fireEvent.press(rendered.getByTestId(BUTTON));

    expect(tablesRouteOf('HomeTab')).toBeDefined();
    expect(rendered.getByTestId('tables-period')).toBeTruthy();
  });

  it('keeps a picked period from one pane to two and back', async () => {
    const rendered = await renderRoot();

    await goToTab('StatisticsTab');
    await fireEvent.press(rendered.getByTestId(BUTTON));
    await pickThisQuarter(rendered);

    expect(rendered.getByTestId('tables-period')).toHaveTextContent('This quarter', {
      exact: false,
    });

    await setLayout('columns');

    expect(tablesRouteOf('StatisticsTab')?.params?.period).toEqual(THIS_QUARTER);
    expect(rendered.getByTestId('tables-period')).toHaveTextContent('This quarter', {
      exact: false,
    });

    await setLayout('single');

    expect(rendered.getByTestId('tables-period')).toHaveTextContent('This quarter', {
      exact: false,
    });
  });

  it('opens a new push on this year after the screen was popped', async () => {
    const rendered = await renderRoot();

    await goToTab('StatisticsTab');
    await fireEvent.press(rendered.getByTestId(BUTTON));
    await pickThisQuarter(rendered);

    await act(async () => {
      navigationRef.goBack();
    });

    expect(tablesRouteOf('StatisticsTab')).toBeUndefined();

    await fireEvent.press(rendered.getByTestId(BUTTON));

    expect(tablesRouteOf('StatisticsTab')?.params?.period).toBeUndefined();
    expect(rendered.getByTestId('tables-period')).toHaveTextContent('This year', {
      exact: false,
    });
  });

  describe('the table that shows', () => {
    const pickCashFlow = async (rendered: Awaited<ReturnType<typeof renderRoot>>) => {
      await fireEvent.press(rendered.getByTestId('tables-view-option-cashFlow'));
    };

    it('keeps the cash flow table from one pane to two and back', async () => {
      const rendered = await renderRoot();

      await goToTab('StatisticsTab');
      await fireEvent.press(rendered.getByTestId(BUTTON));
      await pickCashFlow(rendered);

      expect(rendered.getByTestId('cash-flow-table')).toBeTruthy();

      await setLayout('columns');

      expect(tablesRouteOf('StatisticsTab')?.params?.view).toBe('cashFlow');
      expect(rendered.getByTestId('cash-flow-table')).toBeTruthy();

      await setLayout('single');

      expect(rendered.getByTestId('cash-flow-table')).toBeTruthy();
      expect(rendered.queryByTestId('category-table')).toBeNull();
    });

    it('opens a new push on the category table after the cash flow table was popped', async () => {
      const rendered = await renderRoot();

      await goToTab('StatisticsTab');
      await fireEvent.press(rendered.getByTestId(BUTTON));
      await pickCashFlow(rendered);

      await act(async () => {
        navigationRef.goBack();
      });
      await fireEvent.press(rendered.getByTestId(BUTTON));

      expect(tablesRouteOf('StatisticsTab')?.params?.view).toBeUndefined();
      expect(rendered.getByTestId('category-table')).toBeTruthy();
      expect(rendered.queryByTestId('cash-flow-table')).toBeNull();
    });
  });
});
