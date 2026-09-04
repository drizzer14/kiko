import type { AccountRow } from '../db/schema';
import { accountKindSymbol, holdingTypeSymbol } from './entity-symbols';
import { holdingTypes, holdingTypesForAccountKind } from './holding-type';

type AccountKind = AccountRow['kind'];

// The account kinds, derived from the one Record that is typed over the full
// `AccountKind` union — so dropping/adding a kind in the schema flows here
// without a second hand-maintained list.
const accountKinds = Object.keys(holdingTypesForAccountKind) as AccountKind[];

// A real SF Symbol name: lowercase letters/digits, dot-separated segments
// (e.g. "building.columns").
const SF_SYMBOL = /^[a-z0-9]+(\.[a-z0-9]+)*$/;

describe('accountKindSymbol', () => {
  it('maps every account kind to a non-empty SF Symbol name', () => {
    for (const kind of accountKinds) {
      expect(accountKindSymbol[kind]).toBeDefined();
      expect(accountKindSymbol[kind].length).toBeGreaterThan(0);
      expect(accountKindSymbol[kind]).toMatch(SF_SYMBOL);
    }
  });

  it('assigns bank building.columns.fill, cash banknote, crypto bitcoinsign', () => {
    expect(accountKindSymbol.bank).toBe('building.columns.fill');
    expect(accountKindSymbol.cash).toBe('banknote');
    expect(accountKindSymbol.crypto).toBe('bitcoinsign');
  });
});

describe('holdingTypeSymbol', () => {
  it('maps every holding type to a non-empty SF Symbol name', () => {
    for (const type of holdingTypes) {
      expect(holdingTypeSymbol[type]).toBeDefined();
      expect(holdingTypeSymbol[type].length).toBeGreaterThan(0);
      expect(holdingTypeSymbol[type]).toMatch(SF_SYMBOL);
    }
  });

  it('assigns card creditcard, term_deposit calendar, bond receipt, jar archivebox, cash banknote, crypto_asset bitcoinsign', () => {
    expect(holdingTypeSymbol.card).toBe('creditcard');
    expect(holdingTypeSymbol.term_deposit).toBe('calendar');
    expect(holdingTypeSymbol.bond).toBe('receipt');
    expect(holdingTypeSymbol.jar).toBe('archivebox');
    expect(holdingTypeSymbol.cash).toBe('banknote');
    expect(holdingTypeSymbol.crypto_asset).toBe('bitcoinsign');
  });
});
