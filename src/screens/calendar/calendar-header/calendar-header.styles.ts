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
  // The title's wrapping column: `flex: 1` claims exactly the space left over
  // between the two fixed-size arrow groups, so the title's own box width is
  // identical for every month regardless of how wide its text is ("May 2026"
  // vs "September 2026"). Centered so the title still reads as centered
  // between the arrows instead of left-aligned inside its flex box. Without
  // this the title Text sized itself to its content, so a long month name
  // could grow the row's natural width and reflow the header between months.
  titleColumn: {
    flex: 1,
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
