import { StyleSheet } from 'react-native-unistyles';

// The toolbar's minimum height (and the Done button's tap target). No Apple
// doc gives a literal point value for a `UIToolbar`/input-accessory bar's
// height (`UIToolbar`'s own doc only names "standard-height"/"compact-height"
// style variants, no number — see `keyboardAccessoryBackground`'s doc comment
// in `theme.ts` for the full research writeup this component shares).
// 44 is kept: it is both the iOS HIG minimum touch target AND the
// long-established standard iPhone toolbar/nav-bar height, so it satisfies
// the touch-target requirement and reads as a standard-height bar even
// without a literal Apple citation for the second claim.
const TOOLBAR_MIN_HEIGHT = 44;

export const styles = StyleSheet.create((theme) => ({
  // The InputAccessoryView host, styled as a real iOS input-accessory toolbar
  // so it reads as PART OF the keyboard directly below it, not a detached
  // strip: `keyboardAccessoryBackground` (its own doc comment in `theme.ts`
  // has the full investigation — a reasoned color approximation of the
  // system keyboard's own tone, since a live blur material could not be
  // verified safely in this native host) for the fill, and the existing
  // neutral `border` separator token (the same hairline `GlassSurface`'s
  // `bordered` prop uses) as a top hairline dividing it from app content —
  // Apple's own `separator`/`opaqueSeparator` system colors are exactly this
  // "thin border/divider line" role (see `theme.ts`), so reusing this
  // existing token rather than inventing a new one is itself the
  // HIG-grounded choice here. Height/padding hold the 44pt bar (see
  // `TOOLBAR_MIN_HEIGHT` above). The Done button stays trailing
  // (`alignItems: 'flex-end'`, the original placement), vertically centered.
  accessoryContainer: {
    minHeight: TOOLBAR_MIN_HEIGHT,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingVertical: theme.spacing(1),
    paddingHorizontal: theme.spacing(4),
    backgroundColor: theme.colors.keyboardAccessoryBackground,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  // The trailing Done control. RN's core `<Button>` cannot carry a
  // background/weight/layout, so it is a `Pressable` + DS `Text`; this keeps a
  // >= 44pt tap target even though the label alone is short.
  doneButton: {
    minWidth: TOOLBAR_MIN_HEIGHT,
    minHeight: TOOLBAR_MIN_HEIGHT,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  // The Done label: accent (systemBlue) link tone via the DS `Text` `tone`, and
  // a semibold weight here so it reads as iOS's emphasized Done action. Only the
  // weight is a style override; the color stays the authoritative `accent` tone
  // token (Text excludes `color` from its style prop by design).
  doneLabel: {
    fontWeight: '600',
  },
}));
