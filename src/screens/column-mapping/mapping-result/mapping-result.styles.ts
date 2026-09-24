import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // Separates the Result heading from whatever preceded it (the last field
  // group), the same rhythm `statement-import.styles.ts`'s `previewBlock`
  // uses above its own preview block.
  resultBlock: {
    paddingTop: theme.spacing(2),
  },
}));
