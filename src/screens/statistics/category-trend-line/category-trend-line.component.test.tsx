import { render, within } from '@testing-library/react-native';

import type { CategoryTrendSeries } from '../../../statistics/category-trend';
import '../../../design-system/unistyles';
import CategoryTrendLine from './index';

const JAN = Date.UTC(2025, 0, 1);
const FEB = Date.UTC(2025, 1, 1);
const MAR = Date.UTC(2025, 2, 1);

const series: CategoryTrendSeries[] = [
  {
    key: 'groceries',
    title: 'Groceries',
    color: '#ff0000',
    points: [
      { t: JAN, amount: 30 },
      { t: FEB, amount: 0 },
      { t: MAR, amount: 10 },
    ],
  },
  {
    key: 'transport',
    title: 'Transport',
    color: '#00ff00',
    points: [
      { t: JAN, amount: 0 },
      { t: FEB, amount: 20 },
      { t: MAR, amount: 0 },
    ],
  },
];

// Parse a polyline's `points` prop into an array of [x, y] number pairs.
const pairsOf = (raw: string): [number, number][] =>
  raw
    .trim()
    .split(' ')
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);

      return [x, y] as [number, number];
    });

describe('CategoryTrendLine', () => {
  it('renders one polyline per series', async () => {
    const { getByTestId } = await render(<CategoryTrendLine series={series} baseCurrency="UAH" />);

    expect(getByTestId('category-trend-line-line-groceries')).toBeTruthy();
    expect(getByTestId('category-trend-line-line-transport')).toBeTruthy();
  });

  it('strokes each polyline in its category color', async () => {
    const { getByTestId } = await render(<CategoryTrendLine series={series} baseCurrency="UAH" />);

    expect(getByTestId('category-trend-line-line-groceries').props.stroke).toBe('#ff0000');
    expect(getByTestId('category-trend-line-line-transport').props.stroke).toBe('#00ff00');
  });

  it('plots one coordinate pair per point', async () => {
    const { getByTestId } = await render(<CategoryTrendLine series={series} baseCurrency="UAH" />);

    const raw: string = getByTestId('category-trend-line-line-groceries').props.points;
    const pairs = pairsOf(raw);
    expect(pairs).toHaveLength(3);
    for (const [x, y] of pairs) {
      expect(Number.isNaN(x)).toBe(false);
      expect(Number.isNaN(y)).toBe(false);
    }
  });

  it('places later months to the right and larger amounts higher (smaller y)', async () => {
    const { getByTestId } = await render(<CategoryTrendLine series={series} baseCurrency="UAH" />);

    const pairs = pairsOf(getByTestId('category-trend-line-line-groceries').props.points);
    const xs = pairs.map(([x]) => x);
    const ys = pairs.map(([, y]) => y);

    // Time increases left to right (Jan, Feb, Mar).
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
    // Amount 30 (Jan) sits above 10 (Mar), which sits above 0 (Feb).
    expect(ys[0]).toBeLessThan(ys[2]);
    expect(ys[2]).toBeLessThan(ys[1]);
  });

  it('shares one set of X positions across every series', async () => {
    const { getByTestId } = await render(<CategoryTrendLine series={series} baseCurrency="UAH" />);

    const grocery = pairsOf(getByTestId('category-trend-line-line-groceries').props.points).map(
      ([x]) => x,
    );
    const transport = pairsOf(getByTestId('category-trend-line-line-transport').props.points).map(
      ([x]) => x,
    );

    expect(transport).toEqual(grocery);
  });

  it('renders a legend entry per series with the category title', async () => {
    const { getByTestId, getByText } = await render(
      <CategoryTrendLine series={series} baseCurrency="UAH" />,
    );

    expect(getByTestId('category-trend-line-legend-groceries')).toBeTruthy();
    expect(getByTestId('category-trend-line-legend-transport')).toBeTruthy();
    expect(getByText('Groceries')).toBeTruthy();
    expect(getByText('Transport')).toBeTruthy();
  });

  it('draws the X and Y gridlines at the two extremes plus three interior fractions', async () => {
    const { getByTestId, queryByTestId } = await render(
      <CategoryTrendLine series={series} baseCurrency="UAH" />,
    );

    expect(getByTestId('category-trend-line-y-grid-0')).toBeTruthy();
    for (const fraction of ['0.25', '0.50', '0.75']) {
      expect(getByTestId(`category-trend-line-x-grid-${fraction}`)).toBeTruthy();
    }
    expect(queryByTestId('category-trend-line-x-grid-0.00')).toBeNull();
    expect(queryByTestId('category-trend-line-x-grid-1.00')).toBeNull();
  });

  it('labels the X axis with distinct numeric day.month values at the two extremes plus three interior dates', async () => {
    const { getByTestId } = await render(<CategoryTrendLine series={series} baseCurrency="UAH" />);

    // Each X tick reads a zero-padded "DD.MM" (e.g. "01.01"), not a month name.
    const tickLabel = (fraction: string): string => {
      const node = within(getByTestId(`category-trend-line-x-tick-${fraction}`)).getByText(/\d/);

      return String(node.props.children);
    };
    const labels = ['0.00', '0.25', '0.50', '0.75', '1.00'].map(tickLabel);

    for (const label of labels) {
      expect(label).toMatch(/^\d{2}\.\d{2}$/);
    }
    expect(new Set(labels).size).toBe(5);
  });

  it('renders an empty state when there are no series', async () => {
    const { getByTestId, queryByTestId } = await render(
      <CategoryTrendLine series={[]} baseCurrency="UAH" emptyLabel="No Spending To Show" />,
    );

    expect(getByTestId('category-trend-line-empty')).toBeTruthy();
    expect(queryByTestId('category-trend-line-line-groceries')).toBeNull();
  });

  // The buckets are LOCAL-midnight instants (`bucketTimes` steps from the
  // screen's `startOfLocalDay` range start — see category-trend.ts), so the
  // axis labels must be read off LOCAL calendar fields, exactly like
  // net-worth-line's own axis. On a POSITIVE-UTC-offset device (e.g. Kyiv),
  // reading UTC fields instead renders the start date one day EARLY: local
  // midnight Jan 15 is still Jan 14 in UTC there. Pinning the process TZ to a
  // positive-offset zone at runtime is the deterministic proof: reading UTC
  // fields would render '14.01', not the correct local day '15.01'.
  it('labels the start bucket with the LOCAL calendar day, not the UTC day, on a positive-offset device', async () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'Europe/Kyiv';
    try {
      const localSeries: CategoryTrendSeries[] = [
        {
          key: 'groceries',
          title: 'Groceries',
          color: '#ff0000',
          points: [
            { t: new Date(2025, 0, 15).getTime(), amount: 10 },
            { t: new Date(2025, 0, 17).getTime(), amount: 20 },
          ],
        },
      ];
      const { getByTestId } = await render(
        <CategoryTrendLine series={localSeries} baseCurrency="UAH" />,
      );

      expect(getByTestId('category-trend-line-x-tick-0.00')).toHaveTextContent('15.01');
    } finally {
      if (originalTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTz;
      }
    }
  });

  it('collapses the X axis to a single date when every point shares one instant', async () => {
    // A single-instant range has no time span, so the first/middle/last ticks
    // would all stack on the same x — it falls back to one start-edge date
    // label with no middle label and no interior gridline.
    const onePointSeries: CategoryTrendSeries[] = [
      { key: 'groceries', title: 'Groceries', color: '#ff0000', points: [{ t: JAN, amount: 10 }] },
    ];
    const { getByTestId, queryByTestId } = await render(
      <CategoryTrendLine series={onePointSeries} baseCurrency="UAH" />,
    );

    expect(getByTestId('category-trend-line-x-tick-0.00')).toBeTruthy();
    expect(queryByTestId('category-trend-line-x-tick-0.50')).toBeNull();
    expect(queryByTestId('category-trend-line-x-grid-0.50')).toBeNull();
  });
});
