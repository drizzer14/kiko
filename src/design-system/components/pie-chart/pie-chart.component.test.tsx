import { render } from '@testing-library/react-native';
import type { AccountSlice } from '../../../statistics/account-contribution';
import '../../unistyles';
import PieChart from './pie-chart.component';

const slices: AccountSlice[] = [
  { accountId: 'a1', name: 'Monobank', amount: 600_00, share: 0.6, color: '#FF375F' },
  { accountId: 'a2', name: 'Cash', amount: 300_00, share: 0.3, color: '#30D158' },
  { accountId: 'a3', name: 'Revolut', amount: 100_00, share: 0.1, color: '#0A84FF' },
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

  it("colors each arc with the slice's entity color", async () => {
    const { getByTestId } = await render(<PieChart slices={slices} baseCurrency="USD" />);

    expect(getByTestId('pie-chart-arc-a1').props.fill).toBe('#FF375F');
    expect(getByTestId('pie-chart-arc-a2').props.fill).toBe('#30D158');
    expect(getByTestId('pie-chart-arc-a3').props.fill).toBe('#0A84FF');
  });

  it('emits a closed donut-wedge arc path: move-to, an A arc command, and a Z cap', async () => {
    const { getByTestId } = await render(<PieChart slices={slices} baseCurrency="USD" />);

    const d: string = getByTestId('pie-chart-arc-a1').props.d;
    expect(d.startsWith('M ')).toBe(true);
    // Outer sweep and inner return sweep: two elliptical-arc commands.
    expect(d.match(/A /g) ?? []).toHaveLength(2);
    expect(d.trimEnd().endsWith('Z')).toBe(true);
  });

  it('renders an empty-state message when there are no slices', async () => {
    const { getByTestId, queryByTestId } = await render(
      <PieChart slices={[]} baseCurrency="USD" />,
    );

    expect(getByTestId('pie-chart-empty')).toBeTruthy();
    expect(queryByTestId('pie-chart-arc-a1')).toBeNull();
  });
});
