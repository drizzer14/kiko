import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The account-name group header shown above its holdings when the sheet
  // lists every account's holdings (the unscoped, `accountId`-absent mode).
  groupHeader: {
    paddingHorizontal: theme.spacing(3),
    paddingTop: theme.spacing(2),
  },
}));
