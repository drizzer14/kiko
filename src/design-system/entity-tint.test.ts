import { darkTheme } from './theme';
import { ENTITY_TINT_OPACITY, entityTintBackground } from './entity-tint';

describe('entityTintBackground', () => {
  it('defaults to the ENTITY_TINT_OPACITY token, in the 8-14% subtle-wash band', () => {
    expect(ENTITY_TINT_OPACITY).toBeGreaterThanOrEqual(0.08);
    expect(ENTITY_TINT_OPACITY).toBeLessThanOrEqual(0.14);
  });

  it('converts an entity-color hex to an rgba() string at the default opacity', () => {
    expect(entityTintBackground('#FF453A')).toBe(`rgba(255, 69, 58, ${ENTITY_TINT_OPACITY})`);
  });

  it('accepts a lowercase hex the same way as uppercase', () => {
    expect(entityTintBackground('#ff453a')).toBe(`rgba(255, 69, 58, ${ENTITY_TINT_OPACITY})`);
  });

  it('honors an explicit opacity override', () => {
    expect(entityTintBackground('#0A84FF', 0.12)).toBe('rgba(10, 132, 255, 0.12)');
  });

  it('produces a distinct rgba() for every entity-color swatch in the theme', () => {
    const { entityColors } = darkTheme.colors;
    const tints = Object.values(entityColors).map((hex) => entityTintBackground(hex));

    expect(new Set(tints).size).toBe(tints.length);
  });

  it('throws on a non-hex input rather than silently producing an invalid color', () => {
    expect(() => entityTintBackground('not-a-hex')).toThrow(
      'entityTintBackground: expected a #RRGGBB hex, received "not-a-hex"',
    );
  });
});
