import '@kiko/i18n/init';
import { View } from 'react-native';
import '@kiko/design-system/unistyles';
import {
  ACCOUNT_FILTER,
  answerFilterData,
  CATEGORY_FILTER,
  pressFilterOption,
} from '@kiko/test-support/statistics-filter-data';
import { render, within } from '@testing-library/react-native';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { mockUseLiveQuery } from '@kiko/test-support/mock-statistics-data-layer';
import { resetStatisticsFilterSelection } from '@kiko/test-support/reset-statistics-filter-selection';

import StatisticsScreen from './statistics.screen';

/**
 * Two Statistics screens mounted at once (the Statistics tab's and the Home companion's) read ONE
 * account selection and ONE category selection, like the shared date range: a pick made in one
 * shows in the other, and the pick outlives every screen for the app session.
 */

jest.mock('@kiko/navigation/pane-stack', () => ({ useIsScreenVisible: () => true }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => false,
  useNavigation: () => ({ navigate: jest.fn() }),
}));

const bothScreens = () => (
  <>
    <View testID="tab-pane">
      <StatisticsScreen />
    </View>
    <View testID="companion-pane">
      <StatisticsScreen />
    </View>
  </>
);

const renderBoth = (): ReturnType<typeof render> =>
  render(bothScreens(), { wrapper: GestureRootWrapper });

type Rendered = Awaited<ReturnType<typeof render>>;

const pane = (rendered: Rendered, testID: string) => within(rendered.getByTestId(testID));

const pressIn = (rendered: Rendered, testID: string, menu: string, value: string) =>
  pressFilterOption(pane(rendered, testID).getByTestId, menu, value);

const expectBothShow = (rendered: Rendered, label: string): void => {
  expect(pane(rendered, 'tab-pane').queryByText(label)).toBeTruthy();
  expect(pane(rendered, 'companion-pane').queryByText(label)).toBeTruthy();
};

describe('shared Statistics filters across two Statistics screens', () => {
  beforeEach(() => {
    mockUseLiveQuery.mockImplementation(answerFilterData);
  });

  afterEach(resetStatisticsFilterSelection);

  describe('the account filter', () => {
    it('shows an account picked in the first screen in the second too', async () => {
      const rendered = await renderBoth();

      await pressIn(rendered, 'tab-pane', ACCOUNT_FILTER, 'a');

      expectBothShow(rendered, 'Accounts · 1');
    });

    it('shows an account picked in the second screen in the first too', async () => {
      const rendered = await renderBoth();

      await pressIn(rendered, 'companion-pane', ACCOUNT_FILTER, 'b');

      expectBothShow(rendered, 'Accounts · 1');
    });

    it('clears in both screens when the pick is toggled off in either', async () => {
      const rendered = await renderBoth();

      await pressIn(rendered, 'tab-pane', ACCOUNT_FILTER, 'a');
      await pressIn(rendered, 'companion-pane', ACCOUNT_FILTER, 'a');

      expect(pane(rendered, 'tab-pane').queryByText(/^Accounts · /)).toBeNull();
      expect(pane(rendered, 'companion-pane').queryByText(/^Accounts · /)).toBeNull();
    });

    it('keeps the account pick after both screens unmount and mount again', async () => {
      const first = await renderBoth();

      await pressIn(first, 'tab-pane', ACCOUNT_FILTER, 'a');
      await first.unmount();

      const second = await renderBoth();

      expectBothShow(second, 'Accounts · 1');
    });
  });

  describe('the category filter', () => {
    it('shows a category picked in the first screen in the second too', async () => {
      const rendered = await renderBoth();

      await pressIn(rendered, 'tab-pane', CATEGORY_FILTER, 'groceries');

      expectBothShow(rendered, 'Categories · 1');
    });

    it('shows a category picked in the second screen in the first too', async () => {
      const rendered = await renderBoth();

      await pressIn(rendered, 'companion-pane', CATEGORY_FILTER, 'transport');

      expectBothShow(rendered, 'Categories · 1');
    });

    it('keeps the category pick after both screens unmount and mount again', async () => {
      const first = await renderBoth();

      await pressIn(first, 'tab-pane', CATEGORY_FILTER, 'groceries');
      await first.unmount();

      const second = await renderBoth();

      expectBothShow(second, 'Categories · 1');
    });
  });

  it('keeps the two filters independent of each other', async () => {
    const rendered = await renderBoth();

    await pressIn(rendered, 'tab-pane', ACCOUNT_FILTER, 'a');

    expect(pane(rendered, 'companion-pane').queryByText(/^Categories · /)).toBeNull();
  });
});
