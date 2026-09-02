import { isSyncedAccount, isSyncedHolding, isSyncedTransaction } from './deletable';

describe('synced predicates', () => {
  it('flags a monobank transaction', () => {
    expect(isSyncedTransaction({ source: 'monobank' })).toBe(true);
    expect(isSyncedTransaction({ source: 'manual' })).toBe(false);
  });

  it('flags a holding carrying a monobankId', () => {
    expect(isSyncedHolding({ metadata: { monobankId: 'abc' } })).toBe(true);
    expect(isSyncedHolding({ metadata: { iban: 'UA...' } })).toBe(false);
    expect(isSyncedHolding({ metadata: null })).toBe(false);
  });

  it('flags a monobank account', () => {
    expect(isSyncedAccount({ institution: 'monobank' })).toBe(true);
    expect(isSyncedAccount({ institution: null })).toBe(false);
  });
});
