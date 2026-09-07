import { render, within } from '@testing-library/react-native';

import type { CategoryTrendSeries } from '../../../statistics/category-trend';
import '../../unistyles';
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

  it('draws the X and Y gridlines', async () => {
    const { getByTestId } = await render(<CategoryTrendLine series={series} baseCurrency="UAH" />);

    expect(getByTestId('category-trend-line-y-grid-0')).toBeTruthy();
    for (const key of ['0.25', '0.50', '0.75']) {
      expect(getByTestId(`category-trend-line-x-grid-${key}`)).toBeTruthy();
    }
  });

  it('labels the X axis at day granularity, so the tick numbers vary across the window', async () => {
    const { getByTestId } = await render(<CategoryTrendLine series={series} baseCurrency="UAH" />);

    // Each X tick reads month-abbrev + day-of-month (e.g. "Jan 1"), so the
    // trailing number is the DAY and varies across the 5 ticks. The old
    // month/year format ("Jan 25") put the constant 2-digit year there, so
    // every tick's trailing number would be identical — this asserts it is not.
    const tickLabel = (fraction: string): string => {
      const node = within(getByTestId(`category-trend-line-x-tick-${fraction}`)).getByText(/\d/);

      return String(node.props.children);
    };
    const trailingNumbers = new Set(
      ['0.00', '0.25', '0.50', '0.75', '1.00'].map((fraction) =>
        tickLabel(fraction).replace(/^\D+/, ''),
      ),
    );

    expect(trailingNumbers.size).toBeGreaterThan(1);
  });

  it('renders an empty state when there are no series', async () => {
    const { getByTestId, queryByTestId } = await render(
      <CategoryTrendLine series={[]} baseCurrency="UAH" emptyLabel="No Spending To Show" />,
    );

    expect(getByTestId('category-trend-line-empty')).toBeTruthy();
    expect(queryByTestId('category-trend-line-line-groceries')).toBeNull();
  });

  // The buckets are UTC-midnight instants (`dayBucket` uses `Date.UTC`), so the
  // axis labels must be formatted in UTC too — otherwise, in a negative-UTC-
  // offset locale, a UTC-midnight instant is still the PREVIOUS local day and
  // every label reads one day early. The formatter therefore must pass
  // `timeZone: 'UTC'`, which a spy on `toLocaleDateString` verifies directly
  // (the jest worker's own timezone is fixed and can't be changed at runtime,
  // so asserting the option is the deterministic proof).
  it('formats every X-axis label in UTC so the bucket day is never off by one', async () => {
    const spy = jest.spyOn(Date.prototype, 'toLocaleDateString');
    try {
      await render(<CategoryTrendLine series={series} baseCurrency="UAH" />);

      expect(spy).toHaveBeenCalled();
      for (const call of spy.mock.calls) {
        expect(call[1]).toMatchObject({ timeZone: 'UTC' });
      }
    } finally {
      spy.mockRestore();
    }
  });
});
