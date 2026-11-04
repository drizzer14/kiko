import { darkTheme, lightTheme } from '../theme';
import { isLightEntityColor, wcagContrastRatio } from '../entity-tint';

import { type SwatchName, chartSeriesDark, entityColorsDark } from './palette';

// WCAG 1.4.11 non-text contrast: the floor for a tile against its page and card, and for a glyph
// against its tile. It never drops; a failing case is a palette finding, not a test to loosen.
const FLOOR = 3;

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

const cases = [
  ...casesOf('dark entity', darkTheme, darkTheme.colors.entityColors),
  ...casesOf('light entity', lightTheme, lightTheme.colors.entityColors),
  ...casesOf('light category', lightTheme, lightTheme.colors.categoryColors),
];

describe('palette contrast: no invisible tile', () => {
  it.each(cases)('%s tile holds 3:1 against page and card', (_label, hex, scheme) => {
    expect(wcagContrastRatio(hex, scheme.colors.background)).toBeGreaterThanOrEqual(FLOOR);
    expect(wcagContrastRatio(hex, scheme.colors.surface)).toBeGreaterThanOrEqual(FLOOR);
  });

  // The glyph follows the EntityIconTile rule, measured against the base hue and never a gradient
  // stop: white `onAccent` unless the base is too light for it, then `glyphOnLightTile`.
  it.each(cases)('%s glyph holds 3:1 on its tile', (_label, hex, scheme) => {
    const glyph = isLightEntityColor(hex) ? scheme.colors.glyphOnLightTile : scheme.colors.onAccent;

    expect(wcagContrastRatio(glyph, hex)).toBeGreaterThanOrEqual(FLOOR);
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
