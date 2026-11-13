import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  row: {
    alignItems: 'flex-start',
    backgroundColor: theme.colors.negativeSubtle,
    borderRadius: theme.radii.sm,
    padding: theme.spacing(3),
  },
  // flex: 1 lets a long message wrap inside the row, under the text and not under the icon.
  text: {
    flex: 1,
  },
}));
