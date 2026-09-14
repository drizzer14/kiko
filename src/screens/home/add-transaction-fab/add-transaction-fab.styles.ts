import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The circular accent button, pinned bottom-right and lifted clear of the
  // floating tab bar by the Home list's own clearance plus one standard gap.
  // `radii.full` capsules the square footprint into a true circle. Runtime
  // `bottomOffset`, so this is a style FUNCTION rather than a static entry.
  fab: (bottomOffset: number) => ({
    position: 'absolute' as const,
    right: theme.spacing(4),
    bottom: bottomOffset + theme.spacing(4),
    width: theme.spacing(14),
    height: theme.spacing(14),
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.accent,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  }),
  // A slight dim on press-in, the same lightweight affordance the shared Button
  // uses for its pressed state.
  pressed: {
    opacity: 0.85,
  },
}));
