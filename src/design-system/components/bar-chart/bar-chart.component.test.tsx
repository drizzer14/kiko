import { render } from '@testing-library/react-native';
import { defaultHoldingColor } from '../../../holdings/entity-colors';
import type { TypeSlice } from '../../../statistics/type-breakdown';
import '../../unistyles';
import BarChart from './index';

const data: TypeSlice[] = [
  { type: 'card', amount: 1_000_00 },
  { type: 'term_deposit', amount: 500_00 },
  { type: 'crypto_asset', amount: 250_00 },
];

describe('BarChart', () => {
  it('renders one bar per entry', async () => {
    const { getByTestId } = await render(<BarChart data={data} baseCurrency="USD" />);

    expect(getByTestId('bar-chart-bar-card')).toBeTruthy();
    expect(getByTestId('bar-chart-bar-term_deposit')).toBeTruthy();
    expect(getByTestId('bar-chart-bar-crypto_asset')).toBeTruthy();
  });

  it('renders a human-readable type label per entry', async () => {
    const { getByTestId, getByText } = await render(<BarChart data={data} baseCurrency="USD" />);

    expect(getByTestId('bar-chart-label-card')).toBeTruthy();
    expect(getByTestId('bar-chart-label-term_deposit')).toBeTruthy();
    expect(getByText('Card')).toBeTruthy();
    expect(getByText('Term Deposit')).toBeTruthy();
    expect(getByText('Crypto Asset')).toBeTruthy();
  });

  it('renders the converted amount label per entry', async () => {
    const { getByText } = await render(<BarChart data={data} baseCurrency="USD" />);

    expect(getByText(/\$1,000\.00/)).toBeTruthy();
    expect(getByText(/\$500\.00/)).toBeTruthy();
    expect(getByText(/\$250\.00/)).toBeTruthy();
  });

  it('scales each bar width to the largest entry', async () => {
    const { getByTestId } = await render(<BarChart data={data} baseCurrency="USD" />);

    const fullWidth: number = getByTestId('bar-chart-bar-card').props.width;
    const halfWidth: number = getByTestId('bar-chart-bar-term_deposit').props.width;

    expect(halfWidth / fullWidth).toBeCloseTo(0.5);
  });

  it("colors each bar with its holding type's entity color", async () => {
    const { getByTestId } = await render(<BarChart data={data} baseCurrency="USD" />);

    expect(getByTestId('bar-chart-bar-card').props.fill).toBe(defaultHoldingColor.card);
    expect(getByTestId('bar-chart-bar-term_deposit').props.fill).toBe(
      defaultHoldingColor.term_deposit,
    );
    expect(getByTestId('bar-chart-bar-crypto_asset').props.fill).toBe(
      defaultHoldingColor.crypto_asset,
    );
  });

  it('renders an empty-state message when there is no data', async () => {
    const { getByTestId, queryByTestId } = await render(<BarChart data={[]} baseCurrency="USD" />);

    expect(getByTestId('bar-chart-empty')).toBeTruthy();
    expect(queryByTestId('bar-chart-bar-card')).toBeNull();
  });
});
