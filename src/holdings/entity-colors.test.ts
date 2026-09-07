import type { AccountRow } from '../db/schema';
import { entityColorsByScheme } from '../design-system/palette';

import { defaultAccountColor, defaultHoldingColor } from './entity-colors';
import { holdingTypes, holdingTypesForAccountKind } from './holding-type';

type AccountKind = AccountRow['kind'];

// The account kinds, derived from the one Record that is typed over the full
// `AccountKind` union — so dropping/adding a kind in the schema flows here
// without a second hand-maintained list.
const accountKinds = Object.keys(holdingTypesForAccountKind) as AccountKind[];

const HEX = /^#[0-9A-Fa-f]{6}$/;

describe('defaultAccountColor', () => {
  it('maps every account kind to a default color for each scheme', () => {
    for (const scheme of ['dark', 'light'] as const) {
      for (const kind of accountKinds) {
        expect(defaultAccountColor(scheme)[kind]).toBeDefined();
      }
    }
  });

  it('gives every kind a valid hex value drawn from the active entity set', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const paletteHexes: ReadonlySet<string> = new Set(
        Object.values(entityColorsByScheme[scheme]),
      );
      for (const kind of accountKinds) {
        expect(defaultAccountColor(scheme)[kind]).toMatch(HEX);
        expect(paletteHexes.has(defaultAccountColor(scheme)[kind])).toBe(true);
      }
    }
  });

  it('assigns bank white, cash khaki, crypto yellow from the dark set', () => {
    const { white, khaki, yellow } = entityColorsByScheme.dark;

    expect(defaultAccountColor('dark').bank).toBe(white);
    expect(defaultAccountColor('dark').cash).toBe(khaki);
    expect(defaultAccountColor('dark').crypto).toBe(yellow);
  });

  it('picks the LIGHT set when the scheme is light', () => {
    expect(defaultAccountColor('light').bank).toBe(entityColorsByScheme.light.white);
    expect(defaultAccountColor('light').cash).toBe(entityColorsByScheme.light.khaki);
  });
});

describe('defaultHoldingColor', () => {
  it('maps every holding type to a default color for each scheme', () => {
    for (const scheme of ['dark', 'light'] as const) {
      for (const type of holdingTypes) {
        expect(defaultHoldingColor(scheme)[type]).toBeDefined();
      }
    }
  });

  it('gives every type a valid hex value drawn from the active entity set', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const paletteHexes: ReadonlySet<string> = new Set(
        Object.values(entityColorsByScheme[scheme]),
      );
      for (const type of holdingTypes) {
        expect(defaultHoldingColor(scheme)[type]).toMatch(HEX);
        expect(paletteHexes.has(defaultHoldingColor(scheme)[type])).toBe(true);
      }
    }
  });

  it('assigns card white, term_deposit blue, bond green, jar violet, cash khaki, crypto_asset yellow from the dark set', () => {
    const { white, blue, green, violet, khaki, yellow } = entityColorsByScheme.dark;

    expect(defaultHoldingColor('dark').card).toBe(white);
    expect(defaultHoldingColor('dark').term_deposit).toBe(blue);
    expect(defaultHoldingColor('dark').bond).toBe(green);
    expect(defaultHoldingColor('dark').jar).toBe(violet);
    expect(defaultHoldingColor('dark').cash).toBe(khaki);
    expect(defaultHoldingColor('dark').crypto_asset).toBe(yellow);
  });

  it('picks the LIGHT set when the scheme is light', () => {
    expect(defaultHoldingColor('light').card).toBe(entityColorsByScheme.light.white);
    expect(defaultHoldingColor('light').crypto_asset).toBe(entityColorsByScheme.light.yellow);
  });
});
