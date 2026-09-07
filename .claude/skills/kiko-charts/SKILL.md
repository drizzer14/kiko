---
name: kiko-charts
description: Invoke when touching a react-native-svg chart component (BarChart, PieChart, NetWorthLine), adding a new chart, changing a chart's testID, or debugging a chart test failure. Read before drawing an SVG primitive, adding a scale/tick builder, or editing __mocks__/react-native-svg.tsx.
---

# Kiko chart conventions

Source files: `src/design-system/components/bar-chart/`,
`src/design-system/components/pie-chart/`,
`src/design-system/components/net-worth-line/`, and the manual mock at
`__mocks__/react-native-svg.tsx`.

## Fixed logical coordinate space + stretch-to-fit

Every chart computes its geometry in a **fixed logical width**
(`net-worth-line.component.tsx`'s `VIEW_WIDTH` constant — read its current
value in that file, do not copy a stale number here) rather than the
container's real pixel width. The `<Svg>` is then rendered with
`width="100%"` and `viewBox="0 0 <VIEW_WIDTH> <height>"` plus
`preserveAspectRatio="none"`, which stretches that fixed logical space to
fill whatever width the container actually lays out at. This means every
scale/tick builder (`buildScales`, `buildTicks`, `buildXTicks`, and
`bar-chart`/`pie-chart`'s equivalents) works in the same fixed logical
units regardless of device width — do not read `Dimensions` or a layout
`onLayout` width inside a chart's geometry math.

## Hand-rolled scale/tick builders

There is no charting library — `buildScales`/`buildTicks`/`buildXTicks`
in `net-worth-line.component.tsx` are hand-rolled. Read that file for
their current shape before extending or copying the pattern to a new
chart; it is the most complete example in the app and includes:

- a Y-axis tick set (`buildTicks`) spread evenly across the y-domain,
  which `buildScales` and `buildTicks` both anchor SYMMETRICALLY on
  `startReference` (`[startReference ± halfRange]`, where `halfRange` is
  the larger distance from the reference to either data extreme) rather
  than tightly auto-fitting the data's own min/max — so the dashed
  baseline holds a STABLE centred position and a dip below it renders
  proportionally instead of the baseline flipping from domain-min to
  domain-max (teleporting across the plot) the instant net worth crosses
  the reference; drawn with a narrow, fixed-width label column
  (`net-worth-line.styles.ts`'s `Y_AXIS_WIDTH_UNITS`) sized for a compact
  money string (`adjustsFontSizeToFit`), not the widest possible label —
  the column is deliberately narrow so it does not steal plot width — plus
  a FLAT-range collapse case (every amount equal to `startReference`, e.g.
  a single point or a balance that never moved) that returns just one tick
  instead of spreading `TICK_COUNT` ticks across a zero-width range, which
  would otherwise draw every label and every Y gridline on top of each
  other at the same y;
- an X-axis (time) tick set (`buildXTicks`) with intermediate date labels
  between the two range extremes, each pinned under its own vertical
  gridline by a percentage `left` offset computed from the same `x()`
  scale the plotted line uses, plus a single-instant collapse case (one
  point, or every point at the same time) that returns just the start
  label instead of stacking every date at the same x;
- vertical gridlines for the interior X ticks, drawn in the same `<Svg>`
  alongside the horizontal Y gridlines, so the plot reads as a real grid
  rather than only horizontal bands.

A new chart with its own axis should follow this same split: a pure
`buildScales`/`buildTicks` function returning plain data (never JSX), then
a render pass that maps that data onto SVG primitives.

## `testID` scheme per SVG primitive, and why

Every SVG primitive a chart renders — a `<Rect>` bar, a `<Path>` arc, a
`<Polyline>`, a `<Line>` gridline, a `<Stop>` gradient stop — carries a
`testID`. This is not decorative: `react-native-svg`'s real package
cannot run under Jest (see the next section), so the only way a test can
assert a chart's computed geometry (a bar's `width`, an arc's `fill`, a
polyline's `points`) is to look the element up by `testID` through the
manual mock and read its props back. A chart primitive with no `testID`
is untestable geometry — always add one when adding a new primitive,
following the existing `<chart-name>-<primitive>[-<key>]` naming (e.g.
`bar-chart-bar-card`, `net-worth-line-x-grid-0.25`).

## Adding a new chart requires extending the mock

`__mocks__/react-native-svg.tsx` is a manual Jest mock, picked up
automatically (no `jest.mock()` call needed) because the real package's
`"react-native"` package.json export condition resolves to untransformed
TypeScript source, and its elements are native host views with no
software renderer under `react-test-renderer` anyway. It re-exports every
`react-native-svg` primitive the app currently imports as the same
passthrough `View`-wrapping component. **A new chart that imports a
primitive not yet in this mock's export list (e.g. `Circle` is exported
but unused today, so it is a template for the next one) will fail to
render under Jest** — extend `__mocks__/react-native-svg.tsx` with the
new primitive in the same passthrough style before writing the chart's
test, not after chasing a mysterious render failure.

## An SVG gradient, if one is ever needed again

`GlassSurface` no longer uses an SVG gradient for its entity-color wash —
it renders one flat `entityCardBackground` color as a plain `View`
`backgroundColor` (see `kiko-design-system`'s "Entity color and tint"),
so there is currently no `<LinearGradient>` usage anywhere in the app to
follow as a template. If a future chart genuinely needs an SVG gradient,
the general `react-native-svg` shape is: an absolutely-positioned,
`pointerEvents="none"` `<Svg>` containing a `<Defs><LinearGradient
id="..."><Stop .../><Stop .../></LinearGradient></Defs>` plus a single
`<Rect fill="url(#...)" />` sized to `100%`/`100%`, with each `<Stop>`
carrying its own `testID` suffix so a test can assert the resolved stop
color without touching native SVG internals — the same
`testID`-per-primitive rule as the charts above. Remember to set
`stopOpacity` explicitly from whatever opacity value you intend: the
native gradient extractor masks off any alpha embedded in an rgba()
`stopColor` and substitutes `stopOpacity` (defaulting to fully opaque)
instead, so an rgba() color alone silently renders fully opaque.

## Legend percent labels sum to 100

`pie-chart.component.tsx`'s legend column never rounds a slice's share
independently (`Math.round(share * 100)` per slice can sum to 99 or 101
across a set). `allocatePercents` computes the whole set's integer labels
at once by largest-remainder (Hare quota) allocation, so the column under
the ring always sums to exactly 100 (or 0 for an empty set). Read that
function for the tie-break rule before touching legend percent rendering.

## category-trend-line (spending trend by category)

`CategoryTrendLine`
(`src/design-system/components/category-trend-line/category-trend-line.component.tsx`)
is the "Spending Trend by Category" chart: a multi-line plot, one
`<Polyline>` per category, each point that category's total EXPENSE
inside one calendar-month bucket (a per-period figure, never
cumulative), in the base currency's MAJOR units.

The builder, `buildCategoryTrend`
(`src/statistics/category-trend.ts`), reuses the donut's exact
expense/exclusion/default-fold/conversion rules — see
`category-breakdown.ts` (`buildCategoryBreakdown`) rather than
restating them here — and resolves each line's color the same way the
donut does, via `resolveCategoryColor`. It buckets every kept expense
by UTC calendar month, zero-fills every month in the earliest-to-latest
span for every series so all lines share one set of X positions even
where a category had no spend in a given month, and sorts the returned
series by total spend descending.

The component follows this file's "Fixed logical coordinate space" and
"Hand-rolled scale/tick builders" conventions above, mirroring
`net-worth-line`'s `VIEW_WIDTH` + `preserveAspectRatio="none"` +
hand-rolled `buildScales`/`buildTicks`/`buildXTicks` split — but its
Y-scale is rooted at 0 with headroom only above the peak, not anchored
to a start-value reference baseline the way `net-worth-line`'s is,
since spending has no natural reference point to diff against.

Its `testID`-per-primitive scheme (see "testID scheme per SVG
primitive" above for why): `category-trend-line-line-<key>` (one
`<Polyline>` per series), `category-trend-line-y-grid-<index>` and
`category-trend-line-x-grid-<fraction>` (gridlines),
`category-trend-line-legend-<key>` (one legend entry per series), and
`category-trend-line-empty` (the empty state when `series` is `[]`).

It needs no new entry in `__mocks__/react-native-svg.tsx` — it only
uses `Polyline`, `Line`, `G`, `Svg`, and `Text`, all already exported
by that mock.

Which categories the chart draws (e.g. a top-3-by-expense default) is
screen state owned by `statistics.screen.tsx`, not this component's
concern — `CategoryTrendLine` only renders whatever `series` array it
is given.

## PieChart donut mode

`PieChart` (`src/design-system/components/pie-chart/pie-chart.component.tsx`)
supports an `innerRatio` prop (thins the ring, opening a larger center
hole) and a `centerTotal` prop (a `Money` value rendered centered in
that hole) — the Expenses-by-Category donut is the current caller.
Read that file directly for the default ratio and exact prop shape
rather than trusting a restated number here.

## Reuse the entity-color system for fills

A chart fill color is never a chart-local palette. `bar-chart` fills each
bar with `defaultHoldingColor[type]` (via `resolveEntityColor` where a
per-entity override exists); `pie-chart` colors each donut wedge and its
legend swatch with the same slice's resolved entity color. See
`kiko-design-system`'s "Entity color and tint" section for the full color
pipeline (`defaultAccountColor`/`defaultHoldingColor`,
`resolveEntityColor`, `entityCardBackground`) — a new chart follows the
same pipeline rather than inventing its own color set, so a swatch in a
chart legend always matches that same entity's color everywhere else in
the app (its card, its icon tint).
