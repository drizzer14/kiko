import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The list container's own gap puts the footer 8pt under the last ledger card; this step makes it
  // the 20pt a day header keeps above its caption label (`spacing(3)` padding plus that gap).
  root: {
    paddingTop: theme.spacing(3),
  },
}));
