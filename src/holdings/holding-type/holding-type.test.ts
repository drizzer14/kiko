import {
  creatableHoldingTypesForAccount,
  holdingTypes,
  holdingTypesForAccountKind,
  isSyncOnlyHoldingType,
  syncOnlyHoldingTypes,
} from './holding-type';

describe('holdingTypesForAccountKind', () => {
  it('never allows a holding type outside the holdings enum for any account kind', () => {
    for (const allowed of Object.values(holdingTypesForAccountKind)) {
      for (const type of allowed) {
        expect(holdingTypes).toContain(type);
      }
    }
  });

  it('never offers an empty set of holding types for an account kind', () => {
    for (const allowed of Object.values(holdingTypesForAccountKind)) {
      expect(allowed.length).toBeGreaterThan(0);
    }
  });

  it('forbids crypto_asset and cash holdings on a bank account', () => {
    expect(holdingTypesForAccountKind.bank).not.toContain('crypto_asset');
    expect(holdingTypesForAccountKind.bank).not.toContain('cash');
  });

  it('allows a bank account the card, term_deposit, bond, jar, and metal holdings', () => {
    expect(holdingTypesForAccountKind.bank).toEqual([
      'card',
      'term_deposit',
      'bond',
      'jar',
      'metal',
    ]);
  });

  it('constrains a cash account to cash holdings only', () => {
    expect(holdingTypesForAccountKind.cash).toEqual(['cash']);
  });

  it('constrains a crypto account to crypto_asset holdings only', () => {
    expect(holdingTypesForAccountKind.crypto).toEqual(['crypto_asset']);
  });

  it('constrains a property account to property_item holdings only', () => {
    expect(holdingTypesForAccountKind.property).toEqual(['property_item']);
  });

  it('constrains a metals account to metal holdings only', () => {
    expect(holdingTypesForAccountKind.metals).toEqual(['metal']);
  });

  it('constrains a debt account to loan holdings only', () => {
    expect(holdingTypesForAccountKind.debt).toEqual(['loan']);
  });
});

describe('sync-only holding types', () => {
  it('marks exactly card and jar as sync-only (Monobank creates them)', () => {
    expect([...syncOnlyHoldingTypes]).toEqual(['card', 'jar']);
    expect(isSyncOnlyHoldingType('card')).toBe(true);
    expect(isSyncOnlyHoldingType('jar')).toBe(true);
  });

  it('does not mark manually-created types as sync-only', () => {
    expect(isSyncOnlyHoldingType('term_deposit')).toBe(false);
    expect(isSyncOnlyHoldingType('bond')).toBe(false);
    expect(isSyncOnlyHoldingType('cash')).toBe(false);
    expect(isSyncOnlyHoldingType('crypto_asset')).toBe(false);
    expect(isSyncOnlyHoldingType('property_item')).toBe(false);
    expect(isSyncOnlyHoldingType('metal')).toBe(false);
    expect(isSyncOnlyHoldingType('loan')).toBe(false);
  });
});

describe('creatableHoldingTypesForAccount', () => {
  it('drops the sync-only card and jar from a SYNCED bank, leaving term_deposit and bond', () => {
    expect(creatableHoldingTypesForAccount('bank', true)).toEqual(['term_deposit', 'bond']);
  });

  it('allows card on a NON-synced bank (statement-import-only, no sync to own it), still excluding jar', () => {
    const creatable = creatableHoldingTypesForAccount('bank', false);
    expect(creatable).toContain('card');
    expect(creatable).not.toContain('jar');
    expect(creatable).toEqual(['card', 'term_deposit', 'bond']);
  });

  it('leaves the cash and crypto sets unchanged regardless of synced state', () => {
    expect(creatableHoldingTypesForAccount('cash', true)).toEqual(['cash']);
    expect(creatableHoldingTypesForAccount('cash', false)).toEqual(['cash']);
    expect(creatableHoldingTypesForAccount('crypto', true)).toEqual(['crypto_asset']);
    expect(creatableHoldingTypesForAccount('crypto', false)).toEqual(['crypto_asset']);
  });

  it('offers property_item as the sole creatable type for a property account', () => {
    expect(creatableHoldingTypesForAccount('property', false)).toEqual(['property_item']);
    expect(creatableHoldingTypesForAccount('property', true)).toEqual(['property_item']);
  });

  it('offers metal as the sole creatable type for a metals account, no bankId needed', () => {
    expect(creatableHoldingTypesForAccount('metals', false)).toEqual(['metal']);
    expect(creatableHoldingTypesForAccount('metals', true)).toEqual(['metal']);
  });

  it('offers loan as the sole creatable type for a debt account', () => {
    expect(creatableHoldingTypesForAccount('debt', false)).toEqual(['loan']);
    expect(creatableHoldingTypesForAccount('debt', true)).toEqual(['loan']);
  });

  it('drops metal from a bank account with no bankId, an unlisted bankId, or monobank', () => {
    expect(creatableHoldingTypesForAccount('bank', false)).not.toContain('metal');
    expect(creatableHoldingTypesForAccount('bank', false, null)).not.toContain('metal');
    expect(creatableHoldingTypesForAccount('bank', false, 'monobank')).not.toContain('metal');
    expect(creatableHoldingTypesForAccount('bank', false, 'not-a-bank')).not.toContain('metal');
  });

  it('offers metal on a bank account allow-listed to sell metals (privatbank)', () => {
    expect(creatableHoldingTypesForAccount('bank', false, 'privatbank')).toContain('metal');
    // A live-synced allow-listed bank still offers it — metal is not sync-only.
    expect(creatableHoldingTypesForAccount('bank', true, 'privatbank')).toContain('metal');
  });

  // T22: PUMB, Oschadbank, and Ukrgasbank join the catalog's metal
  // allow-list; Raiffeisen does not.
  it.each(['pumb', 'oschadbank', 'ukrgasbank'])(
    'offers metal on a bank account allow-listed to sell metals (%s)',
    (bankId) => {
      expect(creatableHoldingTypesForAccount('bank', false, bankId)).toContain('metal');
    },
  );

  it('drops metal from a Raiffeisen bank account (not allow-listed to sell metals)', () => {
    expect(creatableHoldingTypesForAccount('bank', false, 'raiffeisen')).not.toContain('metal');
  });

  it('never offers an empty create set for any account kind or synced state', () => {
    for (const kind of ['bank', 'cash', 'crypto', 'property', 'metals', 'debt'] as const) {
      for (const isSynced of [true, false]) {
        expect(creatableHoldingTypesForAccount(kind, isSynced).length).toBeGreaterThan(0);
      }
    }
  });

  it('never offers jar as manually creatable, synced or not (Monobank-API-only concept)', () => {
    for (const kind of ['bank', 'cash', 'crypto', 'property', 'metals', 'debt'] as const) {
      for (const isSynced of [true, false]) {
        expect(creatableHoldingTypesForAccount(kind, isSynced)).not.toContain('jar');
      }
    }
  });

  it('never offers a sync-only type as manually creatable on a SYNCED account', () => {
    for (const kind of ['bank', 'cash', 'crypto', 'property', 'metals', 'debt'] as const) {
      for (const type of creatableHoldingTypesForAccount(kind, true, 'privatbank')) {
        expect(isSyncOnlyHoldingType(type)).toBe(false);
      }
    }
  });
});
