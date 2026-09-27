import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // Separates each field group from the next, the same rhythm
  // `statement-preview-block.styles.ts`'s `previewBlock` uses for its own
  // preview block below the format heading.
  fieldGroup: {
    paddingTop: theme.spacing(1),
  },
}));
