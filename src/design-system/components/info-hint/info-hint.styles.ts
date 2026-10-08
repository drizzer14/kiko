import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-start',
  },
  // flex: 1 lets a long message wrap inside the row, under the text and not under the icon.
  text: {
    flex: 1,
  },
});
