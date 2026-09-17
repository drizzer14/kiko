import type {
  BankProvider,
  ProviderAccount,
  ProviderInstitution,
  ProviderStatementItem,
} from './provider';
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

describe('provider account and statement shapes', () => {
  it('accepts a well-formed single-bank ProviderAccount (no externalInstitutionId/countryCode)', () => {
    const institution: ProviderInstitution = { name: 'Monobank' };
    const account: ProviderAccount = {
      externalAccountId: 'acc-1',
      institution,
      kind: 'card',
      name: 'Black card',
      currency: 'UAH',
      balanceMinorUnits: 100_00,
    };

    expect(account.institution.externalInstitutionId).toBeUndefined();
    expect(account.currency).toBe('UAH');
  });

  it('accepts a ProviderAccount whose currency Kiko cannot represent', () => {
    const account: ProviderAccount = {
      externalAccountId: 'acc-2',
      institution: { name: 'Monobank' },
      kind: 'jar',
      name: 'Jar',
      currency: undefined,
      balanceMinorUnits: 0,
    };

    expect(account.currency).toBeUndefined();
  });

  it('accepts a well-formed ProviderStatementItem', () => {
    const item: ProviderStatementItem = {
      externalAccountId: 'acc-1',
      externalStatementId: 'stmt-1',
      amountMinorUnits: -500,
      timeSeconds: 1_700_000_000,
      description: 'Coffee',
    };

    expect(item.hold).toBeUndefined();
    expect(item.amountMinorUnits).toBe(-500);
  });
});

describe('BankProvider interface', () => {
  it('is satisfiable by a minimal single-bank stub — the shape a real implementation targets', () => {
    const stub: BankProvider<{ token: string }, { fetchImpl: typeof fetch }> = {
      id: 'monobank',
      shape: 'single-bank',
      rateLimit: { intervalMs: 60_000 },
      maxWindowSeconds: 2_682_000,
      fetchAccounts: async () => [],
      fetchStatement: async () => [],
    };

    expect(stub.shape).toBe('single-bank');
    expect(stub.rateLimit).toEqual({ intervalMs: 60_000 });
  });
});
