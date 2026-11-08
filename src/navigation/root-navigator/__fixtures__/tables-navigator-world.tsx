import {
  createNavigationContainerRef,
  NavigationContainer,
  type ParamListBase,
} from '@react-navigation/native';
import { SETTLE_DELAY_MS } from '@kiko/navigation/pane-stack';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { FILTER_DATA_CLOCK } from '@kiko/test-support/statistics-filter-data';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { relativeTablePeriodsOf, tablePeriodKey } from '@kiko/statistics/table-period';

import RootNavigator from '../root.navigator';

import { layout } from './mock-layout';

export const navigationRef = createNavigationContainerRef<ParamListBase>();

export const renderRoot = async () => {
  const rendered = await render(
    <NavigationContainer ref={navigationRef}>
      <RootNavigator />
    </NavigationContainer>,
    { wrapper: GestureRootWrapper },
  );

  await waitFor(() => expect(navigationRef.isReady()).toBe(true));

  return rendered;
};

export const goToTab = async (tab: string): Promise<void> => {
  await act(async () => {
    navigationRef.navigate(tab);
  });
};

export const setLayout = async (mode: 'single' | 'columns'): Promise<void> => {
  await act(async () => {
    layout.mode = mode;

    for (const listener of layout.listeners) {
      listener();
    }
  });
  await act(async () => {
    jest.advanceTimersByTime(SETTLE_DELAY_MS);
  });
};

// This quarter is on offer for any data, and it is not the default period.
const { thisQuarter: THIS_QUARTER } = relativeTablePeriodsOf(FILTER_DATA_CLOCK);

export const pickThisQuarter = async (rendered: Awaited<ReturnType<typeof renderRoot>>) => {
  await fireEvent.press(rendered.getByTestId('tables-period'));
  await fireEvent.press(
    rendered.getByTestId(`tables-period-option-${tablePeriodKey(THIS_QUARTER)}`),
  );
};
