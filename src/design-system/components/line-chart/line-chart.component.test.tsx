import { render } from '@testing-library/react-native';
import type { CurrencySeries } from '../../../statistics/currency-series';
import '../../unistyles';
import LineChart from './line-chart.component';

const uahSeries: CurrencySeries = {
  currency: 'UAH',
  points: [
    { t: 0, pct: 0 },
    { t: 86_400_000, pct: 10 },
    { t: 172_800_000, pct: -5 },
  ],
};

const usdSeries: CurrencySeries = {
  currency: 'USD',
  points: [
    { t: 0, pct: 0 },
    { t: 86_400_000, pct: 4 },
    { t: 172_800_000, pct: 8 },
  ],
};

describe('LineChart', () => {
  it('renders one polyline per series', async () => {
    const { getByTestId } = await render(<LineChart series={[uahSeries, usdSeries]} />);

    expect(getByTestId('line-chart-series-UAH')).toBeTruthy();
    expect(getByTestId('line-chart-series-USD')).toBeTruthy();
  });

  it('renders a legend entry per currency showing the currency code', async () => {
    const { getByTestId, getByText } = await render(<LineChart series={[uahSeries, usdSeries]} />);

    expect(getByTestId('line-chart-legend-UAH')).toBeTruthy();
    expect(getByTestId('line-chart-legend-USD')).toBeTruthy();
    expect(getByText('UAH')).toBeTruthy();
    expect(getByText('USD')).toBeTruthy();
  });

  it('renders a 0% baseline line', async () => {
    const { getByTestId } = await render(<LineChart series={[uahSeries]} />);

    expect(getByTestId('line-chart-baseline')).toBeTruthy();
  });

  it('renders an empty-state message when there are no series', async () => {
    const { getByTestId, queryByTestId } = await render(<LineChart series={[]} />);

    expect(getByTestId('line-chart-empty')).toBeTruthy();
    expect(queryByTestId('line-chart-baseline')).toBeNull();
  });

  it('encodes one coordinate pair per point in the polyline points string', async () => {
    const { getByTestId } = await render(<LineChart series={[uahSeries]} />);

    const points: string = getByTestId('line-chart-series-UAH').props.points;
    const pairs = points.trim().split(' ');
    expect(pairs).toHaveLength(uahSeries.points.length);
    for (const pair of pairs) {
      expect(pair).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
    }
  });

  it('draws a visible marker for a single-point series so the lone datum shows', async () => {
    const singlePoint: CurrencySeries = { currency: 'EUR', points: [{ t: 0, pct: 0 }] };

    const { getByTestId } = await render(<LineChart series={[singlePoint]} />);

    expect(getByTestId('line-chart-marker-EUR')).toBeTruthy();
  });

  it('draws no marker for a multi-point series', async () => {
    const { queryByTestId } = await render(<LineChart series={[uahSeries]} />);

    expect(queryByTestId('line-chart-marker-UAH')).toBeNull();
  });
});
