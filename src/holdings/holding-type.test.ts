import {
  creatableHoldingTypesForAccountKind,
  holdingTypes,
  holdingTypesForAccountKind,
  isSyncOnlyHoldingType,
  isTimeExemptHoldingType,
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

  it('allows a bank account the card, term_deposit, bond, and jar holdings', () => {
    expect(holdingTypesForAccountKind.bank).toEqual(['card', 'term_deposit', 'bond', 'jar']);
  });

  it('constrains a cash account to cash holdings only', () => {
    expect(holdingTypesForAccountKind.cash).toEqual(['cash']);
  });

  it('constrains a crypto account to crypto_asset holdings only', () => {
    expect(holdingTypesForAccountKind.crypto).toEqual(['crypto_asset']);
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
  });
});

describe('time-exempt holding types', () => {
  it('marks a term_deposit and a bond as time-exempt (they are not time-specific)', () => {
    expect(isTimeExemptHoldingType('term_deposit')).toBe(true);
    expect(isTimeExemptHoldingType('bond')).toBe(true);
  });

  it('does not mark time-specific holding types as time-exempt', () => {
    expect(isTimeExemptHoldingType('card')).toBe(false);
    expect(isTimeExemptHoldingType('cash')).toBe(false);
    expect(isTimeExemptHoldingType('crypto_asset')).toBe(false);
    expect(isTimeExemptHoldingType('jar')).toBe(false);
  });
});

describe('creatableHoldingTypesForAccountKind', () => {
  it('drops the sync-only card and jar from a bank, leaving term_deposit and bond', () => {
    expect(creatableHoldingTypesForAccountKind.bank).toEqual(['term_deposit', 'bond']);
  });

  it('leaves the cash and crypto sets unchanged (their type is not sync-only)', () => {
    expect(creatableHoldingTypesForAccountKind.cash).toEqual(['cash']);
    expect(creatableHoldingTypesForAccountKind.crypto).toEqual(['crypto_asset']);
  });

  it('never offers an empty create set for any account kind', () => {
    for (const creatable of Object.values(creatableHoldingTypesForAccountKind)) {
      expect(creatable.length).toBeGreaterThan(0);
    }
  });

  it('never offers a sync-only type as manually creatable', () => {
    for (const creatable of Object.values(creatableHoldingTypesForAccountKind)) {
      for (const type of creatable) {
        expect(isSyncOnlyHoldingType(type)).toBe(false);
      }
    }
  });
});
