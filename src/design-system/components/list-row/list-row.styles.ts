import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(theme => ({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
}));
