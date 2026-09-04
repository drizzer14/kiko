---
name: pff-charts
description: Invoke when touching a react-native-svg chart component (BarChart, PieChart, NetWorthLine), adding a new chart, changing a chart's testID, or debugging a chart test failure. Read before drawing an SVG primitive, adding a scale/tick builder, or editing __mocks__/react-native-svg.tsx.
---

# PFF chart conventions

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

- a Y-axis tick set (`buildTicks`) spread evenly across the true data
  range, drawn with a narrow, fixed-width label column
  (`net-worth-line.styles.ts`'s `Y_AXIS_WIDTH_UNITS`) sized for a compact
  money string (`adjustsFontSizeToFit`), not the widest possible label —
  the column is deliberately narrow so it does not steal plot width;
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

## `GlassSurface` gradient technique

`glass-surface.component.tsx`'s `GradientWash` is the template for any
SVG gradient in this app: an absolutely-positioned, `pointerEvents="none"`
`<Svg>` containing a `<Defs><LinearGradient id="..."><Stop .../><Stop
.../></LinearGradient></Defs>` plus a single `<Rect fill="url(#...)" />`
sized to `100%`/`100%`. The gradient id only needs to be unique within
its own `<Svg>` (each `<Svg>` is an isolated rendering root), so reusing
the same literal id across many simultaneously-rendered cards is safe.
Each `<Stop>` carries its own `testID` suffix (`-gradient-from`/
`-gradient-to`) so a test can assert the resolved stop color without
touching native SVG internals — the same `testID`-per-primitive rule as
the charts above.

## Reuse the entity-color system for fills

A chart fill color is never a chart-local palette. `bar-chart` fills each
bar with `defaultHoldingColor[type]` (via `resolveEntityColor` where a
per-entity override exists); `pie-chart` colors each donut wedge and its
legend swatch with the same slice's resolved entity color. See
`pff-design-system`'s "Entity color and tint" section for the full color
pipeline (`defaultAccountColor`/`defaultHoldingColor`,
`resolveEntityColor`, `entityGradientStops`) — a new chart follows the
same pipeline rather than inventing its own color set, so a swatch in a
chart legend always matches that same entity's color everywhere else in
the app (its card, its icon tint).
