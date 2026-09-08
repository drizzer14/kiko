import { act, render } from '@testing-library/react-native';

import { endOfLocalDay, startOfLocalDay } from '../../../dates/local-day';
import { i18n } from '../../../i18n';
import type { NetWorthPoint } from '../../../statistics/net-worth-series';
import { darkTheme } from '../../theme';
import '../../unistyles';
import NetWorthLine from './index';
import { buildLineSegments, toAreaPath } from './net-worth-line.component';

// Every "y,x" coordinate's Y value in a path `d` string — every number that
// follows a comma. The area builders clamp these to `referenceY`, so a test can
// assert the whole green path stays at or above the reference (smaller-or-equal
// y) and the whole red path at or below it, with no ClipPath in play.
const pathYs = (d: string): number[] =>
  [...d.matchAll(/,(-?\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));

// Every plotted point's scaled Y from the rendered polyline's `points` string,
// so a band-anchored gradient test can derive the true filled-band extremes
// (highest above-reference pixel, lowest below-reference pixel) the component
// computed, without re-deriving the scale math here.
const polylineYs = (raw: string): number[] =>
  raw
    .trim()
    .split(' ')
    .map((pair) => Number(pair.split(',')[1]));

// R5-D split the stroke into one <Polyline> per sign-contiguous segment
// (testID `net-worth-line-polyline-<key>`) instead of a single polyline —
// this flattens every segment's points into one Y array, the same shape
// `polylineYs` used to return from the old single polyline, so the
// gradient-anchoring math below (which only cares about the SET of plotted
// Y's, not which segment carried which) is unchanged.
const allSegmentYs = (segments: { props: Record<string, unknown> }[]): number[] =>
  segments.flatMap((segment) => polylineYs(String(segment.props.points)));

// Flatten a (possibly nested/array) style prop into its plain object layers so a
// test can assert a single directive regardless of how Unistyles composed it.
const styleLayers = (style: unknown): Record<string, unknown>[] =>
  (Array.isArray(style) ? style.flat(Number.POSITIVE_INFINITY) : [style]).filter(
    (layer): layer is Record<string, unknown> => layer != null && typeof layer === 'object',
  );

const points: NetWorthPoint[] = [
  { t: 0, amount: 100 },
  { t: 86_400_000, amount: 300 },
  { t: 172_800_000, amount: 200 },
];

describe('toAreaPath', () => {
  // An identity scale keeps the assertions readable: x(t) === t, y(v) === v. y
  // grows DOWNWARD, so a SMALLER y is above the reference and a LARGER y below.
  const scales = {
    x: (t: number) => t,
    y: (v: number) => v,
    minTime: 0,
    maxTime: 2,
  };

  // Crossing data: starts ABOVE the reference (y 10 < 15), dips BELOW (y 20 >
  // 15), and returns above (y 12 < 15). This is the shape that exercises both
  // sides — and both a DOWN crossing (x 0.5) and an UP crossing (x 1.625). The
  // interpolated crossing x is NOT either neighbour vertex's x (0 or 1 or 2).
  const crossing: NetWorthPoint[] = [
    { t: 0, amount: 10 },
    { t: 1, amount: 20 },
    { t: 2, amount: 12 },
  ];
  const referenceY = 15;

  it('inserts an interpolated crossing vertex at referenceY where the line dips below (above side)', () => {
    const path = toAreaPath(crossing, scales, referenceY, 'above');

    // Down crossing at x = 0 + (1-0)*(15-10)/(20-10) = 0.5; up crossing at
    // x = 1 + (2-1)*(15-20)/(12-20) = 1.625. Each lands AT referenceY (15), at
    // the TRUE crossing x, not the neighbour vertex x (1). The below vertex
    // rides referenceY. Closes to referenceY under the last then first x.
    expect(path).toBe('M 0,10 L 0.5,15 L 1,15 L 1.625,15 L 2,12 L 2,15 L 0,15 Z');
    // The inserted vertices are at the interpolated crossing x, not at x=1.
    expect(path).toContain('0.5,15');
    expect(path).toContain('1.625,15');
    // No vertex ever exceeds referenceY (green never dips below the baseline).
    for (const y of pathYs(path)) {
      expect(y).toBeLessThanOrEqual(referenceY);
    }
    // Non-degenerate: it still reaches genuinely above the reference.
    expect(pathYs(path).some((y) => y < referenceY)).toBe(true);
  });

  it('inserts an interpolated crossing vertex at referenceY where the line rises above (below side)', () => {
    const path = toAreaPath(crossing, scales, referenceY, 'below');

    // Same crossing x's (0.5, 1.625) at referenceY; the below vertex (y 20)
    // keeps its own y, the two above vertices ride referenceY.
    expect(path).toBe('M 0,15 L 0.5,15 L 1,20 L 1.625,15 L 2,15 L 2,15 L 0,15 Z');
    expect(path).toContain('0.5,15');
    expect(path).toContain('1.625,15');
    // No vertex is ever above referenceY (red never rises past the baseline).
    for (const y of pathYs(path)) {
      expect(y).toBeGreaterThanOrEqual(referenceY);
    }
    // Non-degenerate: it still reaches genuinely below the reference.
    expect(pathYs(path).some((y) => y > referenceY)).toBe(true);
  });

  it('closes each path to the reference baseline, not the chart bottom', () => {
    for (const side of ['above', 'below'] as const) {
      const path = toAreaPath(crossing, scales, referenceY, side);
      expect(path.startsWith('M ')).toBe(true);
      expect(path.trimEnd().endsWith(`L 2,${referenceY} L 0,${referenceY} Z`)).toBe(true);
    }
  });
});

// R5-D: the stroke's per-sign segmentation. Reuses the exact same identity
// scale, `crossing` fixture, and `referenceY` as the `toAreaPath` suite
// above — proving the STROKE's crossing x's (0.5, 1.625) are the FILL's own,
// not independently re-derived.
describe('buildLineSegments', () => {
  const scales = {
    x: (t: number) => t,
    y: (v: number) => v,
    minTime: 0,
    maxTime: 2,
  };
  const crossing: NetWorthPoint[] = [
    { t: 0, amount: 10 },
    { t: 1, amount: 20 },
    { t: 2, amount: 12 },
  ];
  const referenceY = 15;

  it('splits into one segment per contiguous side, at the SAME crossing x as toAreaPath (0.5, 1.625)', () => {
    const segments = buildLineSegments(crossing, scales, referenceY);

    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => segment.side)).toEqual(['above', 'below', 'above']);

    // Down crossing at x = 0.5 — matches toAreaPath's "M 0,10 L 0.5,15 ..."
    // above; the first (above) segment ends there, the second (below) starts
    // there, so the stroke and fill agree exactly at the split.
    expect(segments[0].points).toBe('0,10 0.5,15');
    expect(segments[1].points).toBe('0.5,15 1,20 1.625,15');
    // Up crossing at x = 1.625 — matches toAreaPath's "... 1.625,15 L 2,12
    // ..." above; the third (above) segment starts there.
    expect(segments[2].points).toBe('1.625,15 2,12');
  });

  it('collapses to exactly one segment when the series never crosses the reference', () => {
    const neverCrosses: NetWorthPoint[] = [
      { t: 0, amount: 20 },
      { t: 1, amount: 25 },
      { t: 2, amount: 22 },
    ];

    const segments = buildLineSegments(neverCrosses, scales, referenceY);

    expect(segments).toHaveLength(1);
    expect(segments[0].side).toBe('below');
    expect(segments[0].points).toBe('0,20 1,25 2,22');
  });

  it('renders exactly one point (no visible line, no crash) for a single-point series', () => {
    const onePoint: NetWorthPoint[] = [{ t: 0, amount: 10 }];

    const segments = buildLineSegments(onePoint, scales, referenceY);

    expect(segments).toHaveLength(1);
    expect(segments[0].points).toBe('0,10');
  });

  it('does not double up a vertex that sits exactly ON the reference', () => {
    // The middle point sits exactly at referenceY: sideOfY ties it to
    // 'above' (the same inclusive `y <= referenceY` convention
    // bandExtremes' aboveYs filter uses), so the crossing-x formula
    // degenerates to that vertex's OWN x (y1 === referenceY -> xCross ===
    // x1) — pushVertex must not push it twice in a row.
    const touchesReference: NetWorthPoint[] = [
      { t: 0, amount: 10 },
      { t: 1, amount: 15 },
      { t: 2, amount: 20 },
    ];

    const segments = buildLineSegments(touchesReference, scales, referenceY);

    expect(segments).toHaveLength(2);
    expect(segments.map((segment) => segment.side)).toEqual(['above', 'below']);
    expect(segments[0].points).toBe('0,10 1,15');
    expect(segments[1].points).toBe('1,15 2,20');
  });
});

describe('NetWorthLine', () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('re-formats a UAH Y-axis label when the active language changes (en-US comma grouping -> uk-UA space grouping)', async () => {
    // Clean, evenly-spaced amounts so the four Y-axis ticks (1236, 1224, 1212,
    // 1200) land on distinct grouped-thousands values in the base compact
    // unit — see currency/compact.ts's chooseCompactUnit: a K-unit label here
    // would collapse every tick to "1", so it steps down to the base unit,
    // which is exactly the grouped integer this test needs.
    const uahPoints: NetWorthPoint[] = [
      { t: 0, amount: 1200 },
      { t: 86_400_000, amount: 1236 },
    ];
    const { getByText, queryByText } = await render(
      <NetWorthLine points={uahPoints} startReference={1218} baseCurrency="UAH" />,
    );

    expect(getByText('1,236 ₴')).toBeTruthy();

    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    // uk-UA groups thousands with U+00A0 NO-BREAK SPACE (see
    // currency/compact.test.ts for the same finding on formatCompactMoney).
    expect(queryByText('1,236 ₴')).toBeNull();
    expect(getByText('1 236 ₴')).toBeTruthy();
  });

  // R5-D changed this from a single always-white polyline to sign-colored
  // segments (see "colors the net-worth stroke by sign" below); this guard
  // now covers only the non-crossing case, where the segmentation collapses
  // back to exactly one polyline carrying one coordinate pair per point —
  // the crossing case is covered separately below.
  it('renders one stroke segment with one coordinate pair per point when nothing crosses the reference', async () => {
    const nonCrossingPoints: NetWorthPoint[] = [
      { t: 0, amount: 220 },
      { t: 86_400_000, amount: 260 },
      { t: 172_800_000, amount: 240 },
    ];
    const { getAllByTestId } = await render(
      <NetWorthLine points={nonCrossingPoints} startReference={200} baseCurrency="USD" />,
    );

    const segments = getAllByTestId(/^net-worth-line-polyline-/);
    expect(segments).toHaveLength(1);

    const pairs = segments[0].props.points.trim().split(' ');
    expect(pairs).toHaveLength(nonCrossingPoints.length);
    for (const pair of pairs) {
      expect(pair).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
    }
  });

  it('renders a dashed reference line at the start-reference value', async () => {
    const height = 200;
    const { getByTestId } = await render(
      <NetWorthLine points={points} startReference={200} baseCurrency="USD" height={height} />,
    );

    const reference = getByTestId('net-worth-line-reference');
    expect(reference.props.strokeDasharray).toBeTruthy();
    // The reference is horizontal.
    expect(reference.props.y1).toBe(reference.props.y2);
    // With min=100, max=300, a reference of 200 (the midpoint) sits at the
    // vertical centre of the plot regardless of symmetric padding.
    expect(reference.props.y1).toBeCloseTo(height / 2);
  });

  // NEW-2: the y-domain is anchored symmetrically on startReference, so the
  // dashed baseline holds a stable vertical position (centred) and a dip below
  // it renders proportionally instead of teleporting the baseline to the top.
  it('keeps the reference centred when net worth dips below the start (NEW-2)', async () => {
    const height = 200;
    const { getByTestId } = await render(
      <NetWorthLine
        points={[
          { t: 0, amount: 100 },
          { t: 1, amount: 95 },
        ]}
        startReference={100}
        baseCurrency="USD"
        height={height}
      />,
    );

    const reference = getByTestId('net-worth-line-reference');
    expect(reference.props.y1).toBe(reference.props.y2);
    expect(reference.props.y1).toBeCloseTo(height / 2, 0);
  });

  it('keeps the reference centred when net worth rises above the start (NEW-2)', async () => {
    const height = 200;
    const { getByTestId } = await render(
      <NetWorthLine
        points={[
          { t: 0, amount: 100 },
          { t: 1, amount: 105 },
        ]}
        startReference={100}
        baseCurrency="USD"
        height={height}
      />,
    );

    const reference = getByTestId('net-worth-line-reference');
    expect(reference.props.y1).toBe(reference.props.y2);
    expect(reference.props.y1).toBeCloseTo(height / 2, 0);
  });

  it('renders about four Y-axis tick labels spanning the value range', async () => {
    const { getByTestId, getByText } = await render(
      <NetWorthLine points={points} startReference={200} baseCurrency="USD" />,
    );

    expect(getByTestId('net-worth-line-tick-0')).toBeTruthy();
    expect(getByTestId('net-worth-line-tick-3')).toBeTruthy();
    // Sub-thousand extremes render in the compact base unit (grouped integer,
    // no suffix), not the full two-decimal money format.
    expect(getByText('$300')).toBeTruthy();
    expect(getByText('$100')).toBeTruthy();
  });

  it('renders a single Y tick for a flat series', async () => {
    const { queryByTestId, getByTestId } = await render(
      <NetWorthLine
        points={[
          { t: 1, amount: 5000 },
          { t: 2, amount: 5000 },
        ]}
        startReference={5000}
        baseCurrency="UAH"
      />,
    );

    expect(getByTestId('net-worth-line-tick-0')).toBeTruthy();
    expect(queryByTestId('net-worth-line-tick-1')).toBeNull();
  });

  it('renders one Y gridline per tick, each with a testID', async () => {
    const { getAllByTestId } = await render(
      <NetWorthLine
        points={[
          { t: 1, amount: 1000 },
          { t: 2, amount: 5000 },
        ]}
        startReference={1000}
        baseCurrency="UAH"
      />,
    );

    const gridlines = getAllByTestId(/^net-worth-line-y-grid-/);

    expect(gridlines).toHaveLength(4);

    const ys = gridlines.map((line) => Number(line.props.y1));

    // Top tick (max) draws at the smallest y; the set is strictly monotonic.
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(new Set(ys).size).toBe(4);
  });

  it('renders a single Y gridline for a flat series', async () => {
    const { getAllByTestId } = await render(
      <NetWorthLine points={[{ t: 1, amount: 5000 }]} startReference={5000} baseCurrency="UAH" />,
    );

    expect(getAllByTestId(/^net-worth-line-y-grid-/)).toHaveLength(1);
  });

  it('labels the Y-axis in a compact unit chosen from the spread — grouped thousands when values are close together', async () => {
    // A narrow ~1.2M–1.3M band: at millions with one decimal the ticks would
    // collide (1.3M, 1.3M, 1.2M, 1.2M), so the axis drops to grouped thousands
    // where every label stays distinct.
    const closePoints: NetWorthPoint[] = [
      { t: 0, amount: 1_200_000 },
      { t: 86_400_000, amount: 1_300_000 },
    ];
    const { getByText } = await render(
      <NetWorthLine points={closePoints} startReference={1_250_000} baseCurrency="USD" />,
    );

    expect(getByText('$1,300K')).toBeTruthy();
    expect(getByText('$1,200K')).toBeTruthy();
  });

  it('labels the Y-axis in millions when the values are far apart', async () => {
    const farPoints: NetWorthPoint[] = [
      { t: 0, amount: 200_000 },
      { t: 86_400_000, amount: 1_500_000 },
    ];
    const { getByText } = await render(
      <NetWorthLine points={farPoints} startReference={800_000} baseCurrency="USD" />,
    );

    // The y-domain is anchored symmetrically on startReference (800K): the half
    // range is max(|1.5M - 800K|, |800K - 200K|) = 700K, so the axis spans
    // [100K, 1.5M]. The top tick is the data max (1.5M) and the bottom tick is
    // the anchored min (100K = $0.1M), not the raw data min — both still render
    // in the millions unit, which is what this test guards.
    expect(getByText('$1.5M')).toBeTruthy();
    expect(getByText('$0.1M')).toBeTruthy();
  });

  it('offsets the X-axis label track past the Y-axis column so the dates line up with the plot (G5)', async () => {
    const { getByTestId } = await render(
      <NetWorthLine points={points} startReference={200} baseCurrency="USD" />,
    );

    const yAxisWidth = styleLayers(getByTestId('net-worth-line-y-axis').props.style)
      .map((layer) => layer.width)
      .find((value): value is number => typeof value === 'number');
    // The label row mirrors the plot row: a spacer exactly the Y-axis column's
    // width, then a column gap, then the flex:1 track — so the track starts at the
    // plot's left edge instead of being pushed over by a bare marginLeft (which
    // gave the absolute labels no definite width to resolve their percent against).
    const spacerWidth = styleLayers(getByTestId('net-worth-line-x-axis-spacer').props.style)
      .map((layer) => layer.width)
      .find((value): value is number => typeof value === 'number');
    const rowGap = styleLayers(getByTestId('net-worth-line-x-axis-labels').props.style)
      .map((layer) => layer.columnGap)
      .find((value): value is number => typeof value === 'number');

    expect(yAxisWidth).toBeGreaterThan(0);
    expect(spacerWidth).toBe(yAxisWidth);
    expect(rowGap).toBe(darkTheme.spacing(2));
  });

  it('spreads the intermediate X-axis date labels across distinct horizontal positions', async () => {
    const { getByTestId } = await render(
      <NetWorthLine points={points} startReference={200} baseCurrency="USD" />,
    );

    // Each interior label is pinned under its own gridline by a percentage `left`
    // — the three must land at three DISTINCT positions, not collapse onto one x.
    const lefts = ['0.25', '0.50', '0.75'].map((key) => {
      const left = styleLayers(getByTestId(`net-worth-line-x-tick-${key}`).props.style)
        .map((layer) => layer.left)
        .find((value) => value !== undefined);

      return left;
    });

    expect(new Set(lefts).size).toBe(3);
    for (const left of lefts) {
      // A non-zero percentage string, so no interior label sits at the track's
      // left edge (the collapse this guards against rendered them all there).
      expect(typeof left).toBe('string');
      expect(left).toMatch(/%$/);
      expect(left).not.toBe('0%');
    }

    // The two range extremes stay flush to their own edges — start left, end
    // right — rather than both pinning to one side (the `leftPercent === 0` bug).
    const startStyle = styleLayers(getByTestId('net-worth-line-x-tick-0.00').props.style);
    const endStyle = styleLayers(getByTestId('net-worth-line-x-tick-1.00').props.style);
    expect(startStyle.map((layer) => layer.left).find((value) => value !== undefined)).toBe(0);
    expect(endStyle.map((layer) => layer.right).find((value) => value !== undefined)).toBe(0);
  });

  // Regression guard (NEW-1): the "tomorrow as the end date" symptom exists only
  // on `main`, where the range bounds were UTC-anchored (an inline `startOfLocalDay`
  // returning `Date.UTC(...)` plus a fixed `+ DAY_MS - 1`). On this branch the
  // range is built from `startOfLocalDay`/`endOfLocalDay` (`src/dates/local-day.ts`),
  // which return TRUE LOCAL instants — a local midnight and a local end-of-day —
  // so the chart's bucket `t` values are true-local, and formatting them in the
  // device-local zone (the shipped `formatAxisTime`) already reads the picked
  // calendar day. This guard drives points through the real range-bound helpers
  // in a positive-offset zone (Europe/Kyiv, UTC+) and asserts the start and end
  // ticks read the picked days — proving the bug is already fixed here and
  // catching a regression (e.g. a stray `timeZone: 'UTC'` on `formatAxisTime`)
  // that would shift the start tick a day back. It is a guard, not a TDD
  // RED->GREEN fix: no source change is needed on this branch. Node re-reads TZ
  // per Date op, so pinning it for the render is enough even when the host runs
  // in UTC.
  it('labels the X-axis extremes with the picked local calendar days in a positive-offset zone (NEW-1)', async () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'Europe/Kyiv';
    try {
      // The real range bounds a Sep 5 -> Sep 7 2026 pick produces on-device.
      const fromT = startOfLocalDay(new Date(2026, 8, 5).getTime());
      const toT = endOfLocalDay(new Date(2026, 8, 7).getTime());
      const rangePoints: NetWorthPoint[] = [
        { t: fromT, amount: 100 },
        { t: startOfLocalDay(new Date(2026, 8, 6).getTime()), amount: 300 },
        { t: toT, amount: 200 },
      ];
      const { getByTestId } = await render(
        <NetWorthLine points={rangePoints} startReference={200} baseCurrency="USD" />,
      );

      expect(getByTestId('net-worth-line-x-tick-0.00')).toHaveTextContent('Sep 5');
      expect(getByTestId('net-worth-line-x-tick-1.00')).toHaveTextContent('Sep 7');
    } finally {
      if (originalTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTz;
      }
    }
  });

  // Crossing data at the component level: net worth starts ABOVE the start
  // reference (250 > 200), dips BELOW it (150 < 200), then returns above (250) —
  // so both the green and the red area are non-empty. This is the exact shape
  // whose red region failed to render on device under the old ClipPath approach.
  const crossingPoints: NetWorthPoint[] = [
    { t: 0, amount: 250 },
    { t: 1, amount: 150 },
    { t: 2, amount: 250 },
  ];

  it('fills two CLAMPED gradient areas anchored to the reference baseline, with no clip path', async () => {
    const height = 200;
    const { getByTestId } = await render(
      <NetWorthLine
        points={crossingPoints}
        startReference={200}
        baseCurrency="USD"
        height={height}
      />,
    );

    // referenceY is where the dashed baseline sits; baselineY is the chart bottom
    // (height - PADDING_Y). Each area closes to the FORMER, not the latter.
    const referenceY = getByTestId('net-worth-line-reference').props.y1;
    const baselineY = height - 12;
    expect(referenceY).not.toBe(baselineY);

    const positive = getByTestId('net-worth-line-area-positive');
    const negative = getByTestId('net-worth-line-area-negative');

    // The two paths are now DISTINCT: each is the line clamped to its own side of
    // the reference, not one shared path split by a clip.
    expect(positive.props.d).not.toBe(negative.props.d);
    expect(positive.props.d.startsWith('M ')).toBe(true);
    expect(negative.props.d.startsWith('M ')).toBe(true);

    // Each closes to referenceY under the last x and back under the first x —
    // never to the chart bottom.
    expect(positive.props.d.trimEnd().endsWith(`,${referenceY} Z`)).toBe(true);
    expect(negative.props.d.trimEnd().endsWith(`,${referenceY} Z`)).toBe(true);
    expect(positive.props.d).not.toContain(`,${baselineY}`);
    expect(negative.props.d).not.toContain(`,${baselineY}`);

    // Green: every vertex is clamped to at most referenceY (above the baseline,
    // smaller-or-equal y), so it never bleeds into the red region below.
    for (const y of pathYs(positive.props.d)) {
      expect(y).toBeLessThanOrEqual(referenceY);
    }
    // Red: every vertex is clamped to at least referenceY (below the baseline,
    // larger-or-equal y), so it never bleeds into the green region above.
    for (const y of pathYs(negative.props.d)) {
      expect(y).toBeGreaterThanOrEqual(referenceY);
    }
    // Both non-degenerate for the crossing data: green genuinely reaches above
    // the reference, red genuinely reaches below it.
    expect(pathYs(positive.props.d).some((y) => y < referenceY)).toBe(true);
    expect(pathYs(negative.props.d).some((y) => y > referenceY)).toBe(true);

    // Filled from the gradients, no stroke, and — the fix — NO clipPath at all.
    expect(positive.props.stroke).toBe('none');
    expect(positive.props.fill).toBe('url(#net-worth-line-gradient-positive)');
    expect(negative.props.fill).toBe('url(#net-worth-line-gradient-negative)');
    expect(positive.props.clipPath).toBeUndefined();
    expect(negative.props.clipPath).toBeUndefined();
  });

  it('renders no ClipPath or clip primitives any more (the device-broken approach is gone)', async () => {
    const { queryByTestId } = await render(
      <NetWorthLine points={crossingPoints} startReference={200} baseCurrency="USD" height={200} />,
    );

    expect(queryByTestId('net-worth-line-clip-above')).toBeNull();
    expect(queryByTestId('net-worth-line-clip-below')).toBeNull();
    expect(queryByTestId('net-worth-line-clip-above-rect')).toBeNull();
    expect(queryByTestId('net-worth-line-clip-below-rect')).toBeNull();
  });

  it('fades each gradient to transparent at the reference baseline, green above / red below', async () => {
    const { getByTestId } = await render(
      <NetWorthLine points={points} startReference={200} baseCurrency="USD" />,
    );

    // stopOpacity is set EXPLICITLY per kiko-charts (native masks rgba alpha):
    // opaque near the line, fully transparent AT the reference baseline. Colors
    // are the theme tokens, applied as hex stopColor.
    const posLine = getByTestId('net-worth-line-gradient-positive-stop-line');
    const posRef = getByTestId('net-worth-line-gradient-positive-stop-reference');
    expect(posLine.props.stopColor).toBe(darkTheme.colors.positive);
    expect(posLine.props.stopOpacity).toBeGreaterThan(0);
    expect(posRef.props.stopColor).toBe(darkTheme.colors.positive);
    expect(posRef.props.stopOpacity).toBe(0);

    const negLine = getByTestId('net-worth-line-gradient-negative-stop-line');
    const negRef = getByTestId('net-worth-line-gradient-negative-stop-reference');
    expect(negLine.props.stopColor).toBe(darkTheme.colors.negative);
    expect(negLine.props.stopOpacity).toBeGreaterThan(0);
    expect(negRef.props.stopColor).toBe(darkTheme.colors.negative);
    expect(negRef.props.stopOpacity).toBe(0);
  });

  it('anchors each gradient to the ACTUAL filled band, not the whole plot half', async () => {
    const height = 200;
    const { getByTestId, getAllByTestId } = await render(
      <NetWorthLine
        points={crossingPoints}
        startReference={200}
        baseCurrency="USD"
        height={height}
      />,
    );

    const referenceY = getByTestId('net-worth-line-reference').props.y1;
    const baselineY = height - 12;
    const ys = allSegmentYs(getAllByTestId(/^net-worth-line-polyline-/));
    // greenTopY: the highest pixel (smallest y) among points at or above the
    // reference. redBottomY: the lowest pixel (largest y) among points at or
    // below it. These are the true filled-band extremes the component anchors to.
    const greenTopY = Math.min(...ys.filter((y) => y <= referenceY));
    const redBottomY = Math.max(...ys.filter((y) => y >= referenceY));

    const posGrad = getByTestId('net-worth-line-gradient-positive');
    const negGrad = getByTestId('net-worth-line-gradient-negative');

    // Green ramps greenTopY (opaque) -> referenceY (transparent); red ramps
    // referenceY (transparent) -> redBottomY (opaque).
    expect(Number(posGrad.props.y1)).toBeCloseTo(greenTopY);
    expect(Number(posGrad.props.y2)).toBeCloseTo(referenceY);
    expect(Number(negGrad.props.y1)).toBeCloseTo(referenceY);
    expect(Number(negGrad.props.y2)).toBeCloseTo(redBottomY);

    // NOT the old whole-plot extents (PADDING_Y at the top, baselineY at the
    // bottom) — the ramp is compressed into the filled sliver.
    expect(Number(posGrad.props.y1)).not.toBeCloseTo(12);
    expect(Number(negGrad.props.y2)).not.toBeCloseTo(baselineY);
  });

  it('keeps a SHALLOW dip readable: the red opaque stop lands at redBottomY, not the plot bottom', async () => {
    const height = 200;
    // Starts above, dips only SLIGHTLY below the reference (199 vs 200), returns
    // above. Under the old whole-plot ramp this dip sat where red opacity ~ 0.
    const shallow: NetWorthPoint[] = [
      { t: 0, amount: 250 },
      { t: 1, amount: 199 },
      { t: 2, amount: 250 },
    ];
    const { getByTestId, getAllByTestId } = await render(
      <NetWorthLine points={shallow} startReference={200} baseCurrency="USD" height={height} />,
    );

    const referenceY = getByTestId('net-worth-line-reference').props.y1;
    const baselineY = height - 12;
    const ys = allSegmentYs(getAllByTestId(/^net-worth-line-polyline-/));
    const redBottomY = Math.max(...ys.filter((y) => y >= referenceY));

    const negGrad = getByTestId('net-worth-line-gradient-negative');
    expect(Number(negGrad.props.y1)).toBeCloseTo(referenceY);
    expect(Number(negGrad.props.y2)).toBeCloseTo(redBottomY);

    // The band is a SMALL sliver just below the reference — nowhere near the
    // plot bottom, so the opaque stop is close to the reference where the dip
    // actually is (this is what makes a shallow dip visibly red).
    expect(redBottomY).toBeGreaterThan(referenceY);
    expect(redBottomY).toBeLessThan(baselineY);
    expect(redBottomY - referenceY).toBeLessThan((baselineY - referenceY) / 2);

    // The opaque stop is pinned at redBottomY (offset 1). Tests render on the
    // default (dark) theme — see unistyles.ts — where the red/negative stop
    // is boosted to 0.5 (not the shared 0.3 green/positive uses) so the fill
    // still reads clearly composited over OLED true-black; see
    // NEGATIVE_AREA_OPACITY_DARK in net-worth-line.component.tsx.
    const negLine = getByTestId('net-worth-line-gradient-negative-stop-line');
    expect(negLine.props.offset).toBe('1');
    expect(negLine.props.stopOpacity).toBe(0.5);
  });

  it('renders NO red path or gradient when every point is above the reference (empty band)', async () => {
    const allAbove: NetWorthPoint[] = [
      { t: 0, amount: 250 },
      { t: 1, amount: 260 },
      { t: 2, amount: 255 },
    ];
    const { getByTestId, queryByTestId } = await render(
      <NetWorthLine points={allAbove} startReference={200} baseCurrency="USD" height={200} />,
    );

    // Green band is present; red band is empty, so its Path AND gradient are
    // both omitted (no degenerate zero-height gradient).
    expect(getByTestId('net-worth-line-area-positive')).toBeTruthy();
    expect(getByTestId('net-worth-line-gradient-positive')).toBeTruthy();
    expect(queryByTestId('net-worth-line-area-negative')).toBeNull();
    expect(queryByTestId('net-worth-line-gradient-negative')).toBeNull();
  });

  // R5-D (exploratory — kept as one cohesive block in the component, so it
  // reverts in a single edit if dropped): the stroke is no longer a single
  // fixed white polyline — it is sign-colored per contiguous segment,
  // matching the fill's own green-above/red-below convention.
  it('colors the net-worth stroke by sign per segment, not a fixed white', async () => {
    const { getAllByTestId } = await render(
      <NetWorthLine points={crossingPoints} startReference={200} baseCurrency="USD" height={200} />,
    );

    const segments = getAllByTestId(/^net-worth-line-polyline-/);
    // crossingPoints goes above -> below -> above (see its own comment
    // above), so it crosses TWICE: three contiguous same-sign segments,
    // colored green/red/green — the same theme tokens the fill uses.
    expect(segments).toHaveLength(3);
    expect(segments[0].props.stroke).toBe(darkTheme.colors.positive);
    expect(segments[1].props.stroke).toBe(darkTheme.colors.negative);
    expect(segments[2].props.stroke).toBe(darkTheme.colors.positive);
    expect(segments[0].props.fill).toBe('none');

    // Every segment keeps the SAME stroke width the single polyline used to
    // (LINE_STROKE_WIDTH is not exported; consistency across segments is
    // the observable contract for "preserve the current stroke width").
    const widths = new Set(segments.map((segment) => segment.props.strokeWidth));
    expect(widths.size).toBe(1);

    // Each segment CONNECTS to the next at the exact same vertex — the last
    // "x,y" of one segment equals the first "x,y" of the next — so the
    // stroke still reads as one continuous line, not disjoint dashes.
    const lastVertexOf = (raw: string): string => raw.trim().split(' ').at(-1) as string;
    const firstVertexOf = (raw: string): string => raw.trim().split(' ').at(0) as string;
    expect(lastVertexOf(segments[0].props.points)).toBe(firstVertexOf(segments[1].props.points));
    expect(lastVertexOf(segments[1].props.points)).toBe(firstVertexOf(segments[2].props.points));
  });

  it('splits the stroke at the SAME crossing x the fill uses, so line and fill agree (R5-D)', async () => {
    const { getAllByTestId, getByTestId } = await render(
      <NetWorthLine points={crossingPoints} startReference={200} baseCurrency="USD" height={200} />,
    );

    const referenceY = getByTestId('net-worth-line-reference').props.y1;
    const segments = getAllByTestId(/^net-worth-line-polyline-/);
    // The stroke's split vertex (end of segment 0 / start of segment 1) sits
    // exactly at referenceY, the boundary every crossing vertex rides.
    const splitVertex = segments[0].props.points.trim().split(' ').at(-1) as string;
    const [splitX, splitY] = splitVertex.split(',');
    expect(Number(splitY)).toBeCloseTo(referenceY);

    // The fill's negative area path inserts a vertex at the IDENTICAL x —
    // both toAreaPath and buildLineSegments compute it with the exact same
    // formula from the exact same x1/y1/x2/y2/referenceY, so the rendered
    // string is bit-identical, not just numerically close.
    const negativeAreaD: string = getByTestId('net-worth-line-area-negative').props.d;
    expect(negativeAreaD).toContain(`${splitX},${referenceY}`);
  });

  it('reserves a fixed-width Y-axis column so its value labels are fully visible', async () => {
    const { getByTestId } = await render(
      <NetWorthLine points={points} startReference={200} baseCurrency="USD" />,
    );

    const width = styleLayers(getByTestId('net-worth-line-y-axis').props.style)
      .map((layer) => layer.width)
      .find((value): value is number => typeof value === 'number');

    expect(width).toBeGreaterThan(0);
  });

  it('labels the X axis at evenly spaced intermediate dates, not just the endpoints', async () => {
    const { getByTestId } = await render(
      <NetWorthLine points={points} startReference={200} baseCurrency="USD" />,
    );

    // Five ticks: the two range extremes plus three interior dates, so the axis
    // reads as a timeline rather than only its first/last dates.
    for (const key of ['0.00', '0.25', '0.50', '0.75', '1.00']) {
      expect(getByTestId(`net-worth-line-x-tick-${key}`)).toBeTruthy();
    }
  });

  it('drops a thin vertical gridline from each intermediate date to the plot', async () => {
    const { getByTestId, queryByTestId } = await render(
      <NetWorthLine points={points} startReference={200} baseCurrency="USD" />,
    );

    // The three interior dates each get a gridline; the two extremes ARE the
    // plot's own left/right edges, so they get no extra line.
    for (const key of ['0.25', '0.50', '0.75']) {
      const grid = getByTestId(`net-worth-line-x-grid-${key}`);
      // Vertical: one x, dropping from the plot's top down toward its baseline.
      expect(grid.props.x1).toBe(grid.props.x2);
      expect(grid.props.y1).toBeLessThan(grid.props.y2);
    }

    expect(queryByTestId('net-worth-line-x-grid-0.00')).toBeNull();
    expect(queryByTestId('net-worth-line-x-grid-1.00')).toBeNull();
  });

  it('collapses the X axis to a single date when every point shares one instant', async () => {
    // A single-instant range has no time span, so the evenly spaced ticks would
    // all stack on the same x — it falls back to one start-edge date label with
    // no interior gridlines.
    const onePoint: NetWorthPoint[] = [{ t: 172_800_000, amount: 200 }];
    const { getByTestId, queryByTestId } = await render(
      <NetWorthLine points={onePoint} startReference={200} baseCurrency="USD" />,
    );

    expect(getByTestId('net-worth-line-x-tick-0.00')).toBeTruthy();
    expect(queryByTestId('net-worth-line-x-tick-0.25')).toBeNull();
    expect(queryByTestId('net-worth-line-x-grid-0.25')).toBeNull();
  });

  it('renders a loading state when loading with no points yet', async () => {
    const { getByTestId, queryByTestId } = await render(
      <NetWorthLine points={[]} startReference={0} baseCurrency="USD" loading />,
    );

    expect(getByTestId('net-worth-line-loading')).toBeTruthy();
    expect(queryByTestId(/^net-worth-line-polyline-/)).toBeNull();
  });

  it('renders an empty state when there are no points and not loading', async () => {
    const { getByTestId, queryByTestId } = await render(
      <NetWorthLine points={[]} startReference={0} baseCurrency="USD" />,
    );

    expect(getByTestId('net-worth-line-empty')).toBeTruthy();
    expect(queryByTestId(/^net-worth-line-polyline-/)).toBeNull();
  });

  // Regression: the loading placeholder used to be a short spinner box that
  // grew ~135px once the loaded chart replaced it, jumping the Charts screen's
  // content height above the viewport mid-render and interrupting the OS's
  // native scroll-to-top (tapping the active tab). The placeholder must now
  // reserve the SAME total height the loaded chart occupies for a given plot
  // height, so no post-mount height change ever occurs.
  it('reserves the same total height in the loading state as the loaded chart', async () => {
    const height = 200;

    const { getByTestId: getByTestIdLoading } = await render(
      <NetWorthLine points={[]} startReference={0} baseCurrency="USD" loading height={height} />,
    );
    const loadingHeight = styleLayers(getByTestIdLoading('net-worth-line-loading').props.style)
      .map((layer) => layer.height)
      .find((value): value is number => typeof value === 'number');

    const { getByTestId: getByTestIdLoaded } = await render(
      <NetWorthLine points={points} startReference={200} baseCurrency="USD" height={height} />,
    );
    // The loaded chart's total footprint: the plot row's height, plus the
    // container's rowGap, plus the X-axis label row's height below it.
    const plotHeight = styleLayers(getByTestIdLoaded('net-worth-line-y-axis').props.style)
      .map((layer) => layer.height)
      .find((value): value is number => typeof value === 'number');
    const rowGap = styleLayers(getByTestIdLoaded('net-worth-line-x-axis-labels').props.style)
      .map((layer) => layer.columnGap)
      .find((value): value is number => typeof value === 'number');
    const xAxisTrackHeight = darkTheme.typography.caption.fontSize + darkTheme.spacing(1);
    const loadedTotalHeight = (plotHeight ?? 0) + (rowGap ?? 0) + xAxisTrackHeight;

    expect(loadingHeight).toBeGreaterThan(0);
    expect(loadingHeight).toBe(loadedTotalHeight);
  });

  it('reserves the same total height in the empty state as the loaded chart', async () => {
    const height = 200;

    const { getByTestId: getByTestIdEmpty } = await render(
      <NetWorthLine points={[]} startReference={0} baseCurrency="USD" height={height} />,
    );
    const emptyHeight = styleLayers(getByTestIdEmpty('net-worth-line-empty').props.style)
      .map((layer) => layer.height)
      .find((value): value is number => typeof value === 'number');

    const { getByTestId: getByTestIdLoading } = await render(
      <NetWorthLine points={[]} startReference={0} baseCurrency="USD" loading height={height} />,
    );
    const loadingHeight = styleLayers(getByTestIdLoading('net-worth-line-loading').props.style)
      .map((layer) => layer.height)
      .find((value): value is number => typeof value === 'number');

    expect(emptyHeight).toBe(loadingHeight);
  });
});
