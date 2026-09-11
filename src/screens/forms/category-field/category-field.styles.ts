import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The tappable field's own bordered-chip style now lives in the shared
  // `FieldTrigger` (see field-trigger.styles.ts) — this file no longer needs
  // its own copy.
  // The option rows scroll within the sheet's capped height rather than growing
  // it, so a long category list stays reachable (mirrors the icon picker).
  scroll: {
    flexShrink: 1,
  },
}));
