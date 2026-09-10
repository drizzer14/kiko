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

describe('icon-size token scale', () => {
  // Every icon size is 1.25x its paired type-scale step, rounded to the nearest
  // point (iOS HIG: a symbol reads as a peer of, and slightly heavier than, the
  // text beside it). `body` is the default icon size. See theme.ts.
  const RATIO = 1.25;

  it('exposes one icon size per type-scale step', () => {
    expect(Object.keys(darkTheme.iconSizes).sort()).toEqual([
      'body',
      'caption',
      'display',
      'heading',
      'title',
    ]);
  });

  it('ties each icon size to its paired type token at the 1.25x ratio', () => {
    expect(darkTheme.iconSizes.caption).toBe(
      Math.round(darkTheme.typography.caption.fontSize * RATIO),
    );
    expect(darkTheme.iconSizes.body).toBe(Math.round(darkTheme.typography.body.fontSize * RATIO));
    expect(darkTheme.iconSizes.heading).toBe(
      Math.round(darkTheme.typography.heading.fontSize * RATIO),
    );
    expect(darkTheme.iconSizes.title).toBe(Math.round(darkTheme.typography.title.fontSize * RATIO));
    expect(darkTheme.iconSizes.display).toBe(
      Math.round(darkTheme.typography.display.fontSize * RATIO),
    );
  });

  it('pins the intended point values so a ratio change is a conscious edit', () => {
    expect(darkTheme.iconSizes).toEqual({
      caption: 16,
      body: 20,
      heading: 25,
      title: 35,
      display: 55,
    });
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
