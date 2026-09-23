import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  row: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lead: {
    flex: 1,
    marginRight: theme.spacing(3),
  },
}));
