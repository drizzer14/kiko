import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(() => ({
  // The link's touch target: hugs its text at the leading edge rather than
  // stretching across the column.
  linkPressable: {
    alignSelf: 'flex-start',
  },
}));
