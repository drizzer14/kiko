import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(() => ({
  // Spinner + label on one row, vertically centered. The horizontal gap between
  // them comes from Box's `gap` prop, so this only owns cross-axis alignment.
  container: {
    alignItems: 'center',
  },
}));
