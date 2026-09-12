import { StyleSheet } from 'react-native-unistyles';

// The fixed Y-axis label column width and the gap between it and the plot, in
// spacing units. Shared so the X-axis label row can offset itself by exactly the
// same amount (column width + gap) and line its month labels up with the plot
// area rather than the axis labels. The column is deliberately narrow — the
// compact money labels shrink to fit via `adjustsFontSizeToFit`, so a wide
// reserve only stole horizontal space from the plot. Mirrors net-worth-line.
const Y_AXIS_WIDTH_UNITS = 13;
const PLOT_COLUMN_GAP_UNITS = 2;
// A legend swatch: a small square in the series' own color, sized to sit level
// with the caption text beside it.
const SWATCH_SIZE_UNITS = 3;

export const styles = StyleSheet.create((theme) => ({
  // The chart card: the Y-axis labels and plot side by side, stacked above the
  // X month axis and the legend, with small gaps so each reads as a caption to
  // the plot.
  container: {
    rowGap: theme.spacing(2),
  },
  // The plot band: the Y-axis label column on the left, the SVG plot filling the
  // remaining width to its right.
  plotRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    columnGap: theme.spacing(PLOT_COLUMN_GAP_UNITS),
  },
  // The Y-axis label column: tick labels distributed top (max) to bottom (min)
  // so each reads against its gridline in the plot beside it. A fixed width
  // reserves room for the widest money label and pushes the plot to start after
  // it; `alignItems: 'flex-end'` then flushes each label against the plot.
  yAxis: {
    width: theme.spacing(Y_AXIS_WIDTH_UNITS),
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  // The SVG plot fills the width left of the Y-axis column.
  plot: {
    flex: 1,
  },
  // The X month axis row: the SAME two-column shape as `plotRow` above — a
  // fixed-width spacer for the Y-axis label column, then a flex:1 label track
  // that lines up exactly with the SVG plot beside that column, so its
  // absolutely-positioned interior labels resolve their percentage `left`
  // against a definite width.
  xAxis: {
    flexDirection: 'row',
    alignItems: 'stretch',
    columnGap: theme.spacing(PLOT_COLUMN_GAP_UNITS),
  },
  // The Y-axis-column stand-in: exactly the Y-axis label column's width, so the
  // track beside it starts at the plot's left edge.
  xAxisSpacer: {
    width: theme.spacing(Y_AXIS_WIDTH_UNITS),
  },
  // The label track: flex:1 to match the plot's width, `relative` so the
  // absolutely-positioned labels anchor to it, and a fixed height because those
  // absolute children contribute none.
  xAxisTrack: {
    flex: 1,
    position: 'relative',
    height: theme.typography.caption.fontSize + theme.spacing(1),
  },
  // The first (range-start) month: flush to the plot's left edge.
  xLabelStart: {
    position: 'absolute',
    left: 0,
  },
  // The last (range-end) month: flush to the plot's right edge.
  xLabelEnd: {
    position: 'absolute',
    right: 0,
  },
  // An intermediate month: a zero-width anchor pinned (via an inline `left: n%`)
  // to its gridline's x, with `alignItems: 'center'` centering the label on that
  // line so the month reads directly beneath its tick.
  xLabelMid: {
    position: 'absolute',
    width: 0,
    alignItems: 'center',
  },
  // The legend below the plot: one wrapping row of entries, each a color swatch
  // plus the series title, so a reader can match each line to its category.
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: theme.spacing(3),
    rowGap: theme.spacing(1),
  },
  legendEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: theme.spacing(1),
  },
  // The swatch wears the series' own color, matching its polyline on the plot.
  swatch: {
    width: theme.spacing(SWATCH_SIZE_UNITS),
    height: theme.spacing(SWATCH_SIZE_UNITS),
    borderRadius: theme.radii.sm,
  },
  // The empty state reserves the plot area plus the X-axis label row below it —
  // plot height + the row gap + the caption-height label row — matching
  // net-worth-line's placeholder sizing. It deliberately does NOT reserve the
  // legend row: the legend wraps to a variable number of rows (one per drawn
  // series), so there is no fixed height to reserve, and the card grows by that
  // legend's height once series data lands. Reserving the plot + axis keeps the
  // empty placeholder close to the loaded chart's footprint without a brittle
  // guess at how many legend rows the data will produce.
  empty: (plotHeight: number) => ({
    alignItems: 'center',
    justifyContent: 'center',
    height: plotHeight + theme.spacing(2) + theme.typography.caption.fontSize + theme.spacing(1),
  }),
}));
