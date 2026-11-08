import { darkTheme, lightTheme } from '../theme';
import { entityIconTileGradient, wcagContrastRatio } from '../entity-tint';

import { type SwatchName, chartSeriesDark, entityColorsDark } from './palette';

// WCAG 1.4.11 non-text contrast: the floor for a dark tile against its page and card, and for a
// glyph against its tile. It never drops; a failing case is a palette finding, not a test to
// loosen.
const FLOOR = 3;
const TEXT_FLOOR = 4.5;
const MARK_FLOOR = 3.05;

// Read at run time: the red is the missing function, not a failed import.
const { markColor, prefersDarkGlyph } = jest.requireActual('@kiko/design-system/entity-tint') as {
  markColor: (hex: string, scheme: 'dark' | 'light') => string;
  prefersDarkGlyph: (hex: string, scheme: 'dark' | 'light') => boolean;
};

type Scheme = {
  colors: {
    background: string;
    surface: string;
    onAccent: string;
    glyphOnLightTile: string;
  };
};

const casesOf = (label: string, scheme: Scheme, swatches: Record<string, string>) =>
  Object.entries(swatches).map(([name, hex]) => [`${label} ${name}`, hex, scheme] as const);

const darkCases = casesOf('dark entity', darkTheme, darkTheme.colors.entityColors);
const lightCases = [
  ...casesOf('light entity', lightTheme, lightTheme.colors.entityColors),
  ...casesOf('light category', lightTheme, lightTheme.colors.categoryColors),
];

const glyphOf = (hex: string, scheme: Scheme, which: 'dark' | 'light'): string =>
  prefersDarkGlyph(hex, which) ? scheme.colors.glyphOnLightTile : scheme.colors.onAccent;

describe('palette contrast: dark entity tiles', () => {
  it.each(darkCases)('%s tile holds 3:1 against page and card', (_label, hex, scheme) => {
    expect(wcagContrastRatio(hex, scheme.colors.background)).toBeGreaterThanOrEqual(FLOOR);
    expect(wcagContrastRatio(hex, scheme.colors.surface)).toBeGreaterThanOrEqual(FLOOR);
  });

  it.each(darkCases)('%s glyph holds 3:1 on its tile', (_label, hex, scheme) => {
    expect(wcagContrastRatio(glyphOf(hex, scheme, 'dark'), hex)).toBeGreaterThanOrEqual(FLOOR);
  });
});

// No light tile-vs-page 3:1 case, on purpose: the user waived it on 2026-11-08 (the palette
// plan's light-tile ruling), so the glyph and the mark carry the contrast instead.
describe('palette contrast: light tiles', () => {
  it.each(lightCases)('%s glyph holds 4.5:1 on the base', (_label, hex, scheme) => {
    expect(wcagContrastRatio(glyphOf(hex, scheme, 'light'), hex)).toBeGreaterThanOrEqual(
      TEXT_FLOOR,
    );
  });

  it.each(lightCases)('%s glyph holds 3:1 on both gradient stops', (_label, hex, scheme) => {
    const glyph = glyphOf(hex, scheme, 'light');

    for (const stop of entityIconTileGradient(hex)) {
      expect(wcagContrastRatio(glyph, stop)).toBeGreaterThanOrEqual(FLOOR);
    }
  });

  it.each(lightCases)('%s mark holds 3.05:1 on page and card', (_label, hex, scheme) => {
    const mark = markColor(hex, 'light');

    expect(wcagContrastRatio(mark, scheme.colors.background)).toBeGreaterThanOrEqual(MARK_FLOOR);
    expect(wcagContrastRatio(mark, scheme.colors.surface)).toBeGreaterThanOrEqual(MARK_FLOOR);
  });
});

describe('palette chart series', () => {
  it('chartSeriesLight is a subset of categorySwatches light', () => {
    const categoryHexes = new Set(Object.values(lightTheme.colors.categoryColors));
    const missing = lightTheme.colors.chartSeries.filter((hex) => !categoryHexes.has(hex));

    expect(missing).toEqual([]);
  });

  it('chartSeriesDark mapped by key equals chartSeriesLight', () => {
    const nameOfHex = Object.fromEntries(
      Object.entries(entityColorsDark).map(([name, hex]) => [hex, name]),
    ) as Record<string, SwatchName>;
    const mapped = chartSeriesDark.map((hex) => lightTheme.colors.categoryColors[nameOfHex[hex]]);

    expect(mapped).toEqual([...lightTheme.colors.chartSeries]);
  });
});
