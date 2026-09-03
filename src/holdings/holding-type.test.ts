import { holdingTypes, holdingTypesForAccountKind } from './holding-type';

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
