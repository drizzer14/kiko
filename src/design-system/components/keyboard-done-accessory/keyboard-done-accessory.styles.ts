import { StyleSheet } from 'react-native-unistyles';

// The toolbar's minimum height (and the Done button's tap target) — the iOS HIG
// 44pt minimum touch target, so the accessory reads as a real keyboard bar
// rather than a floating button and stays comfortably tappable.
const TOOLBAR_MIN_HEIGHT = 44;

export const styles = StyleSheet.create((theme) => ({
  // The InputAccessoryView host, styled as a real iOS input-accessory toolbar:
  // an elevated `surfaceHigh` fill that reads as part of the keyboard (distinct
  // from the app's black background and #1C1C1E cards behind it), a top hairline
  // `border` separator that divides it from app content, and enough
  // padding/height (>= 44) to read as a bar. The Done button stays trailing
  // (`alignItems: 'flex-end'`, the original placement), vertically centered.
  accessoryContainer: {
    minHeight: TOOLBAR_MIN_HEIGHT,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingVertical: theme.spacing(1),
    paddingHorizontal: theme.spacing(4),
    backgroundColor: theme.colors.surfaceHigh,
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
