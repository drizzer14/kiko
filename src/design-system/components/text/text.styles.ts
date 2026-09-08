import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  text: {
    variants: {
      variant: {
        title: { ...theme.typography.title },
        heading: { ...theme.typography.heading },
        body: { ...theme.typography.body },
        caption: { ...theme.typography.caption },
      },
      tone: {
        positive: { color: theme.colors.positive },
        negative: { color: theme.colors.negative },
        textPrimary: { color: theme.colors.textPrimary },
        textSecondary: { color: theme.colors.textSecondary },
        onAccent: { color: theme.colors.onAccent },
      },
    },
  },
}));
