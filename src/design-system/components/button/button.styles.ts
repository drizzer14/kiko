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
  // the tone token stays authoritative, but this label needs white-on-accent
  // for `primary`/`destructive` and accent-on-surface for `secondary` — none is
  // one of `Text`'s four tones. Every color still comes from a theme token.
  label: {
    ...theme.typography.body,
    fontWeight: '600',
    // Every call site passes a sentence-case label ("Add holding") — force
    // title case here, once, so button copy reads consistently without
    // editing each call site.
    textTransform: 'capitalize',
    variants: {
      variant: {
        primary: { color: theme.colors.textPrimary },
        secondary: { color: theme.colors.accent },
        destructive: { color: theme.colors.textPrimary },
      },
    },
  },
}));
