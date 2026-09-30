import type { AccountRow } from '@kiko/db';
import { entityColorsDark } from '@kiko/design-system/palette';

import { holdingTypes, holdingTypesForAccountKind } from '../holding-type';

import { defaultAccountColor, defaultHoldingColor } from './entity-colors';

type AccountKind = AccountRow['kind'];

// The account kinds, derived from the one Record that is typed over the full
// `AccountKind` union — so dropping/adding a kind in the schema flows here
// without a second hand-maintained list.
const accountKinds = Object.keys(holdingTypesForAccountKind) as AccountKind[];

const HEX = /^#[0-9A-Fa-f]{6}$/;
const paletteHexes: ReadonlySet<string> = new Set(Object.values(entityColorsDark));

describe('defaultAccountColor', () => {
  it('maps every account kind to a default color', () => {
    for (const kind of accountKinds) {
      expect(defaultAccountColor[kind]).toBeDefined();
    }
  });

  it('gives every kind a valid hex value drawn from the entity set', () => {
    for (const kind of accountKinds) {
      expect(defaultAccountColor[kind]).toMatch(HEX);
      expect(paletteHexes.has(defaultAccountColor[kind])).toBe(true);
    }
  });

  it('assigns bank white, cash khaki, crypto yellow, property brown, metals gray, debt red, broker teal', () => {
    const { white, khaki, yellow, brown, gray, red, teal } = entityColorsDark;

    expect(defaultAccountColor.bank).toBe(white);
    expect(defaultAccountColor.cash).toBe(khaki);
    expect(defaultAccountColor.crypto).toBe(yellow);
    expect(defaultAccountColor.property).toBe(brown);
    expect(defaultAccountColor.metals).toBe(gray);
    expect(defaultAccountColor.debt).toBe(red);
    expect(defaultAccountColor.broker).toBe(teal);
  });
});

describe('defaultHoldingColor', () => {
  it('maps every holding type to a default color', () => {
    for (const type of holdingTypes) {
      expect(defaultHoldingColor[type]).toBeDefined();
    }
  });

  it('gives every type a valid hex value drawn from the entity set', () => {
    for (const type of holdingTypes) {
      expect(defaultHoldingColor[type]).toMatch(HEX);
      expect(paletteHexes.has(defaultHoldingColor[type])).toBe(true);
    }
  });

  it('assigns card white, term_deposit blue, bond green, jar violet, cash khaki, crypto_asset yellow, property_item brown, metal gray, loan red', () => {
    const { white, blue, green, violet, khaki, yellow, brown, gray, red } = entityColorsDark;

    expect(defaultHoldingColor.card).toBe(white);
    expect(defaultHoldingColor.term_deposit).toBe(blue);
    expect(defaultHoldingColor.bond).toBe(green);
    expect(defaultHoldingColor.jar).toBe(violet);
    expect(defaultHoldingColor.cash).toBe(khaki);
    expect(defaultHoldingColor.crypto_asset).toBe(yellow);
    expect(defaultHoldingColor.property_item).toBe(brown);
    expect(defaultHoldingColor.metal).toBe(gray);
    expect(defaultHoldingColor.loan).toBe(red);
  });

  it('gives a share the broker kind color', () => {
    expect(defaultHoldingColor.share).toBe(defaultAccountColor.broker);
  });
});
