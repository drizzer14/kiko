import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create({
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
});
