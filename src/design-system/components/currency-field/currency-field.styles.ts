import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(() => ({
  // The option rows scroll within the sheet's capped height rather than
  // growing it, so a long currency list (plus the pinned search field above
  // it) stays reachable. Mirrors category-field.styles.ts's own `scroll`.
  scroll: {
    flexShrink: 1,
  },
}));
