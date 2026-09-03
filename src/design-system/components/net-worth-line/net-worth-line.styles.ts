import { StyleSheet } from 'react-native-unistyles';

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
    columnGap: theme.spacing(2),
  },
  // The Y-axis label column: tick labels distributed top (max) to bottom (min)
  // so each reads against its gridline in the plot beside it. The tick labels
  // are absolutely positioned (each pinned to its gridline's `top`), so they
  // contribute no intrinsic width and the column would otherwise collapse to
  // zero — clipping the value labels off the card's left edge. A fixed width
  // reserves room for the widest money label and pushes the plot to start after
  // it; `alignItems: 'flex-end'` then flushes each label against the plot.
  yAxis: {
    width: theme.spacing(20),
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  // The SVG plot fills the width left of the Y-axis column.
  plot: {
    flex: 1,
  },
  // The X time axis row: the range's start time on the left, its end on the
  // right, reading as a light caption beneath the plot.
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  // Loading and empty states fill roughly the plot's footprint and centre
  // their message, so each reads as intentional rather than broken.
  status: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing(8),
  },
}));
