import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(theme => ({
  // The scrollable content column: header stays fixed height, the list below
  // grows to fill the remaining space.
  content: {
    flex: 1,
  },
  // Groups every account row into a single inset-grouped-style card, the way
  // iOS Settings groups related rows.
  group: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.sm,
    overflow: 'hidden',
  },
  // A single account row: name + kind on the left, balance on the right.
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing(3),
    paddingHorizontal: theme.spacing(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  // The last row in the group has no divider beneath it.
  rowLast: {
    borderBottomWidth: 0,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
