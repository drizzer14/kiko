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
  safeArea: {
    flex: 1,
  },
  // Centred and capped so a wide pane never stretches a form line across the screen.
  content: {
    flex: 1,
    width: '100%',
    maxWidth: theme.layout.paneMaxWidth,
    alignSelf: 'center',
  },
  divider: (frame: PaneFrame) => ({
    position: 'absolute' as const,
    left: frame.x,
    top: frame.y,
    width: frame.width,
    height: frame.height,
    backgroundColor: theme.colors.border,
  }),
}));
