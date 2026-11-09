import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create({
  // The two filters on one row, wrapping when a narrow device cannot hold both.
  filterBar: {
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  // The period field is a label over its trigger, so the chips beside it end level with the
  // trigger, not at the middle of the label and the trigger together.
  filterBarWithPeriod: {
    alignItems: 'flex-end',
  },
});
