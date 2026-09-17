import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The preview info block (format name, transaction count, date span,
  // detected currency) sits above the target-holding picker/import action,
  // separated the same way `account-detail.styles.ts`'s section blocks are.
  previewBlock: {
    paddingTop: theme.spacing(2),
  },
}));
