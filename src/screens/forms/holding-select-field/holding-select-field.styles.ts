import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The tappable field's own bordered-chip style now lives in the shared
  // `FieldTrigger` (see field-trigger.styles.ts) — this file no longer needs
  // its own copy.
  // Pushes the collapsed field's trailing account-name caption to the field's
  // right edge, so the picked holding's account reads disambiguated even
  // while the sheet is closed.
  fieldAccount: {
    marginLeft: 'auto',
  },
}));
