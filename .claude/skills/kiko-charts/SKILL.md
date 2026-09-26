---
name: kiko-charts
description: Invoke when touching a react-native-svg chart component (BarChart, PieChart, NetWorthLine), adding a new chart, changing a chart's testID, or debugging a chart test failure. Read before drawing an SVG primitive, adding a scale/tick builder, or editing __mocks__/react-native-svg.tsx.
---

# Kiko chart conventions

Source files: `src/screens/statistics/bar-chart/`,
`src/screens/statistics/pie-chart/`,
`src/screens/statistics/net-worth-line/`,
`src/screens/statistics/category-trend-line/`, and the manual mock at
`__mocks__/react-native-svg.tsx`.

## Fixed logical coordinate space + stretch-to-fit

Every chart computes its geometry in a **fixed logical width**
(`net-worth-line.component.tsx`'s `VIEW_WIDTH` constant — read its current
value in that file, do not copy a stale number here) rather than the
container's real pixel width. The `<Svg>` is then rendered with
`width="100%"` and `viewBox="0 0 <VIEW_WIDTH> <height>"` plus
`preserveAspectRatio="none"`, which stretches that fixed logical space to
fill whatever width the container actually lays out at. This means every
scale/tick builder (`buildScales`, `buildTicks`,
`buildXGridTicks`/`buildXLabelTicks`, and `bar-chart`/`pie-chart`'s
equivalents) works in the same fixed logical units regardless of device
width — do not read `Dimensions` or a layout `onLayout` width inside a
chart's geometry math.

## Hand-rolled scale/tick builders

There is no charting library —
`buildScales`/`buildTicks`/`buildXGridTicks`/`buildXLabelTicks` in
`net-worth-line.component.tsx` are hand-rolled. Read that file for
their current shape before extending or copying the pattern to a new
chart; it is the most complete example in the app and includes:

- a Y-axis tick set (`buildTicks`) spread evenly across the y-domain,
  which `buildScales` and `buildTicks` both take as
  `[niceFloor(minValue), maxValue]` — the net worth's OWN minimum
  (floored to a nearby round number via `niceFloor`/`niceStep`) up to its
  own maximum, where `minValue`/`maxValue` span the plotted amounts AND
  the `startReference` (so the dashed baseline always stays on-screen and
  the floor can never sit above it). This REPLACED an earlier symmetric
  `[startReference ± halfRange]` domain, which pushed the bottom far below
  the data whenever net worth sat mostly above the range start, so the
  line hugged the top and the lower half of the plot went to waste. The
  trade-off: the dashed baseline is no longer pinned to the plot centre —
  it now sits at its true value position (near the bottom when it is the
  series minimum, near the top when it is the maximum). The floor step is
  a nice 1/2/5/10×10^k increment of about `VALUE_PADDING_RATIO` of the
  span, so the bottom is a clean figure at most one step below the
  minimum; drawn with a narrow, fixed-width label column
  (`net-worth-line.styles.ts`'s `Y_AXIS_WIDTH_UNITS`) sized for a compact
  money string (`adjustsFontSizeToFit`), not the widest possible label —
  the column is deliberately narrow so it does not steal plot width — plus
  a FLAT-range collapse case (`maxValue === minValue` — every amount and
  the reference equal, e.g. a single point or a balance that never moved)
  that returns just one tick
  instead of spreading `TICK_COUNT` ticks across a zero-width range, which
  would otherwise draw every label and every Y gridline on top of each
  other at the same y;
- an X-axis (time) tick set, DECOUPLED into two separate fraction sets
  built from one shared helper (`buildXTickSet`): `buildXGridTicks`
  (`X_GRID_FRACTIONS`) draws the interior vertical gridlines, while
  `buildXLabelTicks` (`X_LABEL_FRACTIONS`) places the date labels — read
  those constants in `net-worth-line.component.tsx` for their current
  fractions rather than a restated number here. Each interior label is
  pinned under its own x by a percentage `left` offset computed from the
  same `x()` scale the plotted line uses; both builders separately
  collapse a single-instant range (one point, or every point at the same
  time) — the labels to just the start label, the gridlines to none —
  instead of stacking every tick at the same x;
- vertical gridlines for the interior X ticks (`buildXGridTicks`), drawn
  in the same `<Svg>` alongside the horizontal Y gridlines, so the plot
  reads as a real grid rather than only horizontal bands, independent of
  however many date labels render below it.

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
`bar-chart-bar-card`, `net-worth-line-x-grid-0.50`).

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

## An SVG gradient template

`net-worth-line.component.tsx` and `EntityIconTile`
(`src/design-system/components/entity-icon-tile/`) both use a real
`react-native-svg` `<LinearGradient>` today — read either directly for
a working example before adding a new one. `GlassSurface`'s own
entity-color wash does not use an SVG gradient (see
`kiko-design-system`'s "Entity color and tint" — its content-layer
counterpart, `Card`/`EntityIconTile`, renders a flat resolved-hue
background instead). The general `react-native-svg` shape for a new
gradient: an absolutely-positioned,
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

## Net-worth stroke and area-fill opacity

The net-worth line's `<Polyline>` STROKE is a single fixed
`theme.colors.entityColors.white`, testID `net-worth-line-polyline` —
only the area FILL below/above the dashed `startReference` baseline is
sign-colored (green above, red below), via `toAreaPath`'s two clamped
paths. A sign-colored stroke was tried and reverted (decision-review
item 31): it added no readability the fill did not already give, and
duplicated `toAreaPath`'s crossing-x math in a second builder.

The red/negative area gradient uses a HIGHER opacity than the
green/positive one, not the same constant for both: alpha-compositing
a translucent color over the OLED true-black background
(`darkTheme.colors.background`, `#000000`) reads faint at an alpha
that would read fine over a lighter surface, so the negative band
needs more opacity to stay visibly legible against true black. Read
the `AREA_OPACITY`/`NEGATIVE_AREA_OPACITY` constants in
`net-worth-line.component.tsx` for the current values rather than
restating them here.

**T27 (spec §5.2, kiko-domain "Net worth"):** net worth can now go
negative (a debt outweighing assets), so the line can cross 0 — this
needed NO change to `NetWorthLine` itself: `toAreaPath` already splits
the fill on sign per crossing (above), which is exactly the "cross 0"
case. The Y axis already floors to the series' own minimum (whatever
that is, positive or negative), so a negative range draws correctly
with no separate floor-at-0 logic to remove.

## Legend percent labels sum to 100

`pie-chart.component.tsx`'s legend column never rounds a slice's share
independently (`Math.round(share * 100)` per slice can sum to 99 or 101
across a set). `allocatePercents` computes the whole set's integer labels
at once by largest-remainder (Hare quota) allocation, so the column under
the ring always sums to exactly 100 (or 0 for an empty set). Read that
function for the tie-break rule before touching legend percent rendering.

## category-trend-line (spending trend by category)

`CategoryTrendLine`
(`src/screens/statistics/category-trend-line/category-trend-line.component.tsx`)
is the "Spending Trend by Category" chart: a multi-line plot, one
`<Polyline>` per category, each point that category's total EXPENSE
inside one day-or-week bucket over the active Statistics date range (a
per-period figure, never cumulative), in the base currency's MAJOR
units.

The builder, `buildCategoryTrend`
(`src/statistics/category-trend/category-trend.ts`), reuses the donut's exact
expense/exclusion/default-fold/conversion rules — see
`category-breakdown.ts` (`buildCategoryBreakdown`) rather than
restating them here — and resolves each line's color the same way the
donut does, via `resolveCategoryColor`. It no longer buckets by
calendar month: it takes an explicit `range` (`{ from, to }`) and
`bucketDays`, and folds every kept expense into
`bucketTimes(range.from, range.to, bucketDays)` — the SAME bucket
positions `buildNetWorthSeries` plots for the same `range`/`bucketDays`
(see `src/statistics/buckets/`), so the trend chart honors the
Statistics screen's own date-range picker rather than a fixed span, and
zero-fills every bucket in that range for every series so all lines
share one set of X positions even where a category had no spend in a
given bucket. It sorts the returned series by total spend descending.
Read `bucketDaysForSpan` (`src/statistics/buckets/`, how the screen
picks day-vs-week bucketing from the active range) and `category-trend.ts`
itself for the exact bucket math rather than trusting a restated
cadence here.

The component follows this file's "Fixed logical coordinate space" and
"Hand-rolled scale/tick builders" conventions above, mirroring
`net-worth-line`'s `VIEW_WIDTH` + `preserveAspectRatio="none"` +
hand-rolled `buildScales`/`buildTicks`/`buildXGridTicks`/`buildXLabelTicks`
split — but its Y-scale is rooted at 0 with headroom only above the peak,
not anchored to a start-value reference baseline the way `net-worth-line`'s
is, since spending has no natural reference point to diff against. Its X
axis mirrors `net-worth-line`'s own DECOUPLED gridline/label split
(`X_GRID_FRACTIONS`/`buildXGridTicks` for the interior vertical gridlines,
`X_LABEL_FRACTIONS`/`buildXLabelTicks` for the date labels, both built
from a shared `buildXTickSet` helper) — read those constants in
`category-trend-line.component.tsx` for the current fractions rather than
a restated number here. It formats each label with the shared
`formatDayMonth` helper as a zero-padded numeric `DD.MM` (e.g. `01.01`),
read against LOCAL calendar fields — never a month name — since the
buckets are LOCAL-midnight instants (`bucketTimes` steps from the
screen's `startOfLocalDay` range start), matching `net-worth-line`'s own
`formatAxisTime` exactly.

Its `testID`-per-primitive scheme (see "testID scheme per SVG
primitive" above for why): `category-trend-line-line-<key>` (one
`<Polyline>` per series), `category-trend-line-y-grid-<index>` and
`category-trend-line-x-grid-<fraction>` (gridlines),
`category-trend-line-legend-<key>` (one legend entry per series), and
`category-trend-line-empty` (the empty state when `series` is `[]`).

It needs no new entry in `__mocks__/react-native-svg.tsx` — it only
uses `Polyline`, `Line`, `G`, `Svg`, and `Text`, all already exported
by that mock.

Which categories the chart draws is decided by the saved trend filter
(`settings.trendFilter`, a `manual | top` union — see `kiko-domain`),
resolved in `statistics.screen.tsx`, not this component's concern —
`CategoryTrendLine` only renders whatever `series` array it is given. The
screen owns a `TrendFilterField`
(`src/screens/statistics/trend-filter-field/`) — a single "Filters" button
opening a `BottomSheet` — and feeds the result through the SAME
`excludedCategories` path the builder already had. Manual mode passes explicit
keys; Top mode ranks the categories live over the fixed 30-day window with
`buildCategoryMeasures` + `selectTopCategories`
(`src/statistics/category-trend/`, `src/statistics/trend-filter/`) by one
of three measures — Contribution (total spend), Frequency (kept-row count), or
Rising (the least-squares slope of daily spend across the 30 window days,
most-positive first) — then excludes every windowed category NOT in the top N.

## PieChart donut mode

`PieChart` (`src/screens/statistics/pie-chart/pie-chart.component.tsx`)
supports an `innerRatio` prop (thins the ring, opening a larger center
hole) and a `centerTotal` prop (a `Money` value rendered centered in
that hole) — the Expenses-by-Category donut is the current caller.
Read that file directly for the default ratio and exact prop shape
rather than trusting a restated number here.

It also supports an opt-in `legendMinShare` prop: when set, the LEGEND
(never the ring) crops to slices whose `share` is at or above that
fraction, with a `${testID}-legend-toggle` Pressable that flips local
`useState` to reveal or re-hide the cropped rows ("Show all" /
"Show less", `components.pieChart.showAll`/`showLess`). The ring always
draws every arc, and `allocatePercents` still runs over the whole set,
so a kept row keeps its full-set percent. The toggle renders only when
cropping actually hides a row — at least one slice below the threshold
AND at least one at or above it — so an all-below set (nothing to keep)
and an all-above set (nothing to crop) both show the full legend with no
toggle. The Expenses-by-Category donut passes `legendMinShare={0.05}`
(`CATEGORY_LEGEND_MIN_SHARE` in `statistics.screen.tsx`); the
account-contribution pie passes nothing, so its legend is uncropped.

## The account pie excludes debts (T27)

`PieChart` itself has no debt concept — the exclusion lives entirely
in its caller. `buildAccountContribution` (`src/statistics/account-contribution/`)
filters to `slice.amount > 0` before this component ever sees the
slice list, so a debt account's net worth (negative, since a `loan`
holding's own value is negative — see `kiko-domain` "Net worth")
never reaches the ring: no negative-slice case exists inside
`PieChart`/`allocatePercents` to handle. The SAME file's
`buildDebtTotal` sums every `loan` holding's value into a separate
"Debts" `Money` total, rendered on Statistics via `MoneyText` under
the account-contribution pie card (`statistics-debts-total`), not as
a pie slice.

## Reuse the entity-color system for fills

A chart fill color is never a chart-local palette. `bar-chart` fills each
bar with `defaultHoldingColor[type]` (via `resolveEntityColor` where a
per-entity override exists); `pie-chart` colors each donut wedge and its
legend swatch with the same slice's resolved entity color. See
`kiko-design-system`'s "Entity color and tint" section for the full color
pipeline (`defaultAccountColor`/`defaultHoldingColor`,
`resolveEntityColor`, `entityIconTileGradient`) — a new chart follows the
same pipeline rather than inventing its own color set, so a swatch in a
chart legend always matches that same entity's color everywhere else in
the app (its card, its icon tint).
