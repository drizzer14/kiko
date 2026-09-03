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
  // so each reads against its gridline in the plot beside it.
  yAxis: {
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
