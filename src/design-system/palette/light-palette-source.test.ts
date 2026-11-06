import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import { darkTheme, lightTheme } from '../theme';

import { chartSeriesDark, entityColorsDark } from './palette';

type SwatchFile = Record<string, { dark: string; light: string }>;

const palette = JSON.parse(
  readFileSync(join(__dirname, '../../../docs/design/light-palette/palette.json'), 'utf8'),
) as {
  decisions: {
    pageBackground: { chosen: string };
    segmentedThumb: { chosen: string };
  };
  tokens: SwatchFile;
  entitySwatches: SwatchFile;
  categorySwatches: SwatchFile;
  chartSeries: { keys: string[]; dark: string[]; light: string[] };
  iconTile: { glyph: { onLightTile: { dark: string; light: string } } };
  chartParameters: {
    netWorthAreaOpacity: { dark: number; light: number };
    netWorthNegativeAreaOpacity: { dark: number; light: number };
  };
};

// The themes are `as const` literals; the pins index them by names read from the file.
const darkColors: Record<string, unknown> = darkTheme.colors;
const lightColors: Record<string, unknown> = lightTheme.colors;

const NEW_COLOR_KEYS = ['categoryColors', 'glyphOnLightTile'];

// Every key path of a plain object or array, so a missing nested key shows by name.
const keyPaths = (value: unknown, prefix = ''): string[] =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([key, child]) => [
        `${prefix}${key}`,
        ...keyPaths(child, `${prefix}${key}.`),
      ])
    : [];

const valuesOf = (swatches: SwatchFile, scheme: 'dark' | 'light'): Record<string, string> =>
  Object.fromEntries(Object.entries(swatches).map(([name, values]) => [name, values[scheme]]));

describe('the approved light palette file', () => {
  it('records the approved page background and segmented thumb decisions', () => {
    expect(palette.decisions.pageBackground.chosen).toBe('A');
    expect(palette.decisions.segmentedThumb.chosen).toBe('A');
  });

  it('every light and dark token equals the approved palette file', () => {
    for (const [name, { dark, light }] of Object.entries(palette.tokens)) {
      expect(darkColors[name]).toBe(dark);
      expect(lightColors[name]).toBe(light);
    }
  });

  it('entity, category and chart sets equal the file', () => {
    expect(lightTheme.colors.entityColors).toEqual(valuesOf(palette.entitySwatches, 'light'));
    expect(lightTheme.colors.categoryColors).toEqual(valuesOf(palette.categorySwatches, 'light'));
    expect(lightTheme.colors.chartSeries).toEqual(palette.chartSeries.light);
    expect(chartSeriesDark).toEqual(palette.chartSeries.dark);
    expect(entityColorsDark).toEqual(valuesOf(palette.entitySwatches, 'dark'));
    expect(darkTheme.colors.categoryColors).toEqual(valuesOf(palette.categorySwatches, 'dark'));
    expect(palette.chartSeries.light).toEqual(
      palette.chartSeries.keys.map((key) => palette.categorySwatches[key].light),
    );
  });

  it('pins the glyph on a light tile to the file', () => {
    expect(darkTheme.colors.glyphOnLightTile).toBe(palette.iconTile.glyph.onLightTile.dark);
    expect(lightTheme.colors.glyphOnLightTile).toBe(palette.iconTile.glyph.onLightTile.light);
  });

  it('pins the net-worth area opacities of each theme to the file', () => {
    const { netWorthAreaOpacity, netWorthNegativeAreaOpacity } = palette.chartParameters;

    expect(darkTheme.chartFill).toEqual({
      areaOpacity: netWorthAreaOpacity.dark,
      negativeAreaOpacity: netWorthNegativeAreaOpacity.dark,
    });
    expect(lightTheme.chartFill).toEqual({
      areaOpacity: netWorthAreaOpacity.light,
      negativeAreaOpacity: netWorthNegativeAreaOpacity.light,
    });
  });

  it('dark area opacities stay 0.3 and 0.5', () => {
    expect(darkTheme.chartFill).toEqual({ areaOpacity: 0.3, negativeAreaOpacity: 0.5 });
  });

  it('lightTheme has exactly the keys of darkTheme, at every depth', () => {
    expect(keyPaths(lightTheme).sort()).toEqual(keyPaths(darkTheme).sort());
  });

  it('declares its color scheme on each theme', () => {
    expect(darkTheme.colorScheme).toBe('dark');
    expect(lightTheme.colorScheme).toBe('light');
  });

  // The dark look is locked: this is the dark theme as it stood before the light set.
  it('dark values did not change: darkTheme.colors minus the new keys equals its base snapshot', () => {
    const base = {
      background: '#000000',
      surface: '#111112',
      surfaceTranslucent: 'rgba(28,28,30,0.60)',
      surfaceTranslucentStrong: 'rgba(28,28,30,0.80)',
      surfaceWashStrong: 'rgba(0,0,0,0.38)',
      surfaceHigh: '#2C2C2E',
      sheetBackground: '#1C1C1E',
      segmentSelected: '#747478',
      textPrimary: '#FFFFFF',
      textSecondary: 'rgba(235,235,245,0.60)',
      accent: '#0A84FF',
      onAccent: '#FFFFFF',
      positive: '#30D158',
      negative: '#FF453A',
      negativeSubtle: 'rgba(255,69,58,0.18)',
      neutralSubtle: 'rgba(118,118,128,0.24)',
      border: '#38383A',
      scrim: 'rgba(0,0,0,0.4)',
      scrimFallback: 'rgba(0,0,0,0.55)',
      entityColors: entityColorsDark,
      chartSeries: chartSeriesDark,
    };
    const withoutNewKeys = Object.fromEntries(
      Object.entries(darkTheme.colors).filter(([key]) => !NEW_COLOR_KEYS.includes(key)),
    );

    expect(withoutNewKeys).toEqual(base);
  });
});
