import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(theme => ({
  button: {
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
}));
