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

  it('exposes the twelve named entity-color tokens as valid hex', () => {
    const { entityColors } = darkTheme.colors;

    expect(entityColors.white).toBe('#FFFFFF');
    expect(entityColors.khaki).toBe('#BDB76B');
    expect(entityColors.yellow).toBe('#FFD60A');
    expect(entityColors.blue).toBe('#0A84FF');
    expect(entityColors.green).toBe('#30D158');
    expect(entityColors.violet).toBe('#BF5AF2');
    expect(entityColors.red).toBe('#FF453A');
    expect(entityColors.orange).toBe('#FF9F0A');
    expect(entityColors.teal).toBe('#40C8E0');
    expect(entityColors.pink).toBe('#FF375F');
    expect(entityColors.indigo).toBe('#5E5CE6');
    expect(entityColors.gray).toBe('#98989D');

    for (const hue of Object.values(entityColors)) {
      expect(hue).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('keeps every entity-color swatch visually distinct', () => {
    const { entityColors } = darkTheme.colors;
    const hues = Object.values(entityColors);

    expect(new Set(hues).size).toBe(hues.length);
  });

  it('keeps one source of truth: entity blue aliases accent, entity green aliases positive', () => {
    expect(darkTheme.colors.entityColors.blue).toBe(darkTheme.colors.accent);
    expect(darkTheme.colors.entityColors.green).toBe(darkTheme.colors.positive);
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
