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
  });

  it('exposes a categorical chart palette of >= 6 distinct hex hues', () => {
    const { chartSeries } = darkTheme.colors;

    expect(Array.isArray(chartSeries)).toBe(true);
    expect(chartSeries.length).toBeGreaterThanOrEqual(6);

    for (const hue of chartSeries) {
      expect(hue).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }

    expect(new Set(chartSeries).size).toBe(chartSeries.length);
  });
});
