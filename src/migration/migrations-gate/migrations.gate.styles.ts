import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // Full-bleed on the true-black background: this is the very FIRST paint,
  // before the navigator (and before Unistyles' own screen background) exists,
  // so an unstyled View flashed white on a light-mode device and left the
  // text under the status bar. Same shape as `lock-gate.styles`' `fill`.
  fill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing(6),
  },
}));
