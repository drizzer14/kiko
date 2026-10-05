import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((_theme) => ({
  // The tappable field's own bordered-chip style lives in the shared
  // `FieldTrigger` (see field-trigger.styles.ts), not here.
  // The option rows scroll within the sheet's capped height rather than growing
  // it, so a long category list stays reachable (mirrors the icon picker).
  scroll: {
    flexShrink: 1,
  },
}));
