import '@kiko/i18n/init';
import '@kiko/design-system/unistyles';
import { StyleSheet, View } from 'react-native';
import {
  ACCOUNT_FILTER,
  answerFilterData,
  CATEGORY_FILTER,
  pressFilterOption,
} from '@kiko/test-support/statistics-filter-data';
import { darkTheme } from '@kiko/design-system/theme';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { act, fireEvent, render, within } from '@testing-library/react-native';
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

  describe('the pills at their defaults', () => {
    it('keeps the date range pill inactive on a fresh mount, since nothing was picked', async () => {
      const rendered = await render(<StatisticsScreen />, { wrapper: GestureRootWrapper });
      const style = StyleSheet.flatten(rendered.getByLabelText('Date range').props.style);

      expect(style.backgroundColor).toBe(darkTheme.colors.surface);
      expect(style.borderColor).toBe(darkTheme.colors.border);
    });

    it.each([
      ['keeps the date range pill inactive when Apply is pressed on the unchanged default', false],
      ['tints the date range pill once Apply is pressed on a changed range', true],
    ] as const)('%s', async (_title, picks) => {
      const rendered = await render(<StatisticsScreen />, { wrapper: GestureRootWrapper });

      await act(async () => {
        await fireEvent.press(rendered.getByLabelText('Date range'));
      });

      if (picks) {
        const today = new Date();
        const calendar = rendered.getByTestId('date-range-calendar').props as {
          onDayPress: (day: unknown) => void;
        };

        await act(async () => {
          calendar.onDayPress({
            year: today.getFullYear(),
            month: today.getMonth() + 1,
            day: today.getDate(),
          });
        });
      }

      await act(async () => {
        await fireEvent.press(rendered.getByText('Apply'));
      });

      const style = StyleSheet.flatten(rendered.getByLabelText('Date range').props.style);
      const tint = picks ? 'accentSubtle' : 'surface';

      expect(style.backgroundColor).toBe(darkTheme.colors[tint]);
    });

    it('keeps the trend pill inactive while no trend filter is saved', async () => {
      const rendered = await render(<StatisticsScreen />, { wrapper: GestureRootWrapper });
      const style = StyleSheet.flatten(rendered.getByTestId('statistics-trend-filter').props.style);

      expect(style.backgroundColor).toBe(darkTheme.colors.surface);
      expect(style.borderColor).toBe(darkTheme.colors.border);
    });
  });

  it('keeps the two filters independent of each other', async () => {
    const rendered = await renderBoth();

    await pressIn(rendered, 'tab-pane', ACCOUNT_FILTER, 'a');

    expect(pane(rendered, 'companion-pane').queryByText(/^Categories · /)).toBeNull();
  });
});
