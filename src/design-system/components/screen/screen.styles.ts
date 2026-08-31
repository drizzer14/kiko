import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(theme => ({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    flex: 1,
    padding: theme.spacing(4),
  },
}));
