import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // Separates each field group from the next, the same rhythm
  // `statement-import.styles.ts`'s `previewBlock` uses for its own preview
  // block below the format heading.
  fieldGroup: {
    paddingTop: theme.spacing(1),
  },
  resultBlock: {
    paddingTop: theme.spacing(2),
  },
  // F3 items 12/13/14: every section on this screen shows its own heading,
  // each carrying the SAME bottom margin the screen's own former (now
  // removed, item 12 — it duplicated the native stack header) title heading
  // had below it — that title sat as the first child of a `Box gap={3}`, so
  // `theme.spacing(3)` is that exact value, applied here explicitly (rather
  // than left to whatever `gap` a given section's own content Box happens to
  // use) so it stays uniform regardless of each section's own internal
  // field spacing.
  sectionHeading: {
    marginBottom: theme.spacing(3),
  },
}));
