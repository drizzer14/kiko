import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // A section's label sits over its rows, inset like the rows' own content so the two line up.
  heading: {
    paddingTop: theme.spacing(2),
    paddingBottom: theme.spacing(1),
    paddingHorizontal: theme.spacing(3),
  },
  // A line of text in the list that is no row (the empty and no-match notes), inset like a heading.
  note: {
    paddingVertical: theme.spacing(1),
    paddingHorizontal: theme.spacing(3),
  },
  // The rows scroll within the sheet's capped height rather than growing it, so the long list
  // (plus the pinned search field above it) stays reachable.
  scroll: {
    flexShrink: 1,
  },
}));
