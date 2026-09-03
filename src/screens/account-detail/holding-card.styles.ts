import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // A square holding card: aspectRatio keeps its height equal to its (~half the
  // row) grid-column width, so the account's holdings tile as a 2-up grid of
  // squares rather than full-width rows.
  card: {
    aspectRatio: 1,
  },
  // Fills the card and pushes the icon to the top with the name/value at the
  // bottom, so every card reads with the same top-glyph / bottom-figure rhythm.
  pressable: {
    flex: 1,
    justifyContent: 'space-between',
  },
  // The holding's value is the card's headline figure: one typography step above
  // body (the heading size) and bold (the title weight, '700'), so the number
  // reads more prominently than the name above it. Size/weight come from the
  // theme's typography tokens, never magic numbers; MoneyText still owns the
  // tone color, so this deliberately omits `color`.
  value: {
    fontSize: theme.typography.heading.fontSize,
    fontWeight: theme.typography.title.fontWeight,
  },
}));
