import { render } from '@testing-library/react-native';
import type { NetWorthPoint } from '../../../statistics/net-worth-series';
import { darkTheme } from '../../theme';
import '../../unistyles';
import NetWorthLine from './index';

// Flatten a (possibly nested/array) style prop into its plain object layers so a
// test can assert a single directive regardless of how Unistyles composed it.
const styleLayers = (style: unknown): Record<string, unknown>[] =>
  (Array.isArray(style) ? style.flat(Number.POSITIVE_INFINITY) : [style]).filter(
    (layer): layer is Record<string, unknown> => layer != null && typeof layer === 'object',
  );

const points: NetWorthPoint[] = [
  { t: 0, amount: 100 },
  { t: 86_400_000, amount: 300 },
  { t: 172_800_000, amount: 200 },
];

describe('NetWorthLine', () => {
  it('renders a single polyline with one coordinate pair per point', async () => {
    const { getByTestId } = await render(
      <NetWorthLine points={points} startReference={200} baseCurrency="USD" />,
    );

    const raw: string = getByTestId('net-worth-line-polyline').props.points;
    const pairs = raw.trim().split(' ');
    expect(pairs).toHaveLength(points.length);
    for (const pair of pairs) {
      expect(pair).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
    }
  });

  it('renders a dashed reference line at the start-reference value', async () => {
    const height = 200;
    const { getByTestId } = await render(
      <NetWorthLine points={points} startReference={200} baseCurrency="USD" height={height} />,
    );

    const reference = getByTestId('net-worth-line-reference');
    expect(reference.props.strokeDasharray).toBeTruthy();
    // The reference is horizontal.
    expect(reference.props.y1).toBe(reference.props.y2);
    // With min=100, max=300, a reference of 200 (the midpoint) sits at the
    // vertical centre of the plot regardless of symmetric padding.
    expect(reference.props.y1).toBeCloseTo(height / 2);
  });

  it('renders about four Y-axis tick labels spanning the value range', async () => {
    const { getByTestId, getByText } = await render(
      <NetWorthLine points={points} startReference={200} baseCurrency="USD" />,
    );

    expect(getByTestId('net-worth-line-tick-0')).toBeTruthy();
    expect(getByTestId('net-worth-line-tick-3')).toBeTruthy();
    expect(getByText(/\$300\.00/)).toBeTruthy();
    expect(getByText(/\$100\.00/)).toBeTruthy();
  });

  it('draws the net-worth line in white', async () => {
    const { getByTestId } = await render(
      <NetWorthLine points={points} startReference={200} baseCurrency="USD" />,
    );

    expect(getByTestId('net-worth-line-polyline').props.stroke).toBe(
      darkTheme.colors.entityColors.white,
    );
  });

  it('reserves a fixed-width Y-axis column so its value labels are fully visible', async () => {
    const { getByTestId } = await render(
      <NetWorthLine points={points} startReference={200} baseCurrency="USD" />,
    );

    const width = styleLayers(getByTestId('net-worth-line-y-axis').props.style)
      .map((layer) => layer.width)
      .find((value): value is number => typeof value === 'number');

    expect(width).toBeGreaterThan(0);
  });

  it('renders a loading state when loading with no points yet', async () => {
    const { getByTestId, queryByTestId } = await render(
      <NetWorthLine points={[]} startReference={0} baseCurrency="USD" loading />,
    );

    expect(getByTestId('net-worth-line-loading')).toBeTruthy();
    expect(queryByTestId('net-worth-line-polyline')).toBeNull();
  });

  it('renders an empty state when there are no points and not loading', async () => {
    const { getByTestId, queryByTestId } = await render(
      <NetWorthLine points={[]} startReference={0} baseCurrency="USD" />,
    );

    expect(getByTestId('net-worth-line-empty')).toBeTruthy();
    expect(queryByTestId('net-worth-line-polyline')).toBeNull();
  });
});
