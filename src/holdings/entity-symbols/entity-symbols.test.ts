import type { AccountRow } from '@kiko/db';

import { loanKinds, propertyCategories } from '../holding-metadata';
import { type HoldingType, holdingTypes, holdingTypesForAccountKind } from '../holding-type';

import {
  accountKindSymbol,
  loanKindSymbol,
  holdingTypeSymbol,
  genericEntitySymbol,
  defaultHoldingSymbol,
  propertyCategorySymbol,
} from './entity-symbols';

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

  it('assigns bank building.columns.fill, cash banknote, crypto bitcoinsign.circle, property house.fill, metals cube.fill, debt minus.circle.fill, broker chart.line.uptrend.xyaxis', () => {
    expect(accountKindSymbol.bank).toBe('building.columns.fill');
    expect(accountKindSymbol.cash).toBe('banknote');
    expect(accountKindSymbol.crypto).toBe('bitcoinsign.circle');
    expect(accountKindSymbol.property).toBe('house.fill');
    expect(accountKindSymbol.metals).toBe('cube.fill');
    expect(accountKindSymbol.debt).toBe('minus.circle.fill');
    expect(accountKindSymbol.broker).toBe('chart.line.uptrend.xyaxis');
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

  it('assigns card creditcard, term_deposit calendar, bond receipt, jar rectangle.portrait, cash banknote, crypto_asset bitcoinsign.circle, property_item house.fill, metal cube.fill, loan arrow.down.backward.circle.fill', () => {
    expect(holdingTypeSymbol.card).toBe('creditcard');
    expect(holdingTypeSymbol.term_deposit).toBe('calendar');
    expect(holdingTypeSymbol.bond).toBe('receipt');
    expect(holdingTypeSymbol.jar).toBe('rectangle.portrait');
    expect(holdingTypeSymbol.cash).toBe('banknote');
    expect(holdingTypeSymbol.crypto_asset).toBe('bitcoinsign.circle');
    expect(holdingTypeSymbol.property_item).toBe('house.fill');
    expect(holdingTypeSymbol.metal).toBe('cube.fill');
    expect(holdingTypeSymbol.loan).toBe('arrow.down.backward.circle.fill');
    // The debt ACCOUNT keeps its own minus glyph, persisted on existing rows.
    expect(holdingTypeSymbol.loan).not.toBe(accountKindSymbol.debt);
  });
});

describe('propertyCategorySymbol', () => {
  it('maps every property category to a non-empty SF Symbol name', () => {
    for (const category of propertyCategories) {
      expect(propertyCategorySymbol[category]).toMatch(SF_SYMBOL);
    }
  });

  it('assigns real_estate house.fill, vehicle car.fill, valuable diamond.fill, business_share briefcase.fill, loan_given arrow.up.forward.circle.fill, other square.grid.2x2.fill', () => {
    expect(propertyCategorySymbol).toEqual({
      real_estate: 'house.fill',
      vehicle: 'car.fill',
      valuable: 'diamond.fill',
      business_share: 'briefcase.fill',
      loan_given: 'arrow.up.forward.circle.fill',
      other: 'square.grid.2x2.fill',
    });
  });
});

describe('loanKindSymbol', () => {
  it('assigns mortgage house.circle.fill, car_loan car.fill, consumer_loan cart.fill, personal person.fill', () => {
    expect(loanKindSymbol).toEqual({
      mortgage: 'house.circle.fill',
      car_loan: 'car.fill',
      consumer_loan: 'cart.fill',
      personal: 'person.fill',
    });
  });

  it("keeps the mortgage off the Properties account's own house.fill glyph", () => {
    expect(loanKindSymbol.mortgage).not.toBe(accountKindSymbol.property);
  });
});

describe('defaultHoldingSymbol', () => {
  it.each(loanKinds)("gives a loan its kind's glyph (%s)", (kind) => {
    expect(defaultHoldingSymbol({ type: 'loan', metadata: { kind } })).toBe(loanKindSymbol[kind]);
  });

  it("gives a loan with a missing or invalid kind the loan type's glyph", () => {
    expect(defaultHoldingSymbol({ type: 'loan', metadata: { kind: 'nonsense' } })).toBe(
      holdingTypeSymbol.loan,
    );
    expect(defaultHoldingSymbol({ type: 'loan', metadata: null })).toBe(holdingTypeSymbol.loan);
  });

  it("gives a property_item its category's glyph", () => {
    expect(
      defaultHoldingSymbol({ type: 'property_item', metadata: { category: 'vehicle', lots: [] } }),
    ).toBe('car.fill');
  });

  it('gives a property_item with garbled metadata the Other glyph', () => {
    expect(defaultHoldingSymbol({ type: 'property_item', metadata: 'garbled' })).toBe(
      'square.grid.2x2.fill',
    );
  });

  it("gives every other holding type its type's glyph", () => {
    expect(defaultHoldingSymbol({ type: 'metal', metadata: null })).toBe('cube.fill');
    expect(defaultHoldingSymbol({ type: 'card', metadata: null })).toBe('creditcard');
  });

  it('gives a stored type this build no longer knows the generic holding glyph', () => {
    const removedType = 'share' as unknown as HoldingType;

    expect(defaultHoldingSymbol({ type: removedType, metadata: null })).toBe(
      genericEntitySymbol.holding,
    );
    expect(
      defaultHoldingSymbol({ type: 'constructor' as unknown as HoldingType, metadata: null }),
    ).toBe(genericEntitySymbol.holding);
  });
});

describe('genericEntitySymbol', () => {
  it('maps each generic entity reference to its decided glyph', () => {
    expect(genericEntitySymbol.account).toBe('tray');
    expect(genericEntitySymbol.holding).toBe('list.bullet.rectangle');
    expect(genericEntitySymbol.transaction).toBe('arrow.up.arrow.down');
    expect(genericEntitySymbol.category).toBe('tag');
    expect(genericEntitySymbol.rule).toBe('slider.horizontal.3');
    expect(genericEntitySymbol.template).toBe('doc.on.doc');
  });

  it('maps every generic entity to a non-empty SF Symbol name', () => {
    for (const symbol of Object.values(genericEntitySymbol)) {
      expect(symbol.length).toBeGreaterThan(0);
      expect(symbol).toMatch(SF_SYMBOL);
    }
  });
});
