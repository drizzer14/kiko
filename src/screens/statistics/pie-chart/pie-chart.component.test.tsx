import { fireEvent, render, within } from '@testing-library/react-native';

import type { Currency } from '../../../currency/currency';
import { Money } from '../../../currency/money';
import type { AccountSlice } from '../../../statistics/account-contribution';
import '../../../design-system/unistyles';
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

  it('legend percents sum to 100 for four uneven slices', async () => {
    const { getByTestId } = await render(
      <PieChart
        testID="pie"
        slices={[
          { accountId: 'a', name: 'A', amount: 50, share: 0.5, color: '#0A84FF' },
          { accountId: 'b', name: 'B', amount: 25, share: 0.25, color: '#30D158' },
          { accountId: 'c', name: 'C', amount: 12.5, share: 0.125, color: '#FF9F0A' },
          { accountId: 'd', name: 'D', amount: 12.5, share: 0.125, color: '#BF5AF2' },
        ]}
        baseCurrency="UAH"
      />,
    );

    const percents = ['a', 'b', 'c', 'd'].map((key) =>
      Number(
        String(
          within(getByTestId(`pie-legend-percent-${key}`)).getByText(/%$/).props.children,
        ).replace('%', ''),
      ),
    );

    expect(percents.reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  it('legend percents sum to 100 for three equal slices', async () => {
    // 33/33/33 = 99 under per-slice rounding; the largest-remainder pass gives
    // one of them 34.
    const third = 1 / 3;
    const { getByTestId } = await render(
      <PieChart
        testID="pie"
        slices={['a', 'b', 'c'].map((key, index) => ({
          accountId: key,
          name: key,
          amount: 1,
          share: third,
          color: ['#0A84FF', '#30D158', '#FF9F0A'][index],
        }))}
        baseCurrency="UAH"
      />,
    );

    const percents = ['a', 'b', 'c'].map((key) =>
      Number(
        String(
          within(getByTestId(`pie-legend-percent-${key}`)).getByText(/%$/).props.children,
        ).replace('%', ''),
      ),
    );

    expect(percents.reduce((sum, value) => sum + value, 0)).toBe(100);
    expect(percents.filter((value) => value === 34)).toHaveLength(1);
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

  it('centers a supplied `centerTotal` amount in the donut hole with no caption', async () => {
    const baseCurrency: Currency = 'USD';
    const { getByTestId, getByText, queryByText } = await render(
      <PieChart
        slices={slices}
        baseCurrency={baseCurrency}
        centerTotal={Money.of(baseCurrency, 1_000_00)}
      />,
    );

    // The amount still renders inside the center-total wrapper...
    expect(getByTestId('pie-chart-center-total')).toBeTruthy();
    expect(getByText(/\$1,000\.00/)).toBeTruthy();
    // ...but the "Total" caption that used to sit beneath it is gone.
    expect(queryByText('Total')).toBeNull();
  });

  // A set with two slices at or above 5% (a, b) and two below (c at exactly the
  // 0.05 boundary is KEPT, d below it is cropped) — so a collapsed legend hides
  // exactly one row while the ring still draws all four arcs.
  const mixedShareSlices: AccountSlice[] = [
    { accountId: 'a', name: 'Alpha', amount: 800, share: 0.8, color: '#FF375F' },
    { accountId: 'b', name: 'Bravo', amount: 120, share: 0.12, color: '#30D158' },
    { accountId: 'c', name: 'Charlie', amount: 50, share: 0.05, color: '#0A84FF' },
    { accountId: 'd', name: 'Delta', amount: 30, share: 0.03, color: '#FF9F0A' },
  ];

  it('without `legendMinShare`, shows every legend row and renders no toggle', async () => {
    const { getByTestId, queryByTestId } = await render(
      <PieChart slices={mixedShareSlices} baseCurrency="USD" />,
    );

    expect(getByTestId('pie-chart-legend-a')).toBeTruthy();
    expect(getByTestId('pie-chart-legend-d')).toBeTruthy();
    expect(queryByTestId('pie-chart-legend-toggle')).toBeNull();
  });

  it('with `legendMinShare`, crops the legend to slices at or above the threshold and shows a toggle', async () => {
    const { getByTestId, getByText, queryByTestId } = await render(
      <PieChart slices={mixedShareSlices} baseCurrency="USD" legendMinShare={0.05} />,
    );

    // a/b/c are at or above 0.05 and stay; d (0.03) is cropped by default.
    expect(getByTestId('pie-chart-legend-a')).toBeTruthy();
    expect(getByTestId('pie-chart-legend-b')).toBeTruthy();
    expect(getByTestId('pie-chart-legend-c')).toBeTruthy();
    expect(queryByTestId('pie-chart-legend-d')).toBeNull();

    // The percent labels stay allocated over ALL four slices, so a kept row
    // reads its full-set share (a is 80%), not a share recomputed over the
    // cropped subset.
    expect(getByText('80%')).toBeTruthy();

    const toggle = getByTestId('pie-chart-legend-toggle');
    expect(within(toggle).getByText('Show all')).toBeTruthy();
  });

  it('reveals the sub-threshold rows when "Show all" is tapped, then collapses on "Show less"', async () => {
    const { getByTestId, queryByTestId } = await render(
      <PieChart slices={mixedShareSlices} baseCurrency="USD" legendMinShare={0.05} />,
    );

    await fireEvent.press(getByTestId('pie-chart-legend-toggle'));

    expect(getByTestId('pie-chart-legend-d')).toBeTruthy();
    expect(within(getByTestId('pie-chart-legend-toggle')).getByText('Show less')).toBeTruthy();

    await fireEvent.press(getByTestId('pie-chart-legend-toggle'));

    expect(queryByTestId('pie-chart-legend-d')).toBeNull();
    expect(within(getByTestId('pie-chart-legend-toggle')).getByText('Show all')).toBeTruthy();
  });

  it('still draws every arc while the legend is collapsed — the ring is never cropped', async () => {
    const { getByTestId } = await render(
      <PieChart slices={mixedShareSlices} baseCurrency="USD" legendMinShare={0.05} />,
    );

    // d's legend row is cropped, but its ring arc still draws.
    expect(getByTestId('pie-chart-arc-a')).toBeTruthy();
    expect(getByTestId('pie-chart-arc-d')).toBeTruthy();
  });

  it('shows every row and renders no toggle when no slice reaches the threshold', async () => {
    // 25 equal slices of 0.04 each — every share is below 0.05, so there is
    // nothing to crop and no toggle to render.
    const allTinySlices: AccountSlice[] = Array.from({ length: 25 }, (_, index) => ({
      accountId: `t${index}`,
      name: `Tiny ${index}`,
      amount: 4,
      share: 0.04,
      color: '#0A84FF',
    }));

    const { getByTestId, queryByTestId } = await render(
      <PieChart slices={allTinySlices} baseCurrency="USD" legendMinShare={0.05} />,
    );

    expect(getByTestId('pie-chart-legend-t0')).toBeTruthy();
    expect(getByTestId('pie-chart-legend-t24')).toBeTruthy();
    expect(queryByTestId('pie-chart-legend-toggle')).toBeNull();
  });

  it('renders no toggle when every slice already reaches the threshold', async () => {
    // slices (0.6/0.3/0.1) are all at or above 0.05 — nothing is cropped.
    const { getByTestId, queryByTestId } = await render(
      <PieChart slices={slices} baseCurrency="USD" legendMinShare={0.05} />,
    );

    expect(getByTestId('pie-chart-legend-a1')).toBeTruthy();
    expect(getByTestId('pie-chart-legend-a3')).toBeTruthy();
    expect(queryByTestId('pie-chart-legend-toggle')).toBeNull();
  });

  it('renders an empty-state message when there are no slices', async () => {
    const { getByTestId, queryByTestId } = await render(
      <PieChart slices={[]} baseCurrency="USD" />,
    );

    expect(getByTestId('pie-chart-empty')).toBeTruthy();
    expect(queryByTestId('pie-chart-arc-a1')).toBeNull();
  });
});
