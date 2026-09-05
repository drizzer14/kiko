import * as Keychain from 'react-native-keychain';

import { clearToken, migrateLegacyToken, readToken, saveToken } from './token';

const LEGACY_SERVICE = 'pff.monobank.token';
const NEW_SERVICE = 'kiko.monobank.token';

// A service-keyed in-memory Keychain: each `service` has its own credential
// slot, so the legacy->new token migration can be exercised across services.
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
    resetGenericPassword: jest.fn(async (options?: { service?: string }) => {
      delete store[key(options)];
      return true;
    }),
  };
});

beforeEach(async () => {
  // The mock's credential store lives in the factory closure and persists
  // across tests; clear both services so each test starts from an empty
  // Keychain. jest.clearAllMocks only resets call records, not that store.
  await Keychain.resetGenericPassword({ service: NEW_SERVICE });
  await Keychain.resetGenericPassword({ service: LEGACY_SERVICE });
  jest.clearAllMocks();
});

describe('monobank token', () => {
  it('saves and reads the token', async () => {
    await saveToken('secret-token');
    expect(await readToken()).toBe('secret-token');
  });

  it('clears the token', async () => {
    await saveToken('secret-token');
    await clearToken();
    expect(await readToken()).toBeUndefined();
  });
});

describe('migrateLegacyToken', () => {
  it('copies a legacy token to the new service and clears the legacy service', async () => {
    await Keychain.setGenericPassword('monobank', 'legacy-token', { service: LEGACY_SERVICE });

    await migrateLegacyToken();

    expect(await readToken()).toBe('legacy-token');
    expect(await Keychain.getGenericPassword({ service: LEGACY_SERVICE })).toBe(false);
  });

  it('does nothing and preserves the legacy value when the new service already has a token', async () => {
    await saveToken('new-token');
    await Keychain.setGenericPassword('monobank', 'stale-legacy', { service: LEGACY_SERVICE });

    await migrateLegacyToken();

    // New service untouched; legacy left as-is (already-migrated device).
    expect(await readToken()).toBe('new-token');
    expect(await Keychain.getGenericPassword({ service: LEGACY_SERVICE })).toMatchObject({
      password: 'stale-legacy',
    });
  });

  it('does nothing on a fresh install with no legacy token', async () => {
    await migrateLegacyToken();

    expect(await readToken()).toBeUndefined();
  });

  it('is idempotent: a second run after migrating is a no-op', async () => {
    await Keychain.setGenericPassword('monobank', 'legacy-token', { service: LEGACY_SERVICE });

    await migrateLegacyToken();
    await migrateLegacyToken();

    expect(await readToken()).toBe('legacy-token');
    expect(await Keychain.getGenericPassword({ service: LEGACY_SERVICE })).toBe(false);
    // The copy write happened exactly once (first run only).
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith('monobank', 'legacy-token', {
      service: NEW_SERVICE,
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
    expect(
      (Keychain.setGenericPassword as jest.Mock).mock.calls.filter(
        ([, , options]) => options?.service === NEW_SERVICE,
      ),
    ).toHaveLength(1);
  });
});

describe('monobank token hardening', () => {
  it('stores the token readable only while unlocked and never migrated off-device', async () => {
    await saveToken('secret-token');

    expect(Keychain.setGenericPassword).toHaveBeenCalledWith('monobank', 'secret-token', {
      service: NEW_SERVICE,
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
  });

  it('adds no accessControl (a biometric prompt would break the silent auto-sync read)', async () => {
    await saveToken('secret-token');

    const [, , options] = (Keychain.setGenericPassword as jest.Mock).mock.calls.at(-1) ?? [];

    expect(options).not.toHaveProperty('accessControl');
  });

  it('hardens the token when migrating it from the legacy service', async () => {
    await Keychain.setGenericPassword('monobank', 'legacy-token', { service: LEGACY_SERVICE });

    await migrateLegacyToken();

    expect(Keychain.setGenericPassword).toHaveBeenLastCalledWith('monobank', 'legacy-token', {
      service: NEW_SERVICE,
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
    expect(await readToken()).toBe('legacy-token');
  });
});
