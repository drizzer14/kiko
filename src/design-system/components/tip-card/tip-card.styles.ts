import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The tinted callout: a flat accent fill, no border and no shadow. `lg` is the
  // nearest radius token to TipKit's reported 13pt corner. The vertical margin
  // keeps the tip clear of neighbouring cards so it reads as its own layer.
  callout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(2),
    padding: theme.spacing(3),
    marginVertical: theme.spacing(1),
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.accentSubtle,
  },
  // The message takes the row's free width so a long translation wraps beside
  // the close button instead of pushing it off the card.
  message: {
    flex: 1,
  },
}));
