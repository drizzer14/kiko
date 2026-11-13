import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // Pushes the collapsed field's trailing account-name caption to the field's
  // right edge, so the picked holding's account reads disambiguated even
  // while the sheet is closed. It shrinks, so a long account name (or the caption at accessibility
  // sizes) wraps instead of squeezing the value and pushing the chevron out of the field.
  fieldAccount: {
    marginLeft: 'auto',
    flexShrink: 1,
  },
}));
