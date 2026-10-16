import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(() => ({
  // The screen's content column: fills the available space below the header.
  content: {
    flex: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The footer's button spans the full footer width, as the Accounts footer's does. Tab-bar
  // clearance is the shared Screen footer's own, so it is not added here.
  addTemplateButton: {
    width: '100%',
  },
}));
