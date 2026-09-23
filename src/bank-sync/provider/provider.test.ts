import { bankProviderIdOf, bankProviderIds, isBankProviderId } from './provider';

describe('bank provider ids', () => {
  it('lists the sole shipped native bank provider (Guideline 5.6 remediation: Monobank-only)', () => {
    expect(bankProviderIds).toEqual(['monobank']);
  });

  it('bankProviderIdOf returns a single-bank institution unchanged', () => {
    expect(bankProviderIdOf('monobank')).toBe('monobank');
  });

  it('bankProviderIdOf strips a multi-bank <providerId>:<externalInstitutionId> suffix', () => {
    expect(bankProviderIdOf('aggregator:REVOLUT_REVOGB21')).toBe('aggregator');
  });

  it('recognizes the shipped provider id', () => {
    expect(isBankProviderId('monobank')).toBe(true);
  });

  it('rejects a stranger id, a removed provider id, and null', () => {
    expect(isBankProviderId('kraken')).toBe(false);
    expect(isBankProviderId('privatbank')).toBe(false);
    expect(isBankProviderId('bunq')).toBe(false);
    expect(isBankProviderId('starling')).toBe(false);
    expect(isBankProviderId(null)).toBe(false);
  });
});
