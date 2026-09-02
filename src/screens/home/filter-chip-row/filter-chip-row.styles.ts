import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(() => ({
  // A single horizontal chip row must not stretch to fill the column it sits
  // in, or its ScrollView collapses to zero height.
  row: {
    flexGrow: 0,
  },
}));
