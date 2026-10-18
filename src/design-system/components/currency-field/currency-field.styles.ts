import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // A group's label sits over its rows, inset like the rows' own content so the two line up.
  heading: {
    paddingTop: theme.spacing(2),
    paddingBottom: theme.spacing(1),
    paddingHorizontal: theme.spacing(3),
  },
  // The option rows scroll within the sheet's capped height rather than
  // growing it, so a long currency list (plus the pinned search field above
  // it) stays reachable. Mirrors category-field.styles.ts's own `scroll`.
  scroll: {
    flexShrink: 1,
  },
}));
