import { StyleSheet } from 'react-native-unistyles';

// The shared primary/secondary Button's rendered height. Exported as the single
// source of truth so layout that must reason about a footer button's height
// (e.g. the Screen footer's tab-bar gap) derives from it rather than
// re-hardcoding the same number.
export const BUTTON_MIN_HEIGHT = 50;

export const styles = StyleSheet.create((theme) => ({
  button: {
    minHeight: BUTTON_MIN_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.md,
    paddingHorizontal: theme.spacing(4),
    variants: {
      variant: {
        primary: { backgroundColor: theme.colors.accent },
        secondary: { backgroundColor: theme.colors.surfaceHigh },
      },
    },
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
  // for `primary` and accent-on-surface for `secondary` — neither is one of
  // `Text`'s four tones. Both colors still come from theme tokens, never a
  // hardcoded hex.
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
      },
    },
  },
}));
