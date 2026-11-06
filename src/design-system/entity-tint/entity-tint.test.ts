import { sweep } from '@kiko/test-support/property-sweep';
import { seededRandom } from '@kiko/test-support/seeded-random';

import {
  type SwatchName,
  categoryColorsLight,
  entityColorsDark,
  entityColorsLight,
} from '../palette';
import { darkTheme } from '../theme';

import {
  darkenHex,
  categoryDisplayColor,
  entityDisplayColor,
  entityIconTileGradient,
  isLightEntityColor,
  lightenHex,
  resolveEntityColor,
  wcagContrastRatio,
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

describe('entityDisplayColor', () => {
  const SWATCHES = Object.keys(entityColorsDark) as SwatchName[];
  const WHITE = '#FFFFFF';
  const MINIMUM_LIGHT_CONTRAST = 3.4;
  const SEED_SPREAD = 1_000_003;
  const SEEDS = sweep([1, 2, 3, 4, 5, 6, 7, 8]);
  const DRAWS_PER_SEED = 40;

  const hueAndSaturationOf = (hex: string): { hue: number; saturation: number } => {
    const [red, green, blue] = [1, 3, 5].map(
      (start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255,
    );
    const high = Math.max(red, green, blue);
    const low = Math.min(red, green, blue);
    const spread = high - low;
    const saturation = spread / (1 - Math.abs(high + low - 1));

    if (high === red) {
      return { hue: (((green - blue) / spread) * 60 + 360) % 360, saturation };
    }

    if (high === green) {
      return { hue: ((blue - red) / spread + 2) * 60, saturation };
    }

    return { hue: ((red - green) / spread + 4) * 60, saturation };
  };

  const drawHexes = (seed: number): string[] => {
    const random = seededRandom(seed * SEED_SPREAD);
    const channel = (): string =>
      Math.floor(random() * 256)
        .toString(16)
        .padStart(2, '0');

    return Array.from({ length: DRAWS_PER_SEED }, () => `#${channel()}${channel()}${channel()}`);
  };

  it('dark returns the input verbatim, any case, in or out of the set', () => {
    expect(entityDisplayColor('#ff9f0a', 'dark')).toBe('#ff9f0a');
    expect(entityDisplayColor('#FF9F0A', 'dark')).toBe('#FF9F0A');
    expect(entityDisplayColor('#123456', 'dark')).toBe('#123456');
  });

  it('throws on an unset scheme instead of reading it as light', () => {
    expect(() => entityDisplayColor('#FF9F0A', undefined as never)).toThrow();
  });

  it.each(SWATCHES)('light maps %s by key, in either letter case', (name) => {
    expect(entityDisplayColor(entityColorsDark[name], 'light')).toBe(entityColorsLight[name]);
    expect(entityDisplayColor(entityColorsDark[name].toLowerCase(), 'light')).toBe(
      entityColorsLight[name],
    );
  });

  it.each(['#FFFF00', '#00FF00'])(
    'light out of set keeps hue and saturation and clears 3.4 to white: %s',
    (stored) => {
      const shown = entityDisplayColor(stored, 'light');
      const before = hueAndSaturationOf(stored);
      const after = hueAndSaturationOf(shown);

      expect(wcagContrastRatio(stored, WHITE)).toBeLessThan(MINIMUM_LIGHT_CONTRAST);
      expect(wcagContrastRatio(shown, WHITE)).toBeGreaterThanOrEqual(MINIMUM_LIGHT_CONTRAST);
      expect(Math.abs(after.hue - before.hue)).toBeLessThan(2);
      expect(Math.abs(after.saturation - before.saturation)).toBeLessThan(0.03);
    },
  );

  it('light out of set lowers lightness in 1% steps and stops at the first value that passes', () => {
    expect(entityDisplayColor('#FFFF00', 'light')).toBe('#8f8f00');
    expect(entityDisplayColor('#00FF00', 'light')).toBe('#009e00');
  });

  it('light out of set passing 3.4 returns unchanged', () => {
    expect(wcagContrastRatio('#112233', WHITE)).toBeGreaterThanOrEqual(MINIMUM_LIGHT_CONTRAST);
    expect(entityDisplayColor('#112233', 'light')).toBe('#112233');
  });

  it.each(SEEDS)(
    'any valid hex: dark returns it verbatim, light returns a set member or clears 3.4 (seed %i)',
    (seed) => {
      const drawn = drawHexes(seed);
      const members = new Set(Object.values(entityColorsLight));
      const passing = new Set(
        drawn.filter((hex) => wcagContrastRatio(hex, WHITE) >= MINIMUM_LIGHT_CONTRAST),
      );

      expect(passing.size).toBeGreaterThan(0);
      expect(passing.size).toBeLessThan(new Set(drawn).size);

      for (const hex of drawn) {
        const shown = entityDisplayColor(hex, 'light');

        expect(entityDisplayColor(hex, 'dark')).toBe(hex);
        expect(
          members.has(shown) || wcagContrastRatio(shown, WHITE) >= MINIMUM_LIGHT_CONTRAST,
        ).toBe(true);

        if (passing.has(hex)) {
          expect(shown).toBe(hex);
        }
      }
    },
  );
});

describe('categoryDisplayColor', () => {
  const SWATCHES = Object.keys(entityColorsDark) as SwatchName[];
  const OUT_OF_SET = ['#FFFF00', '#00FF00', '#112233', '#FF0000'];
  const MINIMUM_LIGHT_CONTRAST = 3.4;

  it('dark returns the input verbatim, any case, in or out of the set', () => {
    expect(categoryDisplayColor('#ff9f0a', 'dark')).toBe('#ff9f0a');
    expect(categoryDisplayColor('#123456', 'dark')).toBe('#123456');
  });

  it('throws on an unset scheme instead of reading it as light', () => {
    expect(() => categoryDisplayColor('#FF9F0A', undefined as never)).toThrow();
  });

  it.each(SWATCHES)('light maps %s by key to the category set, in either letter case', (name) => {
    expect(categoryDisplayColor(entityColorsDark[name], 'light')).toBe(categoryColorsLight[name]);
    expect(categoryDisplayColor(entityColorsDark[name].toLowerCase(), 'light')).toBe(
      categoryColorsLight[name],
    );
  });

  it('the same dark hex differs by producer where the palette differs', () => {
    const differing = SWATCHES.filter(
      (name) => entityColorsLight[name] !== categoryColorsLight[name],
    );

    expect(differing.length).toBeGreaterThan(0);

    for (const name of differing) {
      expect(categoryDisplayColor(entityColorsDark[name], 'light')).not.toBe(
        entityDisplayColor(entityColorsDark[name], 'light'),
      );
    }
  });

  it.each(OUT_OF_SET)('light out of set takes the entity lightness rule: %s', (stored) => {
    const shown = categoryDisplayColor(stored, 'light');

    expect(shown).toBe(entityDisplayColor(stored, 'light'));
    expect(wcagContrastRatio(shown, '#FFFFFF')).toBeGreaterThanOrEqual(MINIMUM_LIGHT_CONTRAST);
  });
});
