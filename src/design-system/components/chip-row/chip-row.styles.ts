import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  // The iOS HIG 44pt minimum touch target (H2 in the HIG audit); the padding
  // below still sets the visual height when the content is shorter. This is
  // the DEFAULT (`labelVariant="body"`) sizing — every existing consumer that
  // omits `labelVariant` keeps this exact shape.
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(2),
    minHeight: 44,
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
  // A compact size for `labelVariant="caption"` (a value chip sitting under its
  // own larger section label): mirrors Button's `small` size (`SMALL_MIN_HEIGHT`
  // in button.styles.ts, also 34) — only the vertical size shrinks, merged onto
  // `chip` (never replaces it) so `paddingHorizontal`/`borderRadius` stay
  // shared. This visible height is BELOW the 44pt HIG floor on purpose; the
  // component restores the 44pt tap target with `hitSlop`
  // (`CAPTION_HIT_SLOP`, chip-row.component.tsx), the same pattern Button's
  // `small` size and the former OptionPills used.
  chipCompact: {
    minHeight: 34,
    paddingVertical: theme.spacing(1),
  },
  // A read-only chip row (an edit form's uneditable kind/type/currency): dimmed
  // so it reads as fixed while still showing which value is selected.
  disabled: {
    opacity: 0.5,
  },
}));
