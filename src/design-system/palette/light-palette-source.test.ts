import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { Theme } from '@react-navigation/native';
import { navigationDarkTheme, navigationLightTheme } from '@kiko/navigation/navigation-theme';

import { darkTheme, lightTheme } from '../theme';

import { chartSeriesDark, entityColorsDark } from './palette';

type SwatchFile = Record<string, { dark: string; light: string }>;
type NavigationColor = keyof Theme['colors'];

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
  markSwatches: Record<string, { light: string }>;
  chartSeries: { keys: string[]; dark: string[]; light: string[] };
  iconTile: { glyph: { onLightTile: { dark: string; light: string } } };
  navigation: Record<string, { token: string } | { dark: string; light: string }>;
  chartParameters: {
    netWorthAreaOpacity: { dark: number; light: number };
    netWorthNegativeAreaOpacity: { dark: number; light: number };
  };
};

// The themes are `as const` literals; the pins index them by names read from the file.
const darkColors: Record<string, unknown> = darkTheme.colors;
const lightColors: Record<string, unknown> = lightTheme.colors;

const NEW_COLOR_KEYS = ['categoryColors', 'glyphOnLightTile', 'fieldBackground'];

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

  // markColor is read at run time: the red is the missing function or a wrong shade, not a failed
  // import.
  it('every light swatch mark equals markSwatches', () => {
    const { markColor } = jest.requireActual('@kiko/design-system/entity-tint') as {
      markColor?: (hex: string, scheme: 'dark' | 'light') => string;
    };

    expect(markColor).toBeInstanceOf(Function);

    const tilesByName = [palette.entitySwatches, palette.categorySwatches].flatMap((swatches) =>
      Object.entries(valuesOf(swatches, 'light')),
    );

    expect(tilesByName).toHaveLength(28);
    expect(Object.keys(palette.markSwatches).sort()).toEqual(
      Object.keys(palette.entitySwatches).sort(),
    );

    for (const [name, tile] of tilesByName) {
      expect(markColor?.(tile, 'light')).toBe(palette.markSwatches[name].light);
    }
  });

  it('dark swatches stay byte-identical', () => {
    expect(entityColorsDark).toEqual({
      white: '#FFFFFF',
      khaki: '#BDB76B',
      brown: '#AC8E68',
      yellow: '#FFD60A',
      blue: '#0A84FF',
      green: '#30D158',
      mint: '#66D4CF',
      violet: '#BF5AF2',
      red: '#FF453A',
      orange: '#FF9F0A',
      teal: '#40C8E0',
      pink: '#FF375F',
      indigo: '#5E5CE6',
      gray: '#98989D',
    });
    expect(chartSeriesDark).toEqual([
      '#0A84FF',
      '#30D158',
      '#FF9F0A',
      '#BF5AF2',
      '#40C8E0',
      '#FF375F',
      '#FFD60A',
      '#5E5CE6',
    ]);
    expect(palette.chartSeries.dark).toEqual([...chartSeriesDark]);
    expect(valuesOf(palette.entitySwatches, 'dark')).toEqual(entityColorsDark);
    expect(valuesOf(palette.categorySwatches, 'dark')).toEqual(entityColorsDark);
  });

  it('pins the glyph on a light tile to the file', () => {
    expect(darkTheme.colors.glyphOnLightTile).toBe(palette.iconTile.glyph.onLightTile.dark);
    expect(lightTheme.colors.glyphOnLightTile).toBe(palette.iconTile.glyph.onLightTile.light);
  });

  it('maps each navigation color of both navigation themes as the file names it', () => {
    for (const [name, entry] of Object.entries(palette.navigation)) {
      if ('token' in entry) {
        expect(navigationDarkTheme.colors[name as NavigationColor]).toBe(darkColors[entry.token]);
        expect(navigationLightTheme.colors[name as NavigationColor]).toBe(lightColors[entry.token]);
      } else {
        expect(navigationDarkTheme.colors[name as NavigationColor]).toBe(entry.dark);
        expect(navigationLightTheme.colors[name as NavigationColor]).toBe(entry.light);
      }
    }
  });

  it('names every color of the navigation themes in the file', () => {
    expect(Object.keys(palette.navigation).sort()).toEqual(
      Object.keys(navigationLightTheme.colors).sort(),
    );
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

  // `rowBand` and `sumTint` sit in this snapshot, not in NEW_COLOR_KEYS: listing them there would
  // drop them from the dark lock.
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
      accentSubtle: 'rgba(10,132,255,0.18)',
      onAccent: '#FFFFFF',
      positive: '#30D158',
      negative: '#FF453A',
      negativeSubtle: 'rgba(255,69,58,0.18)',
      neutralSubtle: 'rgba(118,118,128,0.24)',
      border: '#38383A',
      rowBand: 'rgba(255,255,255,0.04)',
      sumTint: 'rgba(255,255,255,0.10)',
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
