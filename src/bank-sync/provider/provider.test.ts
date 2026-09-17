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

describe('provider contract shapes', () => {
  // Compile-time only: `satisfies` fails `tsc` if a shape drifts
  // incompatibly with `ProviderInstitution`/`ProviderAccount`/
  // `ProviderStatementItem`/`BankProvider`, which is the entire point of
  // this test — there is nothing behavioral to assert with `expect` about a
  // literal that only echoes its own field values back.
  it('type-checks a fixture against each provider contract shape', () => {
    const institution = { name: 'Monobank' } satisfies ProviderInstitution;

    ({
      externalAccountId: 'acc-1',
      institution,
      kind: 'card',
      name: 'Black card',
      currency: 'UAH',
      balanceMinorUnits: 100_00,
    }) satisfies ProviderAccount;

    ({
      externalAccountId: 'acc-2',
      institution,
      kind: 'jar',
      name: 'Jar',
      currency: undefined,
      balanceMinorUnits: 0,
    }) satisfies ProviderAccount;

    ({
      externalAccountId: 'acc-1',
      externalStatementId: 'stmt-1',
      amountMinorUnits: -500,
      timeSeconds: 1_700_000_000,
      description: 'Coffee',
    }) satisfies ProviderStatementItem;

    ({
      id: 'monobank',
      shape: 'single-bank',
      rateLimit: { intervalMs: 60_000 },
      maxWindowSeconds: 2_682_000,
      fetchAccounts: async () => [],
      fetchStatement: async () => [],
    }) satisfies BankProvider<{ token: string }, { fetchImpl: typeof fetch }>;
  });
});
