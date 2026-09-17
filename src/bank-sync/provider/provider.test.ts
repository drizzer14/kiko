import { bankProviderIdOf, bankProviderIds, isBankProviderId } from './provider';

describe('bank provider ids', () => {
  it('lists the four native bank providers, in ship order', () => {
    expect(bankProviderIds).toEqual(['monobank', 'privatbank', 'bunq', 'starling']);
  });

  it('bankProviderIdOf returns a single-bank institution unchanged', () => {
    expect(bankProviderIdOf('monobank')).toBe('monobank');
  });

  it('bankProviderIdOf strips a multi-bank <providerId>:<externalInstitutionId> suffix', () => {
    expect(bankProviderIdOf('aggregator:REVOLUT_REVOGB21')).toBe('aggregator');
  });

  it('recognizes every native provider id', () => {
    expect(isBankProviderId('monobank')).toBe(true);
    expect(isBankProviderId('privatbank')).toBe(true);
    expect(isBankProviderId('bunq')).toBe(true);
    expect(isBankProviderId('starling')).toBe(true);
  });

  it('rejects a stranger id and null', () => {
    expect(isBankProviderId('kraken')).toBe(false);
    expect(isBankProviderId(null)).toBe(false);
  });
});
