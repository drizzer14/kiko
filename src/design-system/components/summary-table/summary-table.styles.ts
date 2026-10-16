import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // One label/value row: label on the left, value on the right — the exact
  // layout the deposit/bond value-breakdown row used before this component
  // existed (`holding-detail.styles.ts`'s former `breakdownDetailRow`).
  row: {
    justifyContent: 'space-between',
  },
  // A wrapping row's label never gives up width, and the gap keeps a wrapped value off it.
  wrapLabel: {
    flexShrink: 0,
    marginRight: theme.spacing(3),
  },
  // A Box does not shrink in a row on its own; this one lets the value's text wrap inside it.
  wrapValue: {
    flexShrink: 1,
  },
}));
