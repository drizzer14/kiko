import { StyleSheet } from 'react-native-unistyles';

// The iOS HIG 44pt touch-target minimum.
const EDIT_REGION_SIZE = 44;

export const styles = StyleSheet.create((theme) => ({
  // A section heading row (Property, Debts) — the implicit account's
  // heading on the left, then its section total, then the edit pencil, same
  // space-between shape the account card's own `row` style below uses.
  sectionHeadingRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // The edit pencil's own 44pt box. iOS delivers no touch outside the parent
  // view's bounds, so the small Button's hitSlop (34pt pill + 5pt above and
  // below) only counts when the parent is itself 44pt tall: this box is that
  // parent. It also centres the pencil on the row, which the Button's own
  // `alignSelf: 'flex-start'` would otherwise pin to the row's top edge.
  sectionEditRegion: {
    minWidth: EDIT_REGION_SIZE,
    minHeight: EDIT_REGION_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  // It takes the width the balance leaves, as the transaction card's does, so a
  // long name wraps instead of pushing the balance off the card.
  rowLead: {
    alignItems: 'center',
    flex: 1,
    marginRight: theme.spacing(3),
  },
  rowDescription: {
    flex: 1,
  },
  rowAmount: {
    flexShrink: 0,
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
