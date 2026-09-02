import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(() => ({
  // The screen's content column: fills the available space below the header.
  content: {
    flex: 1,
  },
  // A single account card's inner row: kind icon + name/kind on the left,
  // balance on the right. The surrounding GlassSurface owns the padding and
  // rounded corners, so the row itself only lays its two clusters out.
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // The leading cluster of a row: kind icon + name/kind label, kept together on
  // the left so the row's space-between only splits this cluster from the balance.
  rowLead: {
    alignItems: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The footer's "Add account" button spans the full footer width (not
  // `alignSelf: 'flex-start'`) so it reads as the row's dominant action and
  // keeps a comfortable, easy-to-hit tap target. Tab-bar clearance is no longer
  // applied here — the shared Screen footer lifts every footer clear of the
  // floating glass tab bar universally, so adding it here again would
  // double-pad the footer.
  addAccountButton: {
    width: '100%',
  },
}));
