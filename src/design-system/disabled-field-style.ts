import type { UnistylesThemes } from 'react-native-unistyles';

// The registered app theme (dark | light) — same union as
// kiko-calendar.theme.ts's `AppTheme`, the pattern this module follows.
type AppTheme = UnistylesThemes[keyof UnistylesThemes];

// The shared disabled-state treatment for a bordered input-like field —
// TextField's `inputDisabled` is the canonical definition; DateField's and
// TimeField's `fieldDisabled` reuse this SAME object so a read-only date or
// time field renders identically to a read-only text field, in both themes.
// Darkens the border to `surfaceHigh`, fills with `surface` (an active field
// has no fill at all — see the `field` doc comment in date-field.styles.ts /
// time-field.styles.ts), and dims to 0.5 opacity. This 0.5 is deliberately
// NOT the shared `DISABLED_OPACITY` token (`disabled-opacity.ts`, 0.4) — that
// token dims a disabled PRESSABLE action (Button, IconButton), a different
// control class from a disabled, still-legible field.
export const disabledFieldStyle = (theme: AppTheme) => ({
  borderColor: theme.colors.surfaceHigh,
  backgroundColor: theme.colors.surface,
  opacity: 0.5,
});
