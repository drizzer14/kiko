import { StyleSheet } from 'react-native-unistyles';

import { disabledFieldStyle } from '../../disabled-field-style';

export const styles = StyleSheet.create((theme) => ({
  // `height` is explicit — Apple's 44pt minimum tap-target height,
  // `theme.spacing(11)` — rather than left to grow from `padding` plus the
  // platform's intrinsic text line-height (which a sibling element cannot
  // measure). A shared row that places a trailing icon button beside this
  // field (see `iconButton` in `screens/account-detail/account-detail.styles.ts`)
  // mirrors this SAME `theme.spacing(11)` token so the two land on exactly
  // the same height and, bottom-aligned against this field's captioned
  // column, on the same vertical center too.
  input: {
    height: theme.spacing(11),
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    padding: theme.spacing(3),
    color: theme.colors.textPrimary,
    ...theme.typography.body,
  },
  // Applied on top of `input` when `editable === false`, so the field reads
  // clearly as non-editable rather than merely un-focusable.
  inputDisabled: {
    ...disabledFieldStyle(theme),
    color: theme.colors.textSecondary,
  },
  // Extra trailing room reserved on top of `input`'s own `padding` when a
  // suffix renders, so the value and the caret never slide under the pinned
  // suffix glyph. Sized to clear the glyph plus the `suffixSlot`'s right inset.
  inputWithSuffix: {
    paddingRight: theme.spacing(9),
  },
  // Positioned parent for the absolutely-pinned suffix slot: the input keeps
  // its full width and 44pt tap area, and the slot overlays only the reserved
  // trailing padding.
  suffixContainer: {
    position: 'relative',
  },
  // The suffix glyph, pinned to the trailing edge and vertically centered
  // against the field's fixed height. `pointerEvents: 'none'` lets a tap in the
  // trailing area still fall through to the input rather than being swallowed.
  suffixSlot: {
    position: 'absolute',
    right: theme.spacing(3),
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    pointerEvents: 'none',
  },
}));
