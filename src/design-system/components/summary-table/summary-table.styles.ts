import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(() => ({
  // One label/value row: label on the left, value on the right — the exact
  // layout the deposit/bond value-breakdown row used before this component
  // existed (`holding-detail.styles.ts`'s former `breakdownDetailRow`).
  row: {
    justifyContent: 'space-between',
  },
}));
