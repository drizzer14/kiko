import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // Separates the Result heading from whatever preceded it (the last field
  // group), the same rhythm `statement-import.styles.ts`'s `previewBlock`
  // uses above its own preview block.
  resultBlock: {
    paddingTop: theme.spacing(2),
  },
  // F3 item 13: the same bottom margin every OTHER section heading on this
  // screen carries below it (`column-mapping.styles.ts`'s own
  // `sectionHeading`) — applied here only to the standalone "incomplete"
  // heading below (`stats === undefined`); the `stats !== undefined` branch's
  // heading is `SummaryTable`'s own `title` row, which is a shared component
  // used by other screens too and is left at its own internal spacing.
  sectionHeading: {
    marginBottom: theme.spacing(3),
  },
}));
