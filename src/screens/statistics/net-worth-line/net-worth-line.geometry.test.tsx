import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import '@kiko/design-system/unistyles';

import NetWorthLine from './index';

const VIEW_WIDTH = 320;
const PADDING_X = 8;
const HEIGHT = 180;

const points = [
  { t: 1_700_000_000_000, amount: 100 },
  { t: 1_700_086_400_000, amount: 300 },
  { t: 1_700_172_800_000, amount: 200 },
];

const renderLine = () =>
  render(<NetWorthLine points={points} startReference={50} baseCurrency="USD" height={HEIGHT} />, {
    wrapper: GestureRootWrapper,
  });

describe('NetWorthLine plot geometry', () => {
  it('lets the plot fill the remaining width at the requested height', async () => {
    const { getByTestId } = await renderLine();

    expect(StyleSheet.flatten(getByTestId('net-worth-line-plot').props.style)).toEqual({
      flex: 1,
      height: HEIGHT,
    });
  });

  it('maps the logical width onto the plot with a viewBox as wide as the chart', async () => {
    const { getByTestId } = await renderLine();
    const [svg] = getByTestId('net-worth-line-plot').children;

    expect(typeof svg === 'object' && svg.props.viewBox).toBe(`0 0 ${VIEW_WIDTH} ${HEIGHT}`);
  });

  it('insets the grid lines, the x-axis and the reference line by the horizontal padding', async () => {
    const { getByTestId } = await renderLine();

    ['net-worth-line-y-grid-0.3333', 'net-worth-line-x-axis', 'net-worth-line-reference'].forEach(
      (testID) => {
        const line = getByTestId(testID).props;

        expect(line.x1).toBe(PADDING_X);
        expect(line.x2).toBe(VIEW_WIDTH - PADDING_X);
      },
    );
  });
});
