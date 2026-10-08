import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The same message-to-action gap as NoticeBanner, so the two inline notices
  // read as one family.
  card: {
    gap: theme.spacing(2),
  },
  // A long translated label wraps the second button onto its own line instead
  // of squeezing both pills past the card's edge.
  actions: {
    flexWrap: 'wrap',
  },
}));
