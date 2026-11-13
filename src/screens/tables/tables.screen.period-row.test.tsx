import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { StyleSheet } from 'react-native';
import { darkTheme } from '@kiko/design-system/theme';
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
const CONTROLS_AND_SPACER = /^tables-(period|account-filter|category-filter|filter-bar-spacer)$/;

type Rendered = Awaited<ReturnType<typeof renderTables>>;

const idsInFilterBar = (rendered: Rendered): string[] =>
  within(rendered.getByTestId('tables-filter-bar'))
    .getAllByTestId(CONTROLS)
    .map((control) => control.props.testID);

const idsAndSpacerInFilterBar = (rendered: Rendered): string[] =>
  within(rendered.getByTestId('tables-filter-bar'))
    .getAllByTestId(CONTROLS_AND_SPACER)
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

    it('pushes the account and category filters to the trailing end behind a growing spacer', async () => {
      const rendered = await renderTables();

      expect(idsAndSpacerInFilterBar(rendered)).toEqual([
        'tables-period',
        'tables-filter-bar-spacer',
        'tables-account-filter',
        'tables-category-filter',
      ]);
      expect(rendered.getByTestId('tables-filter-bar-spacer')).toHaveStyle({ flexGrow: 1 });
    });

    it('pushes the one filter of a view without a category filter behind the spacer', async () => {
      const rendered = await renderTables({ view: 'cashFlow' });

      expect(idsAndSpacerInFilterBar(rendered)).toEqual([
        'tables-period',
        'tables-filter-bar-spacer',
        'tables-account-filter',
      ]);
    });

    it('keeps the least distance from the period to the account filter at one gap', async () => {
      const { getByTestId } = await renderTables();
      const gap = StyleSheet.flatten(getByTestId('tables-filter-bar').props.style).gap;
      const spacerMargin = StyleSheet.flatten(
        getByTestId('tables-filter-bar-spacer').props.style,
      ).marginStart;

      // The spacer is a flex item, so the bar's gap lands on both of its sides: a negative start
      // margin of one gap takes the first of them back.
      expect(gap).toBeGreaterThan(0);
      expect(spacerMargin).toBe(-gap);
    });

    it('centres the period pill and the filters on one line', async () => {
      const { getByTestId } = await renderTables();
      const flatten = (testID: string) => StyleSheet.flatten(getByTestId(testID).props.style);

      // No pill sets `alignSelf`, so each one takes the bar's centre.
      expect(flatten('tables-period').alignSelf).toBeUndefined();
      expect(flatten('tables-account-filter').alignSelf).toBeUndefined();
      expect(flatten('tables-filter-bar').alignItems).toBe('center');
    });

    it('draws the period as a pill as tall as the filters', async () => {
      const { getByTestId } = await renderTables();
      const minHeightOf = (testID: string) =>
        StyleSheet.flatten(getByTestId(testID).props.style).minHeight;

      expect(minHeightOf('tables-period')).toBe(darkTheme.layout.filterPillHeight);
      expect(minHeightOf('tables-period')).toBe(minHeightOf('tables-account-filter'));
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
      expect(rendered.queryByTestId('tables-filter-bar-spacer')).toBeNull();
    });
  });
});
