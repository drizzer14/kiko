import * as Keychain from 'react-native-keychain';

import {
  clearToken,
  hasToken,
  MONOBANK_TOKEN_SERVICE,
  migrateLegacyToken,
  readToken,
  saveGlobalToken,
  saveToken,
  serviceFor,
} from './token';

const LEGACY_SERVICE = 'pff.monobank.token';
const ACCOUNT_A = 'acc-a';
const ACCOUNT_B = 'acc-b';

// A service-keyed in-memory Keychain: each `service` has its own credential
// slot, so per-account isolation and the legacy->global token migration can both
// be exercised across services.
jest.mock('react-native-keychain', () => {
  const store: Record<string, { username: string; password: string }> = {};
  const key = (options?: { service?: string }): string => options?.service ?? 'default';
  return {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
    setGenericPassword: jest.fn(
      async (username: string, password: string, options?: { service?: string }) => {
        store[key(options)] = { username, password };
        return true;
      },
    ),
    getGenericPassword: jest.fn(
      async (options?: { service?: string }) => store[key(options)] ?? false,
    ),
    hasGenericPassword: jest.fn(async (options?: { service?: string }) => key(options) in store),
    resetGenericPassword: jest.fn(async (options?: { service?: string }) => {
      delete store[key(options)];
      return true;
    }),
  };
});

beforeEach(async () => {
  // The mock's credential store lives in the factory closure and persists across
  // tests; clear every service each test touches so it starts from an empty
  // Keychain. jest.clearAllMocks only resets call records, not that store.
  await Keychain.resetGenericPassword({ service: MONOBANK_TOKEN_SERVICE });
  await Keychain.resetGenericPassword({ service: LEGACY_SERVICE });
  await Keychain.resetGenericPassword({ service: serviceFor(ACCOUNT_A) });
  await Keychain.resetGenericPassword({ service: serviceFor(ACCOUNT_B) });
  jest.clearAllMocks();
});

describe('serviceFor', () => {
  it('derives a distinct per-account service from the account id', () => {
    expect(serviceFor(ACCOUNT_A)).toBe('kiko.monobank.token.acc-a');
    expect(serviceFor(ACCOUNT_A)).not.toBe(serviceFor(ACCOUNT_B));
  });
});

describe('per-account monobank token', () => {
  it('saves and reads a token under the account id', async () => {
    await saveToken(ACCOUNT_A, 'secret-token');
    expect(await readToken(ACCOUNT_A)).toBe('secret-token');
  });

  it('clears the token for the account id', async () => {
    await saveToken(ACCOUNT_A, 'secret-token');
    await clearToken(ACCOUNT_A);
    expect(await readToken(ACCOUNT_A)).toBeUndefined();
  });

  it('isolates two account ids: reading one never returns the other', async () => {
    await saveToken(ACCOUNT_A, 'token-a');
    await saveToken(ACCOUNT_B, 'token-b');

    expect(await readToken(ACCOUNT_A)).toBe('token-a');
    expect(await readToken(ACCOUNT_B)).toBe('token-b');
  });

  it('clearing one account never clears another', async () => {
    await saveToken(ACCOUNT_A, 'token-a');
    await saveToken(ACCOUNT_B, 'token-b');

    await clearToken(ACCOUNT_A);

    expect(await readToken(ACCOUNT_A)).toBeUndefined();
    expect(await readToken(ACCOUNT_B)).toBe('token-b');
  });
});

describe('hasToken', () => {
  it('reports true for the account that has an item, false for another', async () => {
    await saveToken(ACCOUNT_A, 'secret-token');

    expect(await hasToken(ACCOUNT_A)).toBe(true);
    expect(await hasToken(ACCOUNT_B)).toBe(false);
    // The existence probe must be attributes-only: reading the item back would
    // decrypt the token into the JS heap, which is the whole point of hasToken.
    expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
  });
});

describe('per-account token hardening', () => {
  it('stores the token under the per-account service, readable only while unlocked', async () => {
    await saveToken(ACCOUNT_A, 'secret-token');

    expect(Keychain.setGenericPassword).toHaveBeenCalledWith('monobank', 'secret-token', {
      service: serviceFor(ACCOUNT_A),
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
  });

  it('adds no accessControl (a biometric prompt would break the silent auto-sync read)', async () => {
    await saveToken(ACCOUNT_A, 'secret-token');

    const [, , options] = (Keychain.setGenericPassword as jest.Mock).mock.calls.at(-1) ?? [];

    expect(options).not.toHaveProperty('accessControl');
  });
});

describe('saveGlobalToken', () => {
  it('writes the transitional GLOBAL item with the hardened options (for the old-app import)', async () => {
    await saveGlobalToken('imported-token');

    expect(Keychain.setGenericPassword).toHaveBeenCalledWith('monobank', 'imported-token', {
      service: MONOBANK_TOKEN_SERVICE,
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
    const [, , options] = (Keychain.setGenericPassword as jest.Mock).mock.calls.at(-1) ?? [];
    expect(options).not.toHaveProperty('accessControl');
  });
});

describe('migrateLegacyToken', () => {
  it('copies a legacy token to the global service and clears the legacy service', async () => {
    await Keychain.setGenericPassword('monobank', 'legacy-token', { service: LEGACY_SERVICE });

    await migrateLegacyToken();

    expect(await Keychain.getGenericPassword({ service: MONOBANK_TOKEN_SERVICE })).toMatchObject({
      password: 'legacy-token',
    });
    expect(await Keychain.getGenericPassword({ service: LEGACY_SERVICE })).toBe(false);
  });

  it('does nothing and preserves the legacy value when the global service already has a token', async () => {
    await saveGlobalToken('global-token');
    await Keychain.setGenericPassword('monobank', 'stale-legacy', { service: LEGACY_SERVICE });

    await migrateLegacyToken();

    expect(await Keychain.getGenericPassword({ service: MONOBANK_TOKEN_SERVICE })).toMatchObject({
      password: 'global-token',
    });
    expect(await Keychain.getGenericPassword({ service: LEGACY_SERVICE })).toMatchObject({
      password: 'stale-legacy',
    });
  });

  it('does nothing on a fresh install with no legacy token', async () => {
    await migrateLegacyToken();

    expect(await Keychain.getGenericPassword({ service: MONOBANK_TOKEN_SERVICE })).toBe(false);
  });

  it('is idempotent: a second run after migrating is a no-op', async () => {
    await Keychain.setGenericPassword('monobank', 'legacy-token', { service: LEGACY_SERVICE });

    await migrateLegacyToken();
    await migrateLegacyToken();

    expect(await Keychain.getGenericPassword({ service: MONOBANK_TOKEN_SERVICE })).toMatchObject({
      password: 'legacy-token',
    });
    expect(await Keychain.getGenericPassword({ service: LEGACY_SERVICE })).toBe(false);
    // The copy write happened exactly once (first run only).
    expect(
      (Keychain.setGenericPassword as jest.Mock).mock.calls.filter(
        ([, , options]) => options?.service === MONOBANK_TOKEN_SERVICE,
      ),
    ).toHaveLength(1);
  });

  it('hardens the token when migrating it from the legacy service', async () => {
    await Keychain.setGenericPassword('monobank', 'legacy-token', { service: LEGACY_SERVICE });

    await migrateLegacyToken();

    expect(Keychain.setGenericPassword).toHaveBeenLastCalledWith('monobank', 'legacy-token', {
      service: MONOBANK_TOKEN_SERVICE,
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
  });
});
