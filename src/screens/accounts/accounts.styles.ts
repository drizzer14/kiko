import { StyleSheet } from 'react-native-unistyles';

// The iOS HIG 44pt touch-target minimum.
const TOUCH_TARGET_MIN_HEIGHT = 44;

export const styles = StyleSheet.create((theme) => ({
  // A section heading row (Property, Debts), one pressable: the implicit
  // account's heading on the left, then its section total, then the
  // disclosure chevron, same space-between shape the account card's own `row`
  // style below uses. The 44pt minimum keeps the touch target inside the
  // row's own bounds, so a short single-line heading still meets it.
  sectionHeadingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: TOUCH_TARGET_MIN_HEIGHT,
  },
  // The disclosure chevron at the row's end: a small gap off the total, and
  // never squeezed by a long name or a wide total.
  sectionChevron: {
    flexShrink: 0,
    marginLeft: theme.spacing(2),
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
  // keeps a comfortable, easy-to-hit tap target. Tab-bar clearance is not
  // applied here — the shared Screen footer lifts every footer clear of the
  // floating glass tab bar universally, so adding it here would double-pad
  // the footer.
  addAccountButton: {
    width: '100%',
  },
}));
