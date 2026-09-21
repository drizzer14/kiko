import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The circular touch target, pinned bottom-right and lifted clear of the
  // floating tab bar by the Home list's own clearance plus one standard gap.
  // `radii.full` capsules the square footprint into a true circle — kept here
  // too (not only on `glass` below) so an Android ripple stays clipped to the
  // circle. No `backgroundColor`: the visible fill is the translucent
  // `GlassSurface` child, never a flat paint on the touch target itself.
  // Runtime `bottomOffset`, so this is a style FUNCTION rather than a static
  // entry.
  fab: (bottomOffset: number) => ({
    position: 'absolute' as const,
    right: theme.spacing(4),
    bottom: bottomOffset + theme.spacing(4),
    width: theme.spacing(14),
    height: theme.spacing(14),
    borderRadius: theme.radii.full,
  }),
  // The GlassSurface fills the Pressable's exact circular footprint
  // edge-to-edge and centers the "+" glyph inside it. Static — no theme
  // dependency — but co-located with `fab` per the shared `.styles.ts`
  // convention.
  glass: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  // A slight dim on press-in, the same lightweight affordance the shared Button
  // uses for its pressed state.
  pressed: {
    opacity: 0.85,
  },
}));
