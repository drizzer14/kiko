import {
  darkenHex,
  ENTITY_TINT_OPACITY,
  entityCardBackground,
  entityTintBackground,
  lightenHex,
  resolveEntityColor,
} from './entity-tint';
import { entityColorsLight, entityColorsDark as palette } from './palette';
import { darkTheme } from './theme';

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

describe('entityCardBackground', () => {
  // F4 device bug: the card used to darken the hue, then stamp it through
  // `entityTintBackground` at the shared 10% `ENTITY_TINT_OPACITY` — a
  // darkened color diluted to ~1% of the final pixel, imperceptible. The
  // fix drops the alpha compositing entirely: a card's background is a
  // plain OPAQUE `#RRGGBB`, not an `entityTintBackground()` rgba() string.
  it('returns an opaque #RRGGBB, never an rgba() string', () => {
    expect(entityCardBackground('#FF453A')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('returns the darkened tint of the resolved hue directly, with no alpha compositing', () => {
    expect(entityCardBackground('#FF453A')).toBe(darkenHex('#FF453A', 90));
  });

  it('differs from the plain (non-darkened) tint of the same hue', () => {
    expect(entityCardBackground('#FF453A')).not.toBe(entityTintBackground('#FF453A'));
  });

  it('reads plainly darker than the raw entity hue on every channel, for every swatch', () => {
    const channels = (hex: string): [number, number, number] => [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
    ];

    for (const hex of Object.values(darkTheme.colors.entityColors)) {
      const [cardRed, cardGreen, cardBlue] = channels(entityCardBackground(hex));
      const [rawRed, rawGreen, rawBlue] = channels(hex);

      expect(cardRed).toBeLessThanOrEqual(rawRed);
      expect(cardGreen).toBeLessThanOrEqual(rawGreen);
      expect(cardBlue).toBeLessThanOrEqual(rawBlue);
    }
  });

  it('produces a distinct opaque color for every entity-color swatch in the theme', () => {
    const { entityColors } = darkTheme.colors;
    const cards = Object.values(entityColors).map((hex) => entityCardBackground(hex));

    expect(new Set(cards).size).toBe(cards.length);
  });

  it('throws on a non-hex input, same as its building blocks', () => {
    expect(() => entityCardBackground('not-a-hex')).toThrow(
      'entityTintBackground: expected a #RRGGBB hex, received "not-a-hex"',
    );
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
    // so a card's background never throws.
    expect(() => entityTintBackground(resolved)).not.toThrow();
  });

  it('falls back to the safe default swatch when the stored color is an empty string and the type default is unmapped', () => {
    expect(resolveEntityColor('', undefined)).toBe(darkTheme.colors.entityColors.gray);
  });
});

describe('lightenHex', () => {
  it('moves every channel toward white by the given percent', () => {
    // 50% of the way from 0 to 255 is ~128 (0x80); from 255 stays 255.
    expect(lightenHex('#000000', 50)).toBe('#808080');
    expect(lightenHex('#FFFFFF', 50)).toBe('#ffffff');
  });

  it('accepts a lowercase hex the same way as uppercase', () => {
    expect(lightenHex('#ff453a', 10)).toBe(lightenHex('#FF453A', 10));
  });

  it('is a no-op at 0%', () => {
    expect(lightenHex('#FF453A', 0)).toBe('#ff453a');
  });

  it('throws on a non-hex input, same as darkenHex', () => {
    expect(() => lightenHex('not-a-hex', 50)).toThrow(
      'entityTintBackground: expected a #RRGGBB hex, received "not-a-hex"',
    );
  });
});

describe('entityCardBackground direction', () => {
  it('darkens on the dark theme (default and explicit)', () => {
    expect(entityCardBackground('#FF453A')).toBe(darkenHex('#FF453A', 90));
    expect(entityCardBackground('#FF453A', 'dark')).toBe(darkenHex('#FF453A', 90));
  });

  it('lightens on the light theme, toward a near-white card tone', () => {
    expect(entityCardBackground('#FF453A', 'light')).toBe(lightenHex('#FF453A', 90));
  });

  it('reads plainly lighter than the raw hue on every channel for every swatch on light', () => {
    const channels = (hex: string): [number, number, number] => [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
    ];

    for (const hex of Object.values(palette)) {
      const [cr, cg, cb] = channels(entityCardBackground(hex, 'light'));
      const [rr, rg, rb] = channels(hex);
      expect(cr).toBeGreaterThanOrEqual(rr);
      expect(cg).toBeGreaterThanOrEqual(rg);
      expect(cb).toBeGreaterThanOrEqual(rb);
    }
  });

  it('produces a distinct light-mode card color for every swatch', () => {
    const cards = Object.values(palette).map((hex) => entityCardBackground(hex, 'light'));
    expect(new Set(cards).size).toBe(cards.length);
  });
});

describe('resolveEntityColor scheme-aware fallback', () => {
  it('falls back to the DARK gray by default and for the dark scheme', () => {
    expect(resolveEntityColor(null, undefined)).toBe(palette.gray);
    expect(resolveEntityColor(null, undefined, 'dark')).toBe(palette.gray);
  });

  it('falls back to the LIGHT gray for the light scheme', () => {
    expect(resolveEntityColor(null, undefined, 'light')).toBe(entityColorsLight.gray);
  });

  it('still returns a valid typeDefault hex regardless of scheme', () => {
    expect(resolveEntityColor(null, '#abcdef', 'light')).toBe('#abcdef');
  });
});

// A stored override is persisted as an absolute hex of whichever theme was
// active at pick time (color-picker.component.tsx hands `onSelect` the raw
// active-theme swatch hex). An existing user's stored row therefore holds
// exactly one scheme's hex, unchanged, forever — resolveEntityColor is the
// ONLY place that must reverse-map it to the CURRENT scheme's paired
// counterpart at render time, with no destructive migration of the stored
// row itself.
describe('resolveEntityColor stored-hex scheme portability', () => {
  it('resolves a PRE-EXISTING stored dark-palette hex to its light counterpart under scheme=light', () => {
    // `white` picked on dark (#FFFFFF) must render as light `white` (#000000)
    // on the light scheme — the exact bug this fix addresses.
    expect(resolveEntityColor(palette.white, undefined, 'light')).toBe(entityColorsLight.white);
    expect(resolveEntityColor(palette.blue, undefined, 'light')).toBe(entityColorsLight.blue);
  });

  it('resolves a PRE-EXISTING stored light-palette hex to its dark counterpart under scheme=dark', () => {
    expect(resolveEntityColor(entityColorsLight.white, undefined, 'dark')).toBe(palette.white);
    expect(resolveEntityColor(entityColorsLight.blue, undefined, 'dark')).toBe(palette.blue);
  });

  it('every named swatch round-trips: dark hex -> light -> back to the original dark hex', () => {
    for (const name of Object.keys(palette) as (keyof typeof palette)[]) {
      const toLight = resolveEntityColor(palette[name], undefined, 'light');
      expect(toLight).toBe(entityColorsLight[name]);

      const backToDark = resolveEntityColor(toLight, undefined, 'dark');
      expect(backToDark).toBe(palette[name]);
    }
  });

  it('leaves a stored hex unchanged when it already matches the current scheme', () => {
    expect(resolveEntityColor(palette.white, undefined, 'dark')).toBe(palette.white);
    expect(resolveEntityColor(entityColorsLight.white, undefined, 'light')).toBe(
      entityColorsLight.white,
    );
  });

  it('passes an unknown/custom hex through unchanged for either scheme, never breaking a legacy value', () => {
    expect(resolveEntityColor('#123456', undefined, 'light')).toBe('#123456');
    expect(resolveEntityColor('#123456', undefined, 'dark')).toBe('#123456');
  });
});
