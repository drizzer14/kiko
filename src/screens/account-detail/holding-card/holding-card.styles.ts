import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(() => ({
  // The holding card's inner row: icon + name on the left, value on the right —
  // the same layout the accounts-list card uses (accounts.styles.ts `row`). The
  // surrounding GlassSurface owns the padding and rounded corners, so the row
  // itself only lays its two clusters out.
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // The leading cluster: icon + name, kept together on the left so the row's
  // space-between only splits this cluster from the value (mirrors the accounts
  // card's `rowLead`).
  rowLead: {
    alignItems: 'center',
  },
}));
