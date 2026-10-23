import { Money } from '@kiko/currency/money';
import { StyleSheet, View } from 'react-native';
import { darkTheme } from '@kiko/design-system/theme';
import { render } from '@testing-library/react-native';
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';

import '@kiko/design-system/unistyles';

import PieChart from '../pie-chart';

import StatisticsGrid from '.';
import { isChartRowShared, SHARED_ROW_MINIMUM_CONTENT_WIDTH } from './chart-rows';

// The name label's room is a design budget, not a style: about two words of the body text.
const NAME_LABEL_WIDTH = 80;
// Card.padding and Screen content padding are both `spacing(4)` a side.
const PADDING_UNITS = 4;

const numberStyle = (element: { props: { style?: unknown } }, property: string): number => {
  const value = (StyleSheet.flatten(element.props.style as object) as Record<string, unknown>)[
    property
  ];

  if (typeof value !== 'number') {
    throw new Error(`Expected a numeric "${property}" style.`);
  }

  return value;
};

const renderedLegendWidth = async () => {
  const { getByTestId } = await render(
    <PieChart
      slices={[{ accountId: 'a1', name: 'Cash', amount: 100_00, share: 1, color: '#FF375F' }]}
      baseCurrency="USD"
      centerTotal={Money.of('USD', 100_00)}
    />,
  );
  const legendRow = getByTestId('pie-chart-legend-a1');
  const nameColumn = ancestorWithStyle(getByTestId('pie-chart-swatch-a1'), 'gap');
  const donutWidth = numberStyle(getByTestId('pie-chart-center-total'), 'width');
  const fixedWidth =
    numberStyle(getByTestId('pie-chart-legend-value-a1'), 'width') +
    numberStyle(getByTestId('pie-chart-legend-percent-a1'), 'width') +
    2 * numberStyle(legendRow, 'columnGap') +
    numberStyle(getByTestId('pie-chart-swatch-a1'), 'width') +
    numberStyle(nameColumn, 'gap');

  return { donutWidth, fixedWidth };
};

const renderedRowGap = async () => {
  const { getByTestId } = await render(
    <StatisticsGrid
      isRowShared
      fullWidth={[]}
      shared={[<View key="category" />, <View key="pie" />]}
    />,
  );

  return numberStyle(getByTestId('statistics-grid-row'), 'gap');
};

describe('isChartRowShared', () => {
  it('derives the shared-row width from the pie legend so a name keeps its room', async () => {
    const { donutWidth, fixedWidth } = await renderedLegendWidth();
    const cardPadding = 2 * darkTheme.spacing(PADDING_UNITS);
    const screenPadding = 2 * darkTheme.spacing(PADDING_UNITS);
    const cardWidth = fixedWidth + NAME_LABEL_WIDTH + cardPadding;
    const derivedMinimumContentWidth = 2 * cardWidth + screenPadding + (await renderedRowGap());

    expect(donutWidth).toBeLessThan(fixedWidth + NAME_LABEL_WIDTH);
    expect(fixedWidth).toBe(192);
    expect(derivedMinimumContentWidth).toBe(656);
    expect(SHARED_ROW_MINIMUM_CONTENT_WIDTH).toBe(derivedMinimumContentWidth);
  });

  it.each([
    ['half of an iPad mini portrait window', 371.5, false],
    ['a pane that fits the columns but not a name', 480, false],
    ['half of a split-view window', 515.5, false],
    ['a pane under the shared-row width', 597, false],
    ['one point below the shared-row width', 655, false],
    ['the shared-row width', 656, true],
    ['half of a 13-inch landscape window', 687.5, true],
    ['a wide pane', 688, true],
  ])('on a large window, %s (%d) shares the row: %s', (_name, paneWidth, expected) => {
    expect(isChartRowShared(true, paneWidth)).toBe(expected);
  });

  it.each([
    ['the shared-row width', 656],
    ['half of a split-view window', 515.5],
    ['a wide pane', 688],
    ['a narrow pane', 371.5],
  ])('never shares the row on a window that is not large, at %s (%d)', (_name, paneWidth) => {
    expect(isChartRowShared(false, paneWidth)).toBe(false);
  });

  it.each([true, false])('does not share the row without a pane width (large: %s)', (isLarge) => {
    expect(isChartRowShared(isLarge, null)).toBe(false);
  });
});
