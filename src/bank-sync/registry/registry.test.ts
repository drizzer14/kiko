import { hasToken } from '../../monobank/token';
import { disconnectMonobank } from '../../monobank/disconnect';
import { runSync as monobankRunSync } from '../../monobank/sync';
import { hasCredentials as hasPrivatbankCredentials } from '../../privatbank/credentials';
import { disconnectPrivatbank } from '../../privatbank/disconnect';
import { runSync as privatbankRunSync } from '../../privatbank/sync';

import { type BankProviderRegistryEntry, bankProviderRegistry } from './registry';

describe('bank provider registry', () => {
  it("wires the monobank entry to Monobank's existing exports, by identity", () => {
    const entry: BankProviderRegistryEntry | undefined = bankProviderRegistry.monobank;

    expect(entry?.id).toBe('monobank');
    expect(entry?.runSync).toBe(monobankRunSync);
    expect(entry?.hasCredentials).toBe(hasToken);
    expect(entry?.disconnect).toBe(disconnectMonobank);
    expect(entry?.catalog.id).toBe('monobank');
  });

  it("wires the privatbank entry to PrivatBank's existing exports, by identity", () => {
    const entry: BankProviderRegistryEntry | undefined = bankProviderRegistry.privatbank;

    expect(entry?.id).toBe('privatbank');
    expect(entry?.runSync).toBe(privatbankRunSync);
    expect(entry?.hasCredentials).toBe(hasPrivatbankCredentials);
    expect(entry?.disconnect).toBe(disconnectPrivatbank);
    expect(entry?.catalog.id).toBe('privatbank');
  });

  it('leaves the not-yet-implemented native providers absent', () => {
    expect(bankProviderRegistry.bunq).toBeUndefined();
    expect(bankProviderRegistry.starling).toBeUndefined();
  });
});
