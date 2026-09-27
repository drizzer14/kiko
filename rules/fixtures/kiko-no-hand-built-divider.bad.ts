import { StyleSheet } from 'react-native-unistyles';

// Semgrep fixture (POSITIVE): kiko-design-system's `Divider` component owns
// the ONE hairline-rule style. `kiko-no-hand-built-divider` MUST report a
// finding on the pinned line below — a bespoke `height:
// StyleSheet.hairlineWidth` style object duplicating it.
export const styles = StyleSheet.create((theme) => ({
  separator: {
    // EXPECT-FINDING
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
  },
}));
