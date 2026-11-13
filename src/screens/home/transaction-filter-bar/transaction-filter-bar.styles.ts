import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create({
  // A pill stands at its own height: a one-line pill beside a two-line one (large text sizes) keeps
  // its natural height at the top, rather than stretching its border to the taller neighbour.
  pillRow: {
    alignItems: 'flex-start',
  },
});
