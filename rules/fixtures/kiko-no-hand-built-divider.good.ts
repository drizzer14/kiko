import { StyleSheet } from 'react-native-unistyles';

// Semgrep fixture (NEGATIVE): a bordered field/card outline uses
// `StyleSheet.hairlineWidth` as its `borderWidth`, not `height` — that is a
// stroke around a box, not a horizontal rule, so it is not a Divider copy.
// `kiko-no-hand-built-divider` MUST report nothing here.

export const styles = StyleSheet.create((theme) => ({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
}));
