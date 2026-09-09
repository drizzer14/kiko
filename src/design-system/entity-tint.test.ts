import {
  darkenHex,
  ENTITY_TINT_OPACITY,
  entityCardBackground,
  entityTintBackground,
  resolveEntityColor,
} from './entity-tint';
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

  it('passes an unknown/custom stored hex through unchanged, never breaking a legacy value', () => {
    expect(resolveEntityColor('#123456', undefined)).toBe('#123456');
  });
});
