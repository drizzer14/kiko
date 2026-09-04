import { darkTheme } from './theme';
import {
  ENTITY_TINT_OPACITY,
  entityGradientStops,
  entityTintBackground,
  lightenHex,
  resolveEntityColor,
} from './entity-tint';

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

describe('lightenHex', () => {
  it('moves every channel toward white by the given percent', () => {
    // 50% of the way from 0 to 255 is 128 (0x80); from 255 stays 255.
    expect(lightenHex('#000000', 50)).toBe('#808080');
    expect(lightenHex('#FFFFFF', 50)).toBe('#ffffff');
  });

  it('accepts a lowercase hex the same way as uppercase', () => {
    expect(lightenHex('#ff453a', 10)).toBe(lightenHex('#FF453A', 10));
  });

  it('is a no-op at 0%', () => {
    expect(lightenHex('#FF453A', 0)).toBe('#ff453a');
  });
});

describe('entityGradientStops', () => {
  it('returns the flat tint as `from` and a lightened tint of the same hue as `to`', () => {
    const { from, to } = entityGradientStops('#FF453A');

    expect(from).toBe(entityTintBackground('#FF453A'));
    expect(to).toBe(entityTintBackground(lightenHex('#FF453A', 10)));
    expect(to).not.toBe(from);
  });

  // `opacity` must ride alongside `from`/`to` rather than be re-derived from
  // the rgba() strings by the consumer — see the doc comment on
  // `entityGradientStops` for why `GlassSurface` needs it as a standalone
  // number for react-native-svg's `<Stop stopOpacity>` prop.
  it('returns the shared ENTITY_TINT_OPACITY as `opacity`', () => {
    const { opacity } = entityGradientStops('#FF453A');

    expect(opacity).toBe(ENTITY_TINT_OPACITY);
  });
});

describe('resolveEntityColor', () => {
  it('prefers a valid stored hex over the type default', () => {
    expect(
      resolveEntityColor(darkTheme.colors.entityColors.violet, darkTheme.colors.entityColors.blue),
    ).toBe(darkTheme.colors.entityColors.violet);
  });

  it('falls back to the type default when the stored color is null', () => {
    expect(resolveEntityColor(null, darkTheme.colors.entityColors.khaki)).toBe(
      darkTheme.colors.entityColors.khaki,
    );
  });

  it('falls back to the type default when the stored color is undefined', () => {
    expect(resolveEntityColor(undefined, darkTheme.colors.entityColors.khaki)).toBe(
      darkTheme.colors.entityColors.khaki,
    );
  });

  // A bare `stored ?? typeDefault` lets a stored empty string straight through
  // (it is neither `null` nor `undefined`), which used to reach
  // `entityTintBackground` and throw. This is the "empty string" gap.
  it('falls back to the type default when the stored color is an empty string', () => {
    expect(resolveEntityColor('', darkTheme.colors.entityColors.khaki)).toBe(
      darkTheme.colors.entityColors.khaki,
    );
  });

  // The type default lookup itself (`defaultAccountColor[kind]` /
  // `defaultHoldingColor[type]`) is only a compile-time guarantee — SQLite
  // enforces no CHECK constraint on the `kind`/`type` column, so a row written
  // under a since-removed enum member (e.g. the dropped `broker` account kind)
  // resolves its own default to `undefined` at runtime. This is the "unmapped
  // key" gap; a valid last-resort color must still come out the other end.
  it('falls back to the safe default swatch when both the stored color and the type default are unusable', () => {
    const resolved = resolveEntityColor(null, undefined);

    expect(resolved).toBe(darkTheme.colors.entityColors.gray);
    // The fallback itself must be a valid hex `entityTintBackground` accepts,
    // so a card's gradient never throws.
    expect(() => entityTintBackground(resolved)).not.toThrow();
  });

  it('falls back to the safe default swatch when the stored color is an empty string and the type default is unmapped', () => {
    expect(resolveEntityColor('', undefined)).toBe(darkTheme.colors.entityColors.gray);
  });
});
