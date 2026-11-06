import {
  createNavigationContainerRef,
  NavigationContainer,
  type ParamListBase,
} from '@react-navigation/native';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { answerFilterData } from '@kiko/test-support/statistics-filter-data';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { mockUseLiveQuery } from '@kiko/test-support/mock-statistics-data-layer';
import { resetStatisticsFilterSelection } from '@kiko/test-support/reset-statistics-filter-selection';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import { SETTLE_DELAY_MS } from '../pane-stack';

import RootNavigator from './root.navigator';

/**
 * The Statistics screen's button opens the Tables screen on the real RootNavigator, in the Home
 * tab's companion pane and on the Statistics tab, and the period lives in the route params: a
 * fold or an unfold, which remounts the screen, keeps it, and a new push opens on the default.
 */

const mockLayout = { mode: 'single' as 'single' | 'columns', listeners: new Set<() => void>() };

jest.mock('@kiko/display-regions', () => {
  const { useSyncExternalStore } = require('react');

  return {
    ...jest.requireActual('@kiko/display-regions'),
    useLayoutMode: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          mockLayout.listeners.add(listener);

          return () => mockLayout.listeners.delete(listener);
        },
        () => mockLayout.mode,
      ),
    useFoldRegion: () => null,
  };
});

// A tab mounts on its first focus and stays mounted, as the native bottom tabs do.
jest.mock('@bottom-tabs/react-navigation', () => {
  const native = jest.requireActual('@react-navigation/native');
  const LazyTabs = jest.requireActual('@kiko/test-support/lazy-tabs').default;

  return { createNativeBottomTabNavigator: native.createNavigatorFactory(LazyTabs) };
});

const navigationRef = createNavigationContainerRef<ParamListBase>();

type StackRoute = {
  name: string;
  params?: { period?: { kind: string; year?: number }; view?: string };
};

const BUTTON = 'statistics-open-tables';

const renderRoot = async () => {
  const rendered = await render(
    <NavigationContainer ref={navigationRef}>
      <RootNavigator />
    </NavigationContainer>,
    { wrapper: GestureRootWrapper },
  );

  await waitFor(() => expect(navigationRef.isReady()).toBe(true));

  return rendered;
};

const goToTab = async (tab: string): Promise<void> => {
  await act(async () => {
    navigationRef.navigate(tab);
  });
};

const setLayout = async (mode: 'single' | 'columns'): Promise<void> => {
  await act(async () => {
    mockLayout.mode = mode;

    for (const listener of mockLayout.listeners) {
      listener();
    }
  });
  await act(async () => {
    jest.advanceTimersByTime(SETTLE_DELAY_MS);
  });
};

const routesOf = (tab: string): StackRoute[] => {
  const state = navigationRef.getRootState()?.routes.find(({ name }) => name === tab)?.state;

  return (state?.routes ?? []) as StackRoute[];
};

const tablesRouteOf = (tab: string): StackRoute | undefined =>
  routesOf(tab).find(({ name }) => name === 'Tables');

const pickYear = async (rendered: Awaited<ReturnType<typeof renderRoot>>, year: number) => {
  await fireEvent.press(rendered.getByTestId('tables-period'));
  await fireEvent.press(rendered.getByTestId(`tables-period-option-year-${year}`));
};

const YEAR = new Date().getFullYear();

describe('the Tables route on the real RootNavigator', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockLayout.mode = 'single';
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
    expect(rendered.getByTestId('tables-period')).toHaveTextContent('Last 12 months', {
      exact: false,
    });
  });

  it('opens from the button on the Statistics screen that is the Home companion', async () => {
    mockLayout.mode = 'columns';
    const rendered = await renderRoot();

    await fireEvent.press(rendered.getByTestId(BUTTON));

    expect(tablesRouteOf('HomeTab')).toBeDefined();
    expect(rendered.getByTestId('tables-period')).toBeTruthy();
  });

  it('keeps a picked year from one pane to two and back', async () => {
    const rendered = await renderRoot();

    await goToTab('StatisticsTab');
    await fireEvent.press(rendered.getByTestId(BUTTON));
    await pickYear(rendered, YEAR);

    expect(rendered.getByTestId('tables-period')).toHaveTextContent(String(YEAR), { exact: false });

    await setLayout('columns');

    expect(tablesRouteOf('StatisticsTab')?.params?.period).toEqual({ kind: 'year', year: YEAR });
    expect(rendered.getByTestId('tables-period')).toHaveTextContent(String(YEAR), { exact: false });

    await setLayout('single');

    expect(rendered.getByTestId('tables-period')).toHaveTextContent(String(YEAR), { exact: false });
  });

  it('opens a new push on the last 12 months after the screen was popped', async () => {
    const rendered = await renderRoot();

    await goToTab('StatisticsTab');
    await fireEvent.press(rendered.getByTestId(BUTTON));
    await pickYear(rendered, YEAR);

    await act(async () => {
      navigationRef.goBack();
    });

    expect(tablesRouteOf('StatisticsTab')).toBeUndefined();

    await fireEvent.press(rendered.getByTestId(BUTTON));

    expect(tablesRouteOf('StatisticsTab')?.params?.period).toBeUndefined();
    expect(rendered.getByTestId('tables-period')).toHaveTextContent('Last 12 months', {
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
