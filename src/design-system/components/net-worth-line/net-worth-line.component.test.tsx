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
    // Sub-thousand extremes render in the compact base unit (grouped integer,
    // no suffix), not the full two-decimal money format.
    expect(getByText('$300')).toBeTruthy();
    expect(getByText('$100')).toBeTruthy();
  });

  it('labels the Y-axis in a compact unit chosen from the spread — grouped thousands when values are close together', async () => {
    // A narrow ~1.2M–1.3M band: at millions with one decimal the ticks would
    // collide (1.3M, 1.3M, 1.2M, 1.2M), so the axis drops to grouped thousands
    // where every label stays distinct.
    const closePoints: NetWorthPoint[] = [
      { t: 0, amount: 1_200_000 },
      { t: 86_400_000, amount: 1_300_000 },
    ];
    const { getByText } = await render(
      <NetWorthLine points={closePoints} startReference={1_250_000} baseCurrency="USD" />,
    );

    expect(getByText('$1,300K')).toBeTruthy();
    expect(getByText('$1,200K')).toBeTruthy();
  });

  it('labels the Y-axis in millions when the values are far apart', async () => {
    const farPoints: NetWorthPoint[] = [
      { t: 0, amount: 200_000 },
      { t: 86_400_000, amount: 1_500_000 },
    ];
    const { getByText } = await render(
      <NetWorthLine points={farPoints} startReference={800_000} baseCurrency="USD" />,
    );

    expect(getByText('$1.5M')).toBeTruthy();
    expect(getByText('$0.2M')).toBeTruthy();
  });

  it('offsets the X-axis label row past the Y-axis column so the dates line up with the plot (G5)', async () => {
    const { getByTestId } = await render(
      <NetWorthLine points={points} startReference={200} baseCurrency="USD" />,
    );

    const yAxisWidth = styleLayers(getByTestId('net-worth-line-y-axis').props.style)
      .map((layer) => layer.width)
      .find((value): value is number => typeof value === 'number');
    const xAxisMargin = styleLayers(getByTestId('net-worth-line-x-axis-labels').props.style)
      .map((layer) => layer.marginLeft)
      .find((value): value is number => typeof value === 'number');

    // The label row starts at the plot's left edge: the Y-axis column width plus
    // the column gap between the axis and the plot.
    expect(yAxisWidth).toBeGreaterThan(0);
    expect(xAxisMargin).toBe((yAxisWidth ?? 0) + darkTheme.spacing(2));
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
