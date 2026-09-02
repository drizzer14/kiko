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
});
