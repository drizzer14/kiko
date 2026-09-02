import { render } from '@testing-library/react-native';
import type { AccountSlice } from '../../../statistics/account-contribution';
import '../../unistyles';
import PieChart from './pie-chart.component';

const slices: AccountSlice[] = [
  { accountId: 'a1', name: 'Monobank', amount: 600_00, share: 0.6 },
  { accountId: 'a2', name: 'Cash', amount: 300_00, share: 0.3 },
  { accountId: 'a3', name: 'Revolut', amount: 100_00, share: 0.1 },
];

describe('PieChart', () => {
  it('renders one arc path per slice', async () => {
    const { getByTestId } = await render(<PieChart slices={slices} baseCurrency="USD" />);

    expect(getByTestId('pie-chart-arc-a1')).toBeTruthy();
    expect(getByTestId('pie-chart-arc-a2')).toBeTruthy();
    expect(getByTestId('pie-chart-arc-a3')).toBeTruthy();
  });

  it('renders a legend entry per slice with account name, amount, and percent', async () => {
    const { getByTestId, getByText } = await render(
      <PieChart slices={slices} baseCurrency="USD" />,
    );

    expect(getByTestId('pie-chart-legend-a1')).toBeTruthy();
    expect(getByTestId('pie-chart-legend-a2')).toBeTruthy();
    expect(getByTestId('pie-chart-legend-a3')).toBeTruthy();
    expect(getByText('Monobank')).toBeTruthy();
    expect(getByText(/\$600\.00/)).toBeTruthy();
    expect(getByText('60%')).toBeTruthy();
    expect(getByText('10%')).toBeTruthy();
  });

  it('renders an empty-state message when there are no slices', async () => {
    const { getByTestId, queryByTestId } = await render(
      <PieChart slices={[]} baseCurrency="USD" />,
    );

    expect(getByTestId('pie-chart-empty')).toBeTruthy();
    expect(queryByTestId('pie-chart-arc-a1')).toBeNull();
  });
});
