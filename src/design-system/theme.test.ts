import {
  chartSeriesByScheme,
  chartSeriesDark,
  chartSeriesLight,
  entityColorsByScheme,
  entityColorsDark,
  entityColorsLight,
} from './palette';
import { darkTheme, lightTheme } from './theme';

describe('darkTheme iOS dark palette', () => {
  it('uses Apple dark system color values', () => {
    expect(darkTheme.colors.background).toBe('#000000');
    expect(darkTheme.colors.surface).toBe('#1C1C1E');
    expect(darkTheme.colors.surfaceHigh).toBe('#2C2C2E');
    expect(darkTheme.colors.textPrimary).toBe('#FFFFFF');
    expect(darkTheme.colors.textSecondary).toBe('rgba(235,235,245,0.60)');
    expect(darkTheme.colors.accent).toBe('#0A84FF');
    expect(darkTheme.colors.positive).toBe('#30D158');
    expect(darkTheme.colors.negative).toBe('#FF453A');
    expect(darkTheme.colors.border).toBe('#38383A');
    expect(darkTheme.colors.scrim).toBe('rgba(0,0,0,0.55)');
  });
});

describe('lightTheme iOS light palette', () => {
  it('uses Apple light system color values (spec Section 1 table)', () => {
    expect(lightTheme.colors.background).toBe('#F2F2F7');
    expect(lightTheme.colors.surface).toBe('#FFFFFF');
    expect(lightTheme.colors.surfaceHigh).toBe('#E5E5EA');
    expect(lightTheme.colors.textPrimary).toBe('#000000');
    expect(lightTheme.colors.textSecondary).toBe('rgba(60,60,67,0.60)');
    expect(lightTheme.colors.accent).toBe('#007AFF');
    expect(lightTheme.colors.positive).toBe('#34C759');
    expect(lightTheme.colors.negative).toBe('#FF3B30');
    expect(lightTheme.colors.border).toBe('#C6C6C8');
    expect(lightTheme.colors.scrim).toBe('rgba(0,0,0,0.40)');
  });
});

describe('theme shape invariance', () => {
  it('exposes the identical colors key set on both themes', () => {
    expect(Object.keys(lightTheme.colors).sort()).toEqual(Object.keys(darkTheme.colors).sort());
  });

  it('exposes the identical entityColors key set on both themes', () => {
    expect(Object.keys(lightTheme.colors.entityColors).sort()).toEqual(
      Object.keys(darkTheme.colors.entityColors).sort(),
    );
  });

  it('exposes an equal-length chartSeries on both themes', () => {
    expect(lightTheme.colors.chartSeries.length).toBe(darkTheme.colors.chartSeries.length);
  });

  // REVERSAL (spec Section 1 per-theme decision): each theme references its OWN
  // per-theme set, NOT one shared palette. Dark theme -> dark sets, light theme
  // -> light sets, and the two sets are distinct objects.
  it('references its own per-theme entityColors/chartSeries set (not a shared palette)', () => {
    expect(darkTheme.colors.entityColors).toBe(entityColorsDark);
    expect(darkTheme.colors.entityColors).not.toBe(entityColorsLight);
    expect(lightTheme.colors.entityColors).toBe(entityColorsLight);
    expect(lightTheme.colors.entityColors).not.toBe(entityColorsDark);
    expect(darkTheme.colors.chartSeries).toBe(chartSeriesDark);
    expect(darkTheme.colors.chartSeries).not.toBe(chartSeriesLight);
    expect(lightTheme.colors.chartSeries).toBe(chartSeriesLight);
    expect(lightTheme.colors.chartSeries).not.toBe(chartSeriesDark);
  });

  it('shares spacing, radii, and typography across both themes', () => {
    expect(lightTheme.spacing).toBe(darkTheme.spacing);
    expect(lightTheme.radii).toBe(darkTheme.radii);
    expect(lightTheme.typography).toBe(darkTheme.typography);
  });
});

describe('per-theme entity/chart palettes', () => {
  it('exposes the fourteen named entity-color tokens as valid hex in both sets', () => {
    for (const set of [entityColorsDark, entityColorsLight]) {
      for (const hue of Object.values(set)) {
        expect(hue).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
    // Dark set: Apple dark system values.
    expect(entityColorsDark.blue).toBe('#0A84FF');
    expect(entityColorsDark.green).toBe('#30D158');
    // Light set: Apple light system values.
    expect(entityColorsLight.blue).toBe('#007AFF');
    expect(entityColorsLight.green).toBe('#34C759');
  });

  it('keeps every entity-color swatch visually distinct within each set', () => {
    for (const set of [entityColorsDark, entityColorsLight]) {
      const hues = Object.values(set);
      expect(new Set(hues).size).toBe(hues.length);
    }
  });

  // Spec Section 7: entity `blue` now differs per theme; assert each theme's
  // entity `blue` against that SAME theme's own per-theme set, never a shared
  // value and never the other theme's accent. In dark, entity blue equals the
  // dark accent; in light, entity blue equals the light accent (both are the
  // system blue of their mode).
  it('pins each theme entity blue to its OWN per-theme set', () => {
    expect(darkTheme.colors.entityColors.blue).toBe(entityColorsDark.blue);
    expect(lightTheme.colors.entityColors.blue).toBe(entityColorsLight.blue);
    expect(darkTheme.colors.entityColors.blue).toBe(darkTheme.colors.accent);
    expect(lightTheme.colors.entityColors.blue).toBe(lightTheme.colors.accent);
  });

  it('exposes a categorical chart palette of >= 6 distinct hex hues in both sets', () => {
    for (const series of [chartSeriesDark, chartSeriesLight]) {
      expect(series.length).toBeGreaterThanOrEqual(6);
      for (const hue of series) {
        expect(hue).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
      expect(new Set(series).size).toBe(series.length);
    }
  });
});

describe('scheme-keyed palette lookups', () => {
  it('maps each color scheme to its own per-theme entity/chart set', () => {
    expect(entityColorsByScheme.dark).toBe(entityColorsDark);
    expect(entityColorsByScheme.light).toBe(entityColorsLight);
    expect(chartSeriesByScheme.dark).toBe(chartSeriesDark);
    expect(chartSeriesByScheme.light).toBe(chartSeriesLight);
  });

  it('keys both lookups by exactly the two color schemes', () => {
    expect(Object.keys(entityColorsByScheme).sort()).toEqual(['dark', 'light']);
    expect(Object.keys(chartSeriesByScheme).sort()).toEqual(['dark', 'light']);
  });
});
