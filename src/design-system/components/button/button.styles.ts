import { StyleSheet } from 'react-native-unistyles';

// The shared regular Button's rendered height.
const BUTTON_MIN_HEIGHT = 50;

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
  disabled: {
    opacity: 0.4,
  },
  // A plain `Text as RNText`, not the design-system `Text` primitive: `Text`
  // intentionally excludes `color` from its style prop (see text.props.ts) so
  // the tone token stays authoritative, but this label needs white on every
  // fill (accent, gray surface, red) — none of `Text`'s four tones is "always
  // white regardless of variant". The color still comes from a theme token,
  // just not through a `Text` tone.
  label: {
    ...theme.typography.body,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    // NOTE: no `textTransform`. It used to force `capitalize` so call sites
    // "need not be edited", which rendered every Ukrainian label in Title Case
    // ("Додати Рахунок") — Ukrainian UI labels are sentence case. Each catalogue
    // now supplies its own casing; there is no per-language gate, because a copy
    // decision does not belong in the style layer.
  },
}));
