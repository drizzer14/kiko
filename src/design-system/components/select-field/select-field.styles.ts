import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create({
  // The root is a column, so without this the pill stretches to the column's width (up to its
  // cap) instead of hugging its text. Box has no align prop, and only the pill needs it: the form
  // field's trigger fills its column.
  pillRoot: {
    alignItems: 'flex-start',
  },
});
