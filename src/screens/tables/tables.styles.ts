import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The filter bar row (also holds the period pill and the spacer in the beside pose), wrapping
  // when a narrow device cannot hold it all. The period is a pill like the filters, so all of them
  // share the row's centre.
  filterBar: {
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  // Takes the free room of the row, so the period stays at the leading end and the filters go to
  // the trailing end. The bar's gap lands on both sides of this flex item, so the negative start
  // margin of one gap keeps the least distance from the period to the first filter at one gap.
  filterBarSpacer: {
    flexGrow: 1,
    marginStart: -theme.spacing(3),
  },
}));
