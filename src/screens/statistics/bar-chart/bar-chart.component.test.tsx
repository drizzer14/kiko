import { render } from '@testing-library/react-native';

import { defaultHoldingColor } from '../../../holdings/entity-colors';
import type { TypeSlice } from '../../../statistics/type-breakdown';
import '../../../design-system/unistyles';
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
    expect(getByText('Deposit')).toBeTruthy();
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

  it('never renders a negative bar width', async () => {
    const { getByTestId } = await render(
      <BarChart
        data={[
          { type: 'cash', amount: 1_000_000 },
          { type: 'card', amount: -500_000 },
        ]}
        baseCurrency="USD"
      />,
    );

    const width = Number(getByTestId('bar-chart-bar-card').props.width);

    expect(width).toBeGreaterThanOrEqual(0);
    expect(width).toBeLessThanOrEqual(320);
  });

  it('scales against the largest magnitude, so a negative slice is half of a double-sized positive', async () => {
    const { getByTestId } = await render(
      <BarChart
        data={[
          { type: 'cash', amount: 1_000_000 },
          { type: 'card', amount: -500_000 },
        ]}
        baseCurrency="USD"
      />,
    );

    expect(Number(getByTestId('bar-chart-bar-cash').props.width)).toBe(320);
    expect(Number(getByTestId('bar-chart-bar-card').props.width)).toBe(160);
  });

  it('does not render every bar full-width for all-negative data', async () => {
    const { getByTestId } = await render(
      <BarChart
        data={[
          { type: 'cash', amount: -100_000 },
          { type: 'card', amount: -500_000 },
        ]}
        baseCurrency="USD"
      />,
    );

    expect(Number(getByTestId('bar-chart-bar-card').props.width)).toBe(320);
    expect(Number(getByTestId('bar-chart-bar-cash').props.width)).toBe(64);
  });

  it('still renders the honest signed money label for a negative slice', async () => {
    const { getByText } = await render(
      <BarChart data={[{ type: 'card', amount: -500_000 }]} baseCurrency="USD" />,
    );

    expect(getByText(/-/)).toBeTruthy();
  });
});
