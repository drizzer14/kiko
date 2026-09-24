import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // A single transaction row, a glass card (M2): the GlassSurface owns the
  // padding and radius; this only sets the gap BELOW each card so the list
  // reads as a stack of cards rather than hairline-separated rows. The
  // card's own internal layout (icon/title/amount/footer) lives in the
  // shared `TransactionCard` now (F3 fix round 1, C1).
  rowCard: {
    marginBottom: theme.spacing(2),
  },
}));
