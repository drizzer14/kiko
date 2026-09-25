// Semgrep fixture (NEGATIVE): every color below is a theme-token reference (a
// property access, never a string literal), so `kiko-no-raw-color-literal`
// MUST report nothing here. A hex mentioned only inside a comment — #0A84FF
// documents the accent token's own value — is prose, never a matched string
// literal: the rule reads the AST, not raw comment text.

import { darkTheme } from '../../src/design-system/theme';

export const accentColor = darkTheme.colors.accent;

export const positiveColor = darkTheme.colors.positive;

export const negativeColor = darkTheme.colors.negative;

// A hex-shaped literal that is too short (2 digits) or too long (10 digits)
// to be a real hex color — `kiko-no-raw-color-literal`'s anchored
// `{3,8}` count must not match either.
export const notLongEnoughToBeAHex = '#12';

export const tooLongToBeAHex = '#1234567890';

export const notAColorAtAll = 'just some ordinary text';
