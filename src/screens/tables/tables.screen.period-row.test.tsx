import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { SETTLE_DELAY_MS } from '@kiko/navigation/pane-stack';
import { relativeTablePeriodsOf } from '@kiko/statistics/table-period';
import { act, fireEvent, within } from '@testing-library/react-native';
import { reportWindow, resizeWindow } from '@kiko/test-support/window-size';
import { FILTER_DATA_CLOCK } from '@kiko/test-support/statistics-filter-data';
import { pickTablesPeriod } from '@kiko/test-support/tables-period-selection';
import type { HorizontalSizeClass, VerticalBarEdge } from '@kiko/display-regions';

import { renderTables, setUpTablesWorld } from './__fixtures__/tables-screen-world';

jest.mock('@kiko/navigation/pane-stack', () =>
  (
    require('@kiko/test-support/mock-pane-stack') as typeof import('@kiko/test-support/mock-pane-stack')
  ).paneStackModule(() => jest.fn(), { useIsScreenVisible: () => true }),
);
jest.mock('@react-navigation/native-stack', () =>
  (
    require('@kiko/test-support/mock-header-height') as typeof import('@kiko/test-support/mock-header-height')
  ).nativeStackModule(),
);

const { thisQuarter: THIS_QUARTER } = relativeTablePeriodsOf(FILTER_DATA_CLOCK);

const CONTROLS = /^tables-(period|account-filter|category-filter)$/;

type Rendered = Awaited<ReturnType<typeof renderTables>>;

const idsInFilterBar = (rendered: Rendered): string[] =>
  within(rendered.getByTestId('tables-filter-bar'))
    .getAllByTestId(CONTROLS)
    .map((control) => control.props.testID);

describe('the period field on the Tables screen', () => {
  setUpTablesWorld();

  beforeEach(() => {
    reportWindow('compact', 393, 852);
  });

  describe('beside a side bar on a window wide enough for two panes (the Duo unfolded, landscape)', () => {
    beforeEach(() => {
      reportWindow('regular', 951, 669, 'trailing');
    });

    it('is the first item of the row of the other filters', async () => {
      const rendered = await renderTables();

      expect(idsInFilterBar(rendered)).toEqual([
        'tables-period',
        'tables-account-filter',
        'tables-category-filter',
      ]);
    });

    it('is first before the one filter of a view without a category filter', async () => {
      const rendered = await renderTables({ view: 'cashFlow' });

      expect(idsInFilterBar(rendered)).toEqual(['tables-period', 'tables-account-filter']);
    });

    it('is on screen once, not repeated in a row of its own', async () => {
      const { getAllByTestId } = await renderTables();

      expect(getAllByTestId('tables-period')).toHaveLength(1);
    });

    it('keeps the period and an open filter sheet when the Duo unfolded turns to portrait', async () => {
      await pickTablesPeriod(THIS_QUARTER);

      const rendered = await renderTables();
      const { getByTestId, queryAllByTestId } = rendered;

      await act(async () => {
        await fireEvent.press(getByTestId('tables-account-filter'));
      });

      const optionsBefore = queryAllByTestId(/^tables-account-filter-option-/).length;

      await resizeWindow(669, 951);
      await act(async () => {
        jest.advanceTimersByTime(SETTLE_DELAY_MS);
      });

      expect(optionsBefore).toBeGreaterThan(0);
      expect(queryAllByTestId(/^tables-account-filter-option-/)).toHaveLength(optionsBefore);
      expect(getByTestId('tables-period')).toHaveTextContent(i18n.t('tables.period.thisQuarter'), {
        exact: false,
      });
      expect(idsInFilterBar(rendered)).toEqual(['tables-account-filter', 'tables-category-filter']);
    });
  });

  describe('through a pose change that reports one frame of another mode', () => {
    beforeEach(() => {
      reportWindow('regular', 951, 669, 'trailing');
    });

    it('keeps an open Period sheet open through a one-frame change to one page', async () => {
      const rendered = await renderTables();
      const { getByTestId, queryAllByTestId } = rendered;

      await act(async () => {
        await fireEvent.press(getByTestId('tables-period'));
      });

      const optionsBefore = queryAllByTestId(/^tables-period-option-/).length;

      await resizeWindow(669, 951);
      await resizeWindow(951, 669);
      await act(async () => {
        jest.advanceTimersByTime(SETTLE_DELAY_MS);
      });

      expect(optionsBefore).toBeGreaterThan(0);
      expect(queryAllByTestId(/^tables-period-option-/)).toHaveLength(optionsBefore);
      expect(idsInFilterBar(rendered)).toContain('tables-period');
    });
  });

  describe.each<[string, HorizontalSizeClass, number, number, VerticalBarEdge]>([
    ['an iPhone in portrait', 'compact', 393, 852, 'none'],
    ['an iPhone in landscape', 'compact', 852, 393, 'none'],
    ['the Duo folded, its side bar on a narrow page', 'compact', 466, 678, 'trailing'],
    ['the Duo unfolded in portrait, its bar at the bottom', 'regular', 669, 951, 'none'],
    ['an iPad in landscape, its bar at the top', 'regular', 1376, 1032, 'none'],
  ])('on %s', (_name, sizeClass, width, height, verticalBarEdge) => {
    beforeEach(() => {
      reportWindow(sizeClass, width, height, verticalBarEdge);
    });

    it("stays out of the row of the other filters, in the table's top", async () => {
      const rendered = await renderTables();
      const top = within(rendered.getByTestId('category-table-top'));

      expect(idsInFilterBar(rendered)).toEqual(['tables-account-filter', 'tables-category-filter']);
      expect(top.getByTestId('tables-period')).toBeTruthy();
    });
  });
});
