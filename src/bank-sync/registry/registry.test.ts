import { hasToken } from '../../monobank/token';
import { disconnectBunq } from '../../bunq/disconnect';
import { runSync as bunqRunSync } from '../../bunq/sync';
import { disconnectMonobank } from '../../monobank/disconnect';
import { runSync as monobankRunSync } from '../../monobank/sync';
import { disconnectPrivatbank } from '../../privatbank/disconnect';
import { runSync as privatbankRunSync } from '../../privatbank/sync';
import { hasCredentials as hasBunqCredentials } from '../../bunq/credentials';
import { hasCredentials as hasPrivatbankCredentials } from '../../privatbank/credentials';

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

  it("wires the bunq entry to bunq's existing exports, by identity", () => {
    const entry: BankProviderRegistryEntry | undefined = bankProviderRegistry.bunq;

    expect(entry?.id).toBe('bunq');
    expect(entry?.runSync).toBe(bunqRunSync);
    expect(entry?.hasCredentials).toBe(hasBunqCredentials);
    expect(entry?.disconnect).toBe(disconnectBunq);
    expect(entry?.catalog.id).toBe('bunq');
  });

  it('leaves the not-yet-implemented native providers absent', () => {
    expect(bankProviderRegistry.starling).toBeUndefined();
  });
});
