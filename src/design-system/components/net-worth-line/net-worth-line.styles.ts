import { StyleSheet } from 'react-native-unistyles';

// The fixed Y-axis label column width and the gap between it and the plot, in
// spacing units. Shared so the X-axis label row can offset itself by exactly
// the same amount (column width + gap) and line its start/end dates up with the
// plot area rather than the axis labels (G5).
const Y_AXIS_WIDTH_UNITS = 20;
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
  // The X time axis row: the range's start time on the left, its end on the
  // right, reading as a light caption beneath the plot. Offset from the left by
  // the Y-axis column width plus the plot gap (a stretched row's margin shrinks
  // its width), so the row spans exactly the plot area and its start/end dates
  // sit under the plotted line's start/end rather than under the axis labels (G5).
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginLeft: theme.spacing(Y_AXIS_WIDTH_UNITS + PLOT_COLUMN_GAP_UNITS),
  },
  // Loading and empty states fill roughly the plot's footprint and centre
  // their message, so each reads as intentional rather than broken.
  status: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing(8),
  },
}));
