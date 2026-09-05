import { StyleSheet } from 'react-native-unistyles';

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
    borderColor: theme.colors.surfaceHigh,
    backgroundColor: theme.colors.surface,
    color: theme.colors.textSecondary,
    opacity: 0.5,
  },
}));
