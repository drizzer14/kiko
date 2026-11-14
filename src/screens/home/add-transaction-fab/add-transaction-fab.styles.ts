import { StyleSheet } from 'react-native-unistyles';
import type { VerticalBarEdge } from '@kiko/display-regions';

import { FAB_SIZE_STEP } from './fab-footprint';

// The side of the window the button sits on, nearest the tab bar: beside a vertical bar it is the
// bar's side (in a pane that does not touch the bar, the side of the fold), with no vertical bar
// the right.
const FAB_SIDE: Record<VerticalBarEdge, 'left' | 'right'> = {
  leading: 'left',
  trailing: 'right',
  none: 'right',
};

export const styles = StyleSheet.create((theme) => ({
  // The circular touch target, pinned bottom-right at the `bottom` Home computes for it.
  // A vertical tab bar on the leading edge moves it to the bottom-left, the
  // side the bar is on; the enclosing Screen's SafeAreaView already
  // reserves the bar's own width on either side.
  // `radii.full` capsules the square footprint into a true circle — kept here
  // too (not only on `glass` below) so an Android ripple stays clipped to the
  // circle. No `backgroundColor`: the visible fill is the translucent
  // `GlassSurface` child, never a flat paint on the touch target itself.
  // Runtime `bottom` and bar edge, so this is a style FUNCTION rather
  // than a static entry.
  fab: (bottom: number, verticalBarEdge: VerticalBarEdge) => ({
    position: 'absolute' as const,
    [FAB_SIDE[verticalBarEdge]]: theme.spacing(4),
    bottom,
    width: theme.spacing(FAB_SIZE_STEP),
    height: theme.spacing(FAB_SIZE_STEP),
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
