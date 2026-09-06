import { act, render } from '@testing-library/react-native';

import { i18n } from '../../../i18n';
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
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('re-formats a UAH Y-axis label when the active language changes (en-US comma grouping -> uk-UA space grouping)', async () => {
    // Clean, evenly-spaced amounts so the four Y-axis ticks (1236, 1224, 1212,
    // 1200) land on distinct grouped-thousands values in the base compact
    // unit — see currency/compact.ts's chooseCompactUnit: a K-unit label here
    // would collapse every tick to "1", so it steps down to the base unit,
    // which is exactly the grouped integer this test needs.
    const uahPoints: NetWorthPoint[] = [
      { t: 0, amount: 1200 },
      { t: 86_400_000, amount: 1236 },
    ];
    const { getByText, queryByText } = await render(
      <NetWorthLine points={uahPoints} startReference={1218} baseCurrency="UAH" />,
    );

    expect(getByText('1,236 ₴')).toBeTruthy();

    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    // uk-UA groups thousands with U+00A0 NO-BREAK SPACE (see
    // currency/compact.test.ts for the same finding on formatCompactMoney).
    expect(queryByText('1,236 ₴')).toBeNull();
    expect(getByText('1 236 ₴')).toBeTruthy();
  });

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

  it('offsets the X-axis label track past the Y-axis column so the dates line up with the plot (G5)', async () => {
    const { getByTestId } = await render(
      <NetWorthLine points={points} startReference={200} baseCurrency="USD" />,
    );

    const yAxisWidth = styleLayers(getByTestId('net-worth-line-y-axis').props.style)
      .map((layer) => layer.width)
      .find((value): value is number => typeof value === 'number');
    // The label row mirrors the plot row: a spacer exactly the Y-axis column's
    // width, then a column gap, then the flex:1 track — so the track starts at the
    // plot's left edge instead of being pushed over by a bare marginLeft (which
    // gave the absolute labels no definite width to resolve their percent against).
    const spacerWidth = styleLayers(getByTestId('net-worth-line-x-axis-spacer').props.style)
      .map((layer) => layer.width)
      .find((value): value is number => typeof value === 'number');
    const rowGap = styleLayers(getByTestId('net-worth-line-x-axis-labels').props.style)
      .map((layer) => layer.columnGap)
      .find((value): value is number => typeof value === 'number');

    expect(yAxisWidth).toBeGreaterThan(0);
    expect(spacerWidth).toBe(yAxisWidth);
    expect(rowGap).toBe(darkTheme.spacing(2));
  });

  it('spreads the intermediate X-axis date labels across distinct horizontal positions', async () => {
    const { getByTestId } = await render(
      <NetWorthLine points={points} startReference={200} baseCurrency="USD" />,
    );

    // Each interior label is pinned under its own gridline by a percentage `left`
    // — the three must land at three DISTINCT positions, not collapse onto one x.
    const lefts = ['0.25', '0.50', '0.75'].map((key) => {
      const left = styleLayers(getByTestId(`net-worth-line-x-tick-${key}`).props.style)
        .map((layer) => layer.left)
        .find((value) => value !== undefined);

      return left;
    });

    expect(new Set(lefts).size).toBe(3);
    for (const left of lefts) {
      // A non-zero percentage string, so no interior label sits at the track's
      // left edge (the collapse this guards against rendered them all there).
      expect(typeof left).toBe('string');
      expect(left).toMatch(/%$/);
      expect(left).not.toBe('0%');
    }

    // The two range extremes stay flush to their own edges — start left, end
    // right — rather than both pinning to one side (the `leftPercent === 0` bug).
    const startStyle = styleLayers(getByTestId('net-worth-line-x-tick-0.00').props.style);
    const endStyle = styleLayers(getByTestId('net-worth-line-x-tick-1.00').props.style);
    expect(startStyle.map((layer) => layer.left).find((value) => value !== undefined)).toBe(0);
    expect(endStyle.map((layer) => layer.right).find((value) => value !== undefined)).toBe(0);
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

  it('labels the X axis at evenly spaced intermediate dates, not just the endpoints', async () => {
    const { getByTestId } = await render(
      <NetWorthLine points={points} startReference={200} baseCurrency="USD" />,
    );

    // Five ticks: the two range extremes plus three interior dates, so the axis
    // reads as a timeline rather than only its first/last dates.
    for (const key of ['0.00', '0.25', '0.50', '0.75', '1.00']) {
      expect(getByTestId(`net-worth-line-x-tick-${key}`)).toBeTruthy();
    }
  });

  it('drops a thin vertical gridline from each intermediate date to the plot', async () => {
    const { getByTestId, queryByTestId } = await render(
      <NetWorthLine points={points} startReference={200} baseCurrency="USD" />,
    );

    // The three interior dates each get a gridline; the two extremes ARE the
    // plot's own left/right edges, so they get no extra line.
    for (const key of ['0.25', '0.50', '0.75']) {
      const grid = getByTestId(`net-worth-line-x-grid-${key}`);
      // Vertical: one x, dropping from the plot's top down toward its baseline.
      expect(grid.props.x1).toBe(grid.props.x2);
      expect(grid.props.y1).toBeLessThan(grid.props.y2);
    }

    expect(queryByTestId('net-worth-line-x-grid-0.00')).toBeNull();
    expect(queryByTestId('net-worth-line-x-grid-1.00')).toBeNull();
  });

  it('collapses the X axis to a single date when every point shares one instant', async () => {
    // A single-instant range has no time span, so the evenly spaced ticks would
    // all stack on the same x — it falls back to one start-edge date label with
    // no interior gridlines.
    const onePoint: NetWorthPoint[] = [{ t: 172_800_000, amount: 200 }];
    const { getByTestId, queryByTestId } = await render(
      <NetWorthLine points={onePoint} startReference={200} baseCurrency="USD" />,
    );

    expect(getByTestId('net-worth-line-x-tick-0.00')).toBeTruthy();
    expect(queryByTestId('net-worth-line-x-tick-0.25')).toBeNull();
    expect(queryByTestId('net-worth-line-x-grid-0.25')).toBeNull();
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

  // Regression: the loading placeholder used to be a short spinner box that
  // grew ~135px once the loaded chart replaced it, jumping the Charts screen's
  // content height above the viewport mid-render and interrupting the OS's
  // native scroll-to-top (tapping the active tab). The placeholder must now
  // reserve the SAME total height the loaded chart occupies for a given plot
  // height, so no post-mount height change ever occurs.
  it('reserves the same total height in the loading state as the loaded chart', async () => {
    const height = 200;

    const { getByTestId: getByTestIdLoading } = await render(
      <NetWorthLine points={[]} startReference={0} baseCurrency="USD" loading height={height} />,
    );
    const loadingHeight = styleLayers(getByTestIdLoading('net-worth-line-loading').props.style)
      .map((layer) => layer.height)
      .find((value): value is number => typeof value === 'number');

    const { getByTestId: getByTestIdLoaded } = await render(
      <NetWorthLine points={points} startReference={200} baseCurrency="USD" height={height} />,
    );
    // The loaded chart's total footprint: the plot row's height, plus the
    // container's rowGap, plus the X-axis label row's height below it.
    const plotHeight = styleLayers(getByTestIdLoaded('net-worth-line-y-axis').props.style)
      .map((layer) => layer.height)
      .find((value): value is number => typeof value === 'number');
    const rowGap = styleLayers(getByTestIdLoaded('net-worth-line-x-axis-labels').props.style)
      .map((layer) => layer.columnGap)
      .find((value): value is number => typeof value === 'number');
    const xAxisTrackHeight = darkTheme.typography.caption.fontSize + darkTheme.spacing(1);
    const loadedTotalHeight = (plotHeight ?? 0) + (rowGap ?? 0) + xAxisTrackHeight;

    expect(loadingHeight).toBeGreaterThan(0);
    expect(loadingHeight).toBe(loadedTotalHeight);
  });

  it('reserves the same total height in the empty state as the loaded chart', async () => {
    const height = 200;

    const { getByTestId: getByTestIdEmpty } = await render(
      <NetWorthLine points={[]} startReference={0} baseCurrency="USD" height={height} />,
    );
    const emptyHeight = styleLayers(getByTestIdEmpty('net-worth-line-empty').props.style)
      .map((layer) => layer.height)
      .find((value): value is number => typeof value === 'number');

    const { getByTestId: getByTestIdLoading } = await render(
      <NetWorthLine points={[]} startReference={0} baseCurrency="USD" loading height={height} />,
    );
    const loadingHeight = styleLayers(getByTestIdLoading('net-worth-line-loading').props.style)
      .map((layer) => layer.height)
      .find((value): value is number => typeof value === 'number');

    expect(emptyHeight).toBe(loadingHeight);
  });
});
