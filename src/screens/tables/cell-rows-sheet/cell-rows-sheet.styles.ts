import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The label on the left and the sum on the right, as the rows above it split theirs.
  total: {
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing(3),
  },
}));
