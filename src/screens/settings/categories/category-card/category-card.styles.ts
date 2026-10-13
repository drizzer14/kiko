import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The icon cluster and the "Default" marker sit on opposite edges of the card.
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // The leading cluster takes the width the marker leaves, so a long title wraps instead of
  // pushing the marker off the card.
  rowLead: {
    alignItems: 'center',
    flex: 1,
    marginRight: theme.spacing(3),
  },
  rowDescription: {
    flex: 1,
  },
  rowTrailing: {
    flexShrink: 0,
  },
}));
