import { StyleSheet } from 'react-native-unistyles';

import { DISABLED_OPACITY } from '../../disabled-opacity';

// The shared regular Button's rendered height.
const BUTTON_MIN_HEIGHT = 50;
// The compact Button's minimum height — the iOS HIG 44pt minimum touch target,
// so a compact or icon-only ghost button (the categories controls, the delete
// action) is still tappable. Regular is taller (50); compact never goes below
// this floor.
const COMPACT_MIN_HEIGHT = 44;

export const styles = StyleSheet.create((theme) => ({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    // A row so an optional leading icon sits beside the label with a small gap;
    // with no icon it is a single centered child, unaffected.
    flexDirection: 'row',
    gap: theme.spacing(2),
    variants: {
      variant: {
        primary: { backgroundColor: theme.colors.accent },
        secondary: { backgroundColor: theme.colors.surfaceHigh },
        destructive: { backgroundColor: theme.colors.negative },
        // The iOS "tinted destructive" fill: a translucent dark-red tint, not
        // the solid bright `negative`. Its red label comes from
        // `variantLabelColor` in the component (see button.component.tsx).
        destructiveTonal: { backgroundColor: theme.colors.negativeSubtle },
        // No fill at all — see the `ghost` doc comment on `ButtonVariant`.
        // Explicit `'transparent'` (not simply omitting the key) so switching
        // to `ghost` at runtime (Unistyles' `useVariants`) always clears
        // whatever fill another variant last painted, rather than leaving a
        // stale `backgroundColor` from a previous variant on the same node.
        ghost: { backgroundColor: 'transparent' },
      },
    },
  },
  // The prominent footer/submit size: tall, generously rounded.
  regular: {
    minHeight: BUTTON_MIN_HEIGHT,
    borderRadius: theme.radii.md,
    paddingHorizontal: theme.spacing(4),
  },
  // A tight inline action: shorter, tighter radius, and hugging its own content
  // at the leading edge rather than stretching down a column.
  compact: {
    minHeight: COMPACT_MIN_HEIGHT,
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
    alignSelf: 'flex-start',
  },
  fullWidth: {
    width: '100%',
  },
  // Applied on top of `button` when `disabled` — `Pressable`'s own
  // `disabled` prop makes it non-interactive, this makes that state visible.
  // Dims to the shared token so every disabled control reads identically.
  disabled: {
    opacity: DISABLED_OPACITY,
  },
  // A plain `Text as RNText`, not the design-system `Text` primitive: `Text`
  // intentionally excludes `color` from its style prop (see text.props.ts) so
  // the tone token stays authoritative, but this label's color must vary by
  // variant (white `onAccent` on a filled accent/red surface, adapting
  // `textPrimary` on a gray surface or transparent) — none of `Text`'s four
  // tones is variant-aware like that. So the color is applied by the
  // component (see button.component.tsx `labelColor`), not here; this block
  // only owns the shared typography/weight.
  label: {
    ...theme.typography.body,
    fontWeight: '600',
    // NOTE: no `textTransform`. It used to force `capitalize` so call sites
    // "need not be edited", which rendered every Ukrainian label in Title Case
    // ("Додати Рахунок") — Ukrainian UI labels are sentence case. Each catalogue
    // now supplies its own casing; there is no per-language gate, because a copy
    // decision does not belong in the style layer.
  },
}));
