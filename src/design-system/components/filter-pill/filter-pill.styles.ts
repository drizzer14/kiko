import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // A bordered, filled chip that opens a filter sheet. The fill is `surface`, not the form fields'
  // `fieldBackground`, so a filter reads as a control on the screen rather than as an input. There
  // is no `alignSelf` on purpose: the row a pill sits in aligns it, and a caller that needs it to
  // hug its content inside a column sets `alignItems` on its own root.
  pill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    backgroundColor: theme.colors.surface,
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
  },
  row: {
    alignItems: 'center',
  },
}));
