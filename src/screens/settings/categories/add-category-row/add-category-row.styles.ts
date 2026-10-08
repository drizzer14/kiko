import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(() => ({
  // Each of the Cancel / Save actions takes an equal half of the action row, so
  // both full-width buttons match each other's size (the pre-audit treatment).
  action: {
    flex: 1,
  },
}));
