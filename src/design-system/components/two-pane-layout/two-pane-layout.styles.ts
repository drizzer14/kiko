import { StyleSheet } from 'react-native-unistyles';
import type { PaneFrame } from '@kiko/design-system/pane-geometry';

export const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  pane: (frame: PaneFrame) => ({
    position: 'absolute' as const,
    left: frame.x,
    top: frame.y,
    width: frame.width,
    height: frame.height,
  }),
  dividerColor: {
    backgroundColor: theme.colors.border,
  },
}));
