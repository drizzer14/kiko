import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // Out of the flow and invisible, but laid out for real: the layout pass gives its height.
  container: (availableWidth: number) => ({
    position: 'absolute' as const,
    top: 0,
    left: theme.spacing(4),
    width: availableWidth,
    opacity: 0,
    pointerEvents: 'none' as const,
  }),
}));
