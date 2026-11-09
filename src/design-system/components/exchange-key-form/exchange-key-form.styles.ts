import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(() => ({
  // A leading-icon status line: keeps the Connect button vertically centered
  // against the adjacent `SyncStatusLine` result.
  statusLine: {
    alignItems: 'center',
  },
  // The link's touch target: hugs its text at the leading edge rather than
  // stretching across the column.
  linkPressable: {
    alignSelf: 'flex-start',
  },
}));
