import type { AccountRow } from '../db/schema';
import { darkTheme } from '../design-system/theme';

import { defaultAccountColor, defaultHoldingColor } from './entity-colors';
import { holdingTypes, holdingTypesForAccountKind } from './holding-type';

type AccountKind = AccountRow['kind'];

// The account kinds, derived from the one Record that is typed over the full
// `AccountKind` union — so dropping/adding a kind in the schema flows here
// without a second hand-maintained list.
const accountKinds = Object.keys(holdingTypesForAccountKind) as AccountKind[];

const HEX = /^#[0-9A-Fa-f]{6}$/;
// Typed as a set OF STRINGS, not of the theme's literal union: these tests ask
// whether an arbitrary `#RRGGBB` produced by the color maps is a member, which
// is exactly the question a literal-typed `has` refuses to answer.
const paletteHexes: ReadonlySet<string> = new Set(Object.values(darkTheme.colors.entityColors));

describe('defaultAccountColor', () => {
  it('maps every account kind to a default color', () => {
    for (const kind of accountKinds) {
      expect(defaultAccountColor[kind]).toBeDefined();
    }
  });

  it('gives every kind a valid hex value drawn from the entity palette', () => {
    for (const kind of accountKinds) {
      expect(defaultAccountColor[kind]).toMatch(HEX);
      expect(paletteHexes.has(defaultAccountColor[kind])).toBe(true);
    }
  });

  it('assigns bank white, cash khaki, crypto yellow', () => {
    const { entityColors } = darkTheme.colors;

    expect(defaultAccountColor.bank).toBe(entityColors.white);
    expect(defaultAccountColor.cash).toBe(entityColors.khaki);
    expect(defaultAccountColor.crypto).toBe(entityColors.yellow);
  });
});

describe('defaultHoldingColor', () => {
  it('maps every holding type to a default color', () => {
    for (const type of holdingTypes) {
      expect(defaultHoldingColor[type]).toBeDefined();
    }
  });

  it('gives every type a valid hex value drawn from the entity palette', () => {
    for (const type of holdingTypes) {
      expect(defaultHoldingColor[type]).toMatch(HEX);
      expect(paletteHexes.has(defaultHoldingColor[type])).toBe(true);
    }
  });

  it('assigns card white, term_deposit blue, bond green, jar violet, cash khaki, crypto_asset yellow', () => {
    const { entityColors } = darkTheme.colors;

    expect(defaultHoldingColor.card).toBe(entityColors.white);
    expect(defaultHoldingColor.term_deposit).toBe(entityColors.blue);
    expect(defaultHoldingColor.bond).toBe(entityColors.green);
    expect(defaultHoldingColor.jar).toBe(entityColors.violet);
    expect(defaultHoldingColor.cash).toBe(entityColors.khaki);
    expect(defaultHoldingColor.crypto_asset).toBe(entityColors.yellow);
  });
});
