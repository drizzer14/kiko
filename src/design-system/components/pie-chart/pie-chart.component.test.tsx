import { render } from '@testing-library/react-native';

import type { Currency } from '../../../currency/currency';
import { Money } from '../../../currency/money';
import type { AccountSlice } from '../../../statistics/account-contribution';
import '../../unistyles';
import PieChart from './pie-chart.component';

// Flatten a (possibly nested/array) style prop into its plain object layers so a
// test can assert a single directive regardless of how Unistyles composed it.
const styleLayers = (style: unknown): Record<string, unknown>[] =>
  (Array.isArray(style) ? style.flat(Number.POSITIVE_INFINITY) : [style]).filter(
    (layer): layer is Record<string, unknown> => layer != null && typeof layer === 'object',
  );

const slices: AccountSlice[] = [
  { accountId: 'a1', name: 'Monobank', amount: 600_00, share: 0.6, color: '#FF375F' },
  { accountId: 'a2', name: 'Cash', amount: 300_00, share: 0.3, color: '#30D158' },
  { accountId: 'a3', name: 'Revolut', amount: 100_00, share: 0.1, color: '#0A84FF' },
];

// A single quarter-share slice, chosen so its arc's start/end angles (0deg,
// 90deg) land on axis-aligned points — the outer/inner arc coordinates reduce
// to whole numbers (`center`, `center ± radius`) that a test can assert
// directly, rather than a trig-derived decimal.
const quarterSlice: AccountSlice[] = [
  { accountId: 'q1', name: 'Quarter', amount: 100_00, share: 0.25, color: '#FF375F' },
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

  it("colors each arc and its legend swatch with the slice's entity color", async () => {
    const { getByTestId } = await render(<PieChart slices={slices} baseCurrency="USD" />);

    expect(getByTestId('pie-chart-arc-a1').props.fill).toBe('#FF375F');
    expect(getByTestId('pie-chart-arc-a2').props.fill).toBe('#30D158');

    const swatchColor = styleLayers(getByTestId('pie-chart-swatch-a1').props.style)
      .map((layer) => layer.backgroundColor)
      .find((value): value is string => typeof value === 'string');
    expect(swatchColor).toBe('#FF375F');
  });

  it('lays the legend out as aligned columns: a name, a fixed-width value, and a percent', async () => {
    const { getByTestId } = await render(<PieChart slices={slices} baseCurrency="USD" />);

    // Every row's value column carries the same fixed width, and its percent
    // column another, so the figures line up vertically regardless of magnitude.
    const valueWidths = slices.map((slice) =>
      styleLayers(getByTestId(`pie-chart-legend-value-${slice.accountId}`).props.style)
        .map((layer) => layer.width)
        .find((value): value is number => typeof value === 'number'),
    );
    expect(new Set(valueWidths).size).toBe(1);
    expect(valueWidths[0]).toBeGreaterThan(0);

    const percentWidths = slices.map((slice) =>
      styleLayers(getByTestId(`pie-chart-legend-percent-${slice.accountId}`).props.style)
        .map((layer) => layer.width)
        .find((value): value is number => typeof value === 'number'),
    );
    expect(new Set(percentWidths).size).toBe(1);
    expect(percentWidths[0]).toBeGreaterThan(0);

    // Both figure columns are right-aligned so their trailing digits align.
    const valueAlign = styleLayers(getByTestId('pie-chart-legend-value-a1').props.style)
      .map((layer) => layer.alignItems)
      .find((value): value is string => typeof value === 'string');
    expect(valueAlign).toBe('flex-end');
  });

  it('emits a closed donut-wedge arc path: move-to, an A arc command, and a Z cap', async () => {
    const { getByTestId } = await render(<PieChart slices={slices} baseCurrency="USD" />);

    const d: string = getByTestId('pie-chart-arc-a1').props.d;
    expect(d.startsWith('M ')).toBe(true);
    // Outer sweep and inner return sweep: two elliptical-arc commands.
    expect(d.match(/A /g) ?? []).toHaveLength(2);
    expect(d.trimEnd().endsWith('Z')).toBe(true);
  });

  // A 25%-share slice's start/end angles (0deg, 90deg) land on axis-aligned
  // points, so the inner-arc endpoints reduce to `center ± innerRadius`
  // rather than a trig-derived decimal — a test can assert the ring's exact
  // radius (floated through the same `outerRadius * ratio` multiplication
  // the component itself does, since 100 * 0.58 is not float-exact).
  const innerRadiusFor = (ratio: number): number => 100 * ratio;

  it('defaults to the standard ring thickness when no `innerRatio` is supplied', async () => {
    const { getByTestId } = await render(<PieChart slices={quarterSlice} baseCurrency="USD" />);

    const innerRadius = innerRadiusFor(0.58);
    const d: string = getByTestId('pie-chart-arc-q1').props.d;
    expect(d).toContain(`L ${100 + innerRadius} 100`);
    expect(d).toContain(`A ${innerRadius} ${innerRadius}`);
  });

  it('accepts a caller-supplied `innerRatio` to thin the ring, opening more center hole', async () => {
    const { getByTestId } = await render(
      <PieChart slices={quarterSlice} baseCurrency="USD" innerRatio={0.8} />,
    );

    // A higher ratio moves the inner ring OUT (closer to the outer edge),
    // thinning the visible band and opening more room at the center.
    const innerRadius = innerRadiusFor(0.8);
    const d: string = getByTestId('pie-chart-arc-q1').props.d;
    expect(d).toContain(`L ${100 + innerRadius} 100`);
    expect(d).toContain(`A ${innerRadius} ${innerRadius}`);
    expect(innerRadius).toBeGreaterThan(innerRadiusFor(0.58));
  });

  it('renders no center total by default, matching the account-contribution pie', async () => {
    const { queryByTestId } = await render(<PieChart slices={slices} baseCurrency="USD" />);

    expect(queryByTestId('pie-chart-center-total')).toBeNull();
  });

  it('centers a supplied `centerTotal` in the donut hole', async () => {
    const baseCurrency: Currency = 'USD';
    const { getByTestId, getByText } = await render(
      <PieChart
        slices={slices}
        baseCurrency={baseCurrency}
        centerTotal={Money.of(baseCurrency, 1_000_00)}
      />,
    );

    expect(getByTestId('pie-chart-center-total')).toBeTruthy();
    expect(getByText(/\$1,000\.00/)).toBeTruthy();
  });

  it('renders an empty-state message when there are no slices', async () => {
    const { getByTestId, queryByTestId } = await render(
      <PieChart slices={[]} baseCurrency="USD" />,
    );

    expect(getByTestId('pie-chart-empty')).toBeTruthy();
    expect(queryByTestId('pie-chart-arc-a1')).toBeNull();
  });
});
