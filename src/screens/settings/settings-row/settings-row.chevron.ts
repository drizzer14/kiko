import type { UnistylesThemes } from 'react-native-unistyles';

// The registered app theme (dark | light) — same pattern as
// `disabled-field-style.ts`'s `AppTheme`.
type AppTheme = UnistylesThemes[keyof UnistylesThemes];

// The row's trailing chevron is sized to match its TITLE's font size exactly
// (device-feedback round-7 item 2) — the row's own `label` Text renders at
// `variant="body"`, so the chevron reads as a peer of the title rather than
// the oversized default `iconSizes.body` (fontSize * 1.25) SymbolIcon falls
// back to with no explicit `size`. Exported so the settings screen (the
// group divider's right-inset math below) and the row component derive the
// SAME value rather than two call sites drifting apart.
export const chevronSize = (theme: AppTheme): number => theme.typography.body.fontSize;

// An SF Symbol glyph does not fill its square render frame — `chevron.right`
// in particular sits centered with visible whitespace on both sides, since a
// chevron's natural aspect ratio is narrower than the tall/wide symbols that
// share its type-scale box. Apple's SF Symbols catalog draws `chevron.right`
// (Regular weight) at roughly 55% of its frame's width, so ~45% of the frame
// is empty, split evenly left/right of the glyph. This is a documented
// approximation (device-feedback round-7 item 1), not a measured on-device
// value — Fabric/Jest has no way to introspect the native glyph's rendered
// path — chosen to be conservative rather than overshoot the glyph's real
// right edge.
const CHEVRON_GLYPH_WIDTH_RATIO = 0.55;

// The gap between the chevron glyph's visible right edge and its render
// frame's right edge, rounded OUT to the nearest 4pt spacing-scale step
// (`theme.spacing(1)`) so the resulting divider inset stays a value on the
// shared spacing grid rather than a sub-pixel fraction.
export const chevronTrailingWhitespace = (size: number, theme: AppTheme): number => {
  const rawWhitespace = (size * (1 - CHEVRON_GLYPH_WIDTH_RATIO)) / 2;
  const step = theme.spacing(1);

  return Math.round(rawWhitespace / step) * step;
};
