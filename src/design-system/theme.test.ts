import { chartSeriesDark, entityColorsDark } from './palette';
import { darkTheme } from './theme';

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
    // Locks the onAccent value: a regression to black here would otherwise pass
    // every existing test.
    expect(darkTheme.colors.onAccent).toBe('#FFFFFF');
  });
});

describe('theme references its palette sets', () => {
  it('references the dark entityColors/chartSeries sets', () => {
    expect(darkTheme.colors.entityColors).toBe(entityColorsDark);
    expect(darkTheme.colors.chartSeries).toBe(chartSeriesDark);
  });
});

describe('entity/chart palettes', () => {
  it('exposes the named entity-color tokens as valid hex', () => {
    for (const hue of Object.values(entityColorsDark)) {
      expect(hue).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
    expect(entityColorsDark.blue).toBe('#0A84FF');
    expect(entityColorsDark.green).toBe('#30D158');
  });

  it('keeps every entity-color swatch visually distinct', () => {
    const hues = Object.values(entityColorsDark);
    expect(new Set(hues).size).toBe(hues.length);
  });

  // Entity `blue` equals the dark accent (both are the system blue of dark mode).
  it('pins the entity blue to the dark accent', () => {
    expect(darkTheme.colors.entityColors.blue).toBe(entityColorsDark.blue);
    expect(darkTheme.colors.entityColors.blue).toBe(darkTheme.colors.accent);
  });

  it('exposes a categorical chart palette of >= 6 distinct hex hues', () => {
    expect(chartSeriesDark.length).toBeGreaterThanOrEqual(6);
    for (const hue of chartSeriesDark) {
      expect(hue).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
    expect(new Set(chartSeriesDark).size).toBe(chartSeriesDark.length);
  });
});
