import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The filter bar row (also holds the period field and the spacer in the beside pose), wrapping
  // when a narrow device cannot hold it all.
  filterBar: {
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  // The period field is a label over its trigger, so the chips beside it end level with the
  // trigger, not at the middle of the label and the trigger together.
  filterBarWithPeriod: {
    alignItems: 'flex-end',
  },
  // Takes the free room of the row, so the period stays at the leading end and the filters go to
  // the trailing end. The bar's gap lands on both sides of this flex item, so the negative start
  // margin of one gap keeps the least distance from the period to the first filter at one gap.
  filterBarSpacer: {
    flexGrow: 1,
    marginStart: -theme.spacing(3),
  },
}));
