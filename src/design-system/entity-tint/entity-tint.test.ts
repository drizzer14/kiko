import { darkTheme } from '../theme';

import {
  darkenHex,
  entityIconTileGradient,
  isLightEntityColor,
  lightenHex,
  resolveEntityColor,
} from './entity-tint';

describe('darkenHex', () => {
  it('moves every channel toward black by the given percent', () => {
    // 50% of the way from 255 to 0 is 128 (0x80); from 0 stays 0.
    expect(darkenHex('#FFFFFF', 50)).toBe('#808080');
    expect(darkenHex('#000000', 50)).toBe('#000000');
  });

  it('accepts a lowercase hex the same way as uppercase', () => {
    expect(darkenHex('#ff453a', 10)).toBe(darkenHex('#FF453A', 10));
  });

  it('is a no-op at 0%', () => {
    expect(darkenHex('#FF453A', 0)).toBe('#ff453a');
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

describe('entityIconTileGradient', () => {
  it('returns a [top, bottom] pair of opaque #RRGGBB hexes', () => {
    const [top, bottom] = entityIconTileGradient('#FF453A');

    expect(top).toMatch(/^#[0-9a-f]{6}$/i);
    expect(bottom).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('lightens the top stop and darkens the bottom stop from the same base hue', () => {
    const [top, bottom] = entityIconTileGradient('#FF453A');

    expect(top).toBe(lightenHex('#FF453A', 15));
    expect(bottom).toBe(darkenHex('#FF453A', 20));
  });

  it('produces a distinct pair for every entity-color swatch in the theme', () => {
    const pairs = Object.values(darkTheme.colors.entityColors).map((hex) =>
      entityIconTileGradient(hex).join(':'),
    );

    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('throws on a non-hex input, same as its building blocks', () => {
    expect(() => entityIconTileGradient('not-a-hex')).toThrow(
      'parseHex: expected a #RRGGBB hex, received "not-a-hex"',
    );
  });
});

describe('isLightEntityColor', () => {
  // The concrete swatches the review flagged as failing WCAG AA with a fixed
  // white glyph — see `palette.ts`'s `entityColorsDark` and
  // `entity-tint.ts`'s `LIGHT_TILE_BRIGHTNESS_THRESHOLD` doc comment for the
  // brightness numbers behind each one.
  it.each([
    ['white', darkTheme.colors.entityColors.white],
    ['yellow', darkTheme.colors.entityColors.yellow],
    ['khaki', darkTheme.colors.entityColors.khaki],
    ['mint', darkTheme.colors.entityColors.mint],
    ['teal', darkTheme.colors.entityColors.teal],
  ])('flags the light %s swatch as needing a dark glyph', (_name, hex) => {
    expect(isLightEntityColor(hex)).toBe(true);
  });

  // A dark, already-legible-with-white-glyph swatch stays `false`, so
  // `EntityIconTile` keeps painting its glyph with the standard white
  // `onAccent` tint on it.
  it.each([
    ['blue', darkTheme.colors.entityColors.blue],
    ['indigo', darkTheme.colors.entityColors.indigo],
    ['pink', darkTheme.colors.entityColors.pink],
    ['red', darkTheme.colors.entityColors.red],
  ])('does not flag the dark %s swatch', (_name, hex) => {
    expect(isLightEntityColor(hex)).toBe(false);
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
  // (it is neither `null` nor `undefined`), which would reach
  // `entityIconTileGradient`/`isLightEntityColor` and throw. This is the
  // "empty string" gap.
  it('falls back to the type default when the stored color is an empty string', () => {
    expect(resolveEntityColor('', darkTheme.colors.entityColors.khaki)).toBe(
      darkTheme.colors.entityColors.khaki,
    );
  });

  // The type default lookup itself (`defaultAccountColor[kind]` /
  // `defaultHoldingColor[type]`) is only a compile-time guarantee — SQLite
  // enforces no CHECK constraint on the `kind`/`type` column, so a row written
  // under a kind or type outside the current list resolves its own default to
  // `undefined` at runtime. This is the "unmapped key" gap; a valid
  // last-resort color must still come out the other end.
  it('falls back to the safe default swatch when both the stored color and the type default are unusable', () => {
    const resolved = resolveEntityColor(null, undefined);

    expect(resolved).toBe(darkTheme.colors.entityColors.gray);
    // The fallback itself must be a valid hex the entity-hue derivers accept,
    // so an icon tile's gradient never throws.
    expect(() => entityIconTileGradient(resolved)).not.toThrow();
  });

  it('falls back to the safe default swatch when the stored color is an empty string and the type default is unmapped', () => {
    expect(resolveEntityColor('', undefined)).toBe(darkTheme.colors.entityColors.gray);
  });

  it('passes an unknown/custom stored hex through unchanged, never breaking a legacy value', () => {
    expect(resolveEntityColor('#123456', undefined)).toBe('#123456');
  });
});
