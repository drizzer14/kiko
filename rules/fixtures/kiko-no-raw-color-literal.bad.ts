// Semgrep fixture (POSITIVE): kiko-design-system's "Token categories" —
// components read the color token, never a raw hex or rgba()/rgb() string
// literal. `kiko-no-raw-color-literal` MUST report a finding on each pinned
// line below, whether the literal is single- or double-quoted, a short or
// long hex run, or an rgb()/rgba() function string.

// EXPECT-FINDING
export const rawHexShort = '#FFF';

// EXPECT-FINDING
export const rawHexSixDigit = '#FF0000';

// EXPECT-FINDING
export const rawHexEightDigit = '#FF0000FF';

// EXPECT-FINDING
export const rawHexDoubleQuoted = '#0A84FF';

// EXPECT-FINDING
export const rawRgbLiteral = 'rgb(255, 0, 0)';

// EXPECT-FINDING
export const rawRgbaLiteral = 'rgba(255, 0, 0, 0.5)';
