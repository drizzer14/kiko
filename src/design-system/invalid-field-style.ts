import type { UnistylesThemes } from 'react-native-unistyles';

type AppTheme = UnistylesThemes[keyof UnistylesThemes];

// The shared invalid-state treatment for a bordered text input — TextField's
// `inputError` is the canonical definition; HoldingIdentityField's own raw
// TextInput (it does not route through TextField — see kiko-code-style) reuses
// this SAME object so a failed-validation name field renders identically to a
// failed-validation TextField. `theme.colors.negative` is the same red token
// FieldError's `tone="negative"` caption already uses, so the border and the
// message underneath it always agree.
export const invalidFieldStyle = (theme: AppTheme) => ({
  borderColor: theme.colors.negative,
});
