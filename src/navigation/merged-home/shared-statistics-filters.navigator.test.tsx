import type { FC } from 'react';
import {
  createNavigationContainerRef,
  createNavigatorFactory,
  NavigationContainer,
  type ParamListBase,
} from '@react-navigation/native';
import { View } from 'react-native';
import {
  ACCOUNT_FILTER,
  answerFilterData,
  CATEGORY_FILTER,
  pressFilterOption,
} from '@kiko/test-support/statistics-filter-data';
import LazyTabs from '@kiko/test-support/lazy-tabs';
import { act, render, within } from '@testing-library/react-native';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { reportWindow, resizeWindow } from '@kiko/test-support/window-size';
import { mockUseLiveQuery } from '@kiko/test-support/mock-statistics-data-layer';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import HomeStack from '../home-stack';
import { SETTLE_DELAY_MS } from '../pane-stack';
import StatisticsStack from '../statistics-stack';

/**
 * The Statistics tab and the Home companion are two Statistics screens, so a filter picked on the
 * tab must be the one the companion shows once the window turns large and the tab is left.
 * Real Home and Statistics screens on the real stacks, with the data layer mocked down to what
 * they need to mount.
 */

const Tabs = createNavigatorFactory(LazyTabs)();
const navigationRef = createNavigationContainerRef<ParamListBase>();

const AccountsStub: FC = () => <View />;

type Rendered = Awaited<ReturnType<typeof render>>;

const renderStatisticsTab = (): ReturnType<typeof render> =>
  render(
    <NavigationContainer ref={navigationRef}>
      <Tabs.Navigator initialRouteName="StatisticsTab">
        <Tabs.Screen name="HomeTab" component={HomeStack} />

        <Tabs.Screen name="AccountsTab" component={AccountsStub} />

        <Tabs.Screen name="StatisticsTab" component={StatisticsStack} />
      </Tabs.Navigator>
    </NavigationContainer>,
    { wrapper: GestureRootWrapper },
  );

const focusedTab = (): string | undefined => {
  const state = navigationRef.getRootState();

  return state?.routes[state.index]?.name;
};

const becomeLarge = async (): Promise<void> => {
  await resizeWindow(1376, 1032);
  await act(async () => {
    jest.advanceTimersByTime(SETTLE_DELAY_MS);
  });
};

// The Statistics tab is hidden once left, so the menus a query finds are the companion's.
const expectEveryMenuShows = (rendered: Rendered, testID: string, label: string): void => {
  const menus = rendered.getAllByTestId(testID);

  expect(rendered.getByTestId('home-content')).toBeTruthy();

  for (const menu of menus) {
    expect(within(menu).queryByText(label)).toBeTruthy();
  }
};

describe('the Statistics filters when the window turns into a merged Home', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    reportWindow('regular', 1032, 683);
    mockUseLiveQuery.mockImplementation(answerFilterData);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the account filter picked on the Statistics tab in the Home companion', async () => {
    const rendered = await renderStatisticsTab();

    await pressFilterOption(rendered.getByTestId, ACCOUNT_FILTER, 'a');

    expect(within(rendered.getByTestId(ACCOUNT_FILTER)).getByText('Accounts · 1')).toBeTruthy();

    await becomeLarge();

    expect(focusedTab()).toBe('HomeTab');
    expectEveryMenuShows(rendered, ACCOUNT_FILTER, 'Accounts · 1');
  });

  it('shows the category filter picked on the Statistics tab in the Home companion', async () => {
    const rendered = await renderStatisticsTab();

    await pressFilterOption(rendered.getByTestId, CATEGORY_FILTER, 'groceries');

    expect(within(rendered.getByTestId(CATEGORY_FILTER)).getByText('Categories · 1')).toBeTruthy();

    await becomeLarge();

    expect(focusedTab()).toBe('HomeTab');
    expectEveryMenuShows(rendered, CATEGORY_FILTER, 'Categories · 1');
  });

  it('shows both filters together in the Home companion', async () => {
    const rendered = await renderStatisticsTab();

    await pressFilterOption(rendered.getByTestId, ACCOUNT_FILTER, 'b');
    await pressFilterOption(rendered.getByTestId, CATEGORY_FILTER, 'transport');
    await becomeLarge();

    expectEveryMenuShows(rendered, ACCOUNT_FILTER, 'Accounts · 1');
    expectEveryMenuShows(rendered, CATEGORY_FILTER, 'Categories · 1');
  });
});
