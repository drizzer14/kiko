import { StyleSheet } from 'react-native-unistyles';

// The fixed Y-axis label column width and the gap between it and the plot, in
// spacing units. Shared so the X-axis label row can offset itself by exactly
// the same amount (column width + gap) and line its date labels up with the
// plot area rather than the axis labels (G5). The column is deliberately narrow
// — the compact money labels ("$1.2M", "1,290K ₴") shrink to fit via
// `adjustsFontSizeToFit`, so a wide reserve only stole horizontal space from
// the plot.
const Y_AXIS_WIDTH_UNITS = 13;
const PLOT_COLUMN_GAP_UNITS = 2;

export const styles = StyleSheet.create((theme) => ({
  // The chart card: the Y-axis labels and plot side by side, stacked above the
  // X time axis, with a small gap so the axis reads as a caption to the plot.
  container: {
    rowGap: theme.spacing(2),
  },
  // The plot band: the Y-axis label column on the left, the SVG plot filling
  // the remaining width to its right.
  plotRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    columnGap: theme.spacing(PLOT_COLUMN_GAP_UNITS),
  },
  // The Y-axis label column: tick labels distributed top (max) to bottom (min)
  // so each reads against its gridline in the plot beside it. The tick labels
  // are absolutely positioned (each pinned to its gridline's `top`), so they
  // contribute no intrinsic width and the column would otherwise collapse to
  // zero — clipping the value labels off the card's left edge. A fixed width
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
  // The X time axis row: the SAME two-column shape as `plotRow` above — a
  // fixed-width spacer for the Y-axis label column, then a flex:1 label track
  // that lines up exactly with the SVG plot beside that column. Structuring it as
  // a flex row (rather than one View pushed over by `marginLeft`) is what gives
  // the label track a definite laid-out width, so its absolutely-positioned
  // interior labels can resolve their percentage `left` against it (G5). A row of
  // only-absolute children under a bare `marginLeft` had no such width, so every
  // interior percentage collapsed to 0 and the dates stacked at one x on device.
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
  // The first (range-start) date: flush to the plot's left edge.
  xLabelStart: {
    position: 'absolute',
    left: 0,
  },
  // The last (range-end) date: flush to the plot's right edge.
  xLabelEnd: {
    position: 'absolute',
    right: 0,
  },
  // An intermediate date: a zero-width anchor pinned (via an inline `left: n%`)
  // to its gridline's x, with `alignItems: 'center'` centering the label on that
  // line so the date reads directly beneath its tick.
  xLabelMid: {
    position: 'absolute',
    width: 0,
    alignItems: 'center',
  },
  // Loading and empty states fill roughly the plot's footprint and centre
  // their message, so each reads as intentional rather than broken.
  status: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing(8),
  },
}));
