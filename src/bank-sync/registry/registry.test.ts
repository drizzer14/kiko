import { hasToken } from '../../monobank/token';
import { disconnectMonobank } from '../../monobank/disconnect';
import { runSync as monobankRunSync } from '../../monobank/sync';

import { type BankProviderRegistryEntry, bankProviderRegistry } from './registry';

describe('bank provider registry', () => {
  it("wires the monobank entry to Monobank's existing exports, by identity", () => {
    const entry: BankProviderRegistryEntry | undefined = bankProviderRegistry.monobank;

    expect(entry?.id).toBe('monobank');
    expect(entry?.runSync).toBe(monobankRunSync);
    expect(entry?.hasCredentials).toBe(hasToken);
    expect(entry?.disconnect).toBe(disconnectMonobank);
  });

  it('carries exactly the one shipped provider (Guideline 5.6 remediation: Monobank-only)', () => {
    expect(Object.keys(bankProviderRegistry)).toEqual(['monobank']);
  });
});
