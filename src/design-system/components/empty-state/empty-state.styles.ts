import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  container: {
    alignItems: 'center',
    paddingHorizontal: theme.spacing(6),
    paddingVertical: theme.spacing(8),
    gap: theme.spacing(2),
  },
  title: {
    fontWeight: '600',
    textAlign: 'center',
  },
  message: {
    textAlign: 'center',
  },
  // The action sits one step further from the text than the text lines sit
  // from each other.
  action: {
    marginTop: theme.spacing(2),
  },
}));
