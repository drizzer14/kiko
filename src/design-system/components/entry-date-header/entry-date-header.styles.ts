import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // A date separator heading an entry group, mirroring the Home transaction list's day header
  // (home.styles.ts `sectionHeader`): a generous top pad gives each date label clear separation
  // above it (stacked on the surrounding list's gap between cells), and a small bottom pad
  // seats the group's first card close beneath the label.
  sectionHeader: {
    paddingTop: theme.spacing(3),
    paddingBottom: theme.spacing(1),
  },
}));
