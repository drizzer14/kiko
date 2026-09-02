import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The custom header column that replaces react-native-calendars' default
  // header: a title row on top, the weekday labels below. Stretches full width
  // inside the calendar container so its columns line up with the day grid.
  header: {
    alignSelf: 'stretch',
  },
  // The nav + title row: month/year title centered between two arrow groups.
  titleRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing(2),
    paddingBottom: theme.spacing(3),
  },
  // A paired arrow group (year double-chevron + month single-chevron) on one
  // side of the title.
  group: {
    alignItems: 'center',
  },
  // The weekday-label row, matching the day grid's seven equal-width columns so
  // each label sits above its column.
  weekRow: {
    flexDirection: 'row',
  },
  // One weekday cell: an equal-width column with its label centered, mirroring
  // the flex:1 day cells in the grid below.
  weekday: {
    flex: 1,
    alignItems: 'center',
  },
}));
