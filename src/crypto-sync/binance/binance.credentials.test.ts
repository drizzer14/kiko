import { clearCredentials, readCredentials, saveCredentials } from './binance.credentials';

// Mirrors `src/monobank/token.test.ts`'s Keychain double, extended to record the
// options each call was made with so the access-control flags can be asserted.
const mockSet = jest.fn();
const mockGet = jest.fn();

jest.mock('react-native-keychain', () => {
  let store: { username: string; password: string } | null = null;
  return {
    ACCESS_CONTROL: { BIOMETRY_CURRENT_SET: 'BiometryCurrentSet' },
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
    setGenericPassword: jest.fn(async (username: string, password: string, options: unknown) => {
      mockSet(username, password, options);
      store = { username, password };
      return true;
    }),
    getGenericPassword: jest.fn(async (options: unknown) => {
      mockGet(options);
      return store ?? false;
    }),
    resetGenericPassword: jest.fn(async () => {
      store = null;
      return true;
    }),
  };
});

const fixture = { apiKey: 'api-key-fixture', secret: 'secret-fixture' };

type CredentialsModule = typeof import('./binance.credentials');
type KeychainMock = {
  setGenericPassword: jest.Mock<Promise<boolean>, [string, string, unknown]>;
};

/**
 * Requires a fresh instance of the credentials module (and its mocked Keychain)
 * in an isolated registry so the once-per-process `hasRepairedAccessPolicy`
 * latch starts untripped — `jest.isolateModules()` rather than
 * `jest.resetModules()`, because it sandboxes only its own callback and so
 * leaves the file's `jest.requireMock('react-native-keychain')` binding intact,
 * whatever the test order.
 */
const freshCredentials = (): { mod: CredentialsModule; keychain: KeychainMock } => {
  let mod!: CredentialsModule;
  let keychain!: KeychainMock;

  jest.isolateModules(() => {
    mod = require('./binance.credentials');
    keychain = require('react-native-keychain');
  });

  return { mod, keychain };
};

describe('binance credentials', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearCredentials();
  });

  it('saves the pair as one JSON Keychain item under the binance service, unlocked-only with no per-read biometric', async () => {
    await saveCredentials(fixture);

    expect(mockSet).toHaveBeenCalledWith('binance', JSON.stringify(fixture), {
      service: 'kiko.binance.credentials',
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
  });

  it('adds no accessControl (a per-read biometric prompt would fire Face ID on every pull-to-refresh)', async () => {
    await saveCredentials(fixture);

    const [, , options] = mockSet.mock.calls.at(-1) ?? [];

    expect(options).not.toHaveProperty('accessControl');
  });

  it('reads the pair back without a biometric prompt (no authenticationPrompt)', async () => {
    await saveCredentials(fixture);

    expect(await readCredentials()).toEqual(fixture);
    expect(mockGet).toHaveBeenCalledWith({ service: 'kiko.binance.credentials' });
  });

  it('re-saves a pair stored under the old biometric policy under the hardened policy on read', async () => {
    const { mod: fresh, keychain } = freshCredentials();
    // A pair written before the hardening shipped: gated by BIOMETRY_CURRENT_SET.
    await keychain.setGenericPassword('binance', JSON.stringify(fixture), {
      service: 'kiko.binance.credentials',
      accessControl: 'BiometryCurrentSet',
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
    mockSet.mockClear();

    expect(await fresh.readCredentials()).toEqual(fixture);

    expect(mockSet).toHaveBeenCalledWith('binance', JSON.stringify(fixture), {
      service: 'kiko.binance.credentials',
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
  });

  it('returns undefined when nothing is stored', async () => {
    expect(await readCredentials()).toBeUndefined();
  });

  it('returns undefined for a corrupt or mis-shaped stored value', async () => {
    const keychain = jest.requireMock('react-native-keychain') as {
      setGenericPassword: (
        username: string,
        password: string,
        options: unknown,
      ) => Promise<boolean>;
    };

    await keychain.setGenericPassword('binance', 'not-json', {});
    expect(await readCredentials()).toBeUndefined();

    await keychain.setGenericPassword('binance', JSON.stringify({ apiKey: 'only-half' }), {});
    expect(await readCredentials()).toBeUndefined();
  });

  it('clears the stored pair', async () => {
    await saveCredentials(fixture);
    await clearCredentials();

    expect(await readCredentials()).toBeUndefined();
  });
});

describe('binance credentials — once-per-process re-save latch', () => {
  it('re-saves the pair at most once per process, so a read is otherwise pure', async () => {
    const { mod: fresh, keychain } = freshCredentials();
    // A pair written before the hardening shipped, same as the legacy-policy
    // test above, but against this test's own isolated module instance.
    await keychain.setGenericPassword('binance', JSON.stringify(fixture), {
      service: 'kiko.binance.credentials',
      accessControl: 'BiometryCurrentSet',
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
    mockSet.mockClear();

    await fresh.readCredentials();
    await fresh.readCredentials();
    await fresh.readCredentials();

    expect(mockSet).toHaveBeenCalledTimes(1);
  });

  it('does not trip the latch when the re-save rejects, so a later read retries it', async () => {
    const { mod: fresh, keychain } = freshCredentials();
    await keychain.setGenericPassword('binance', JSON.stringify(fixture), {
      service: 'kiko.binance.credentials',
      accessControl: 'BiometryCurrentSet',
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
    mockSet.mockClear();

    // The first repair-save attempt fails (a real Keychain write can reject —
    // e.g. the device locks mid-write).
    keychain.setGenericPassword.mockRejectedValueOnce(new Error('keychain write failed'));

    await expect(fresh.readCredentials()).rejects.toThrow('keychain write failed');
    expect(mockSet).not.toHaveBeenCalled();

    // The latch must not have been set by the failed attempt: the next read
    // retries the repair-save, and this one succeeds.
    await fresh.readCredentials();
    expect(mockSet).toHaveBeenCalledTimes(1);

    // Now that a save has succeeded, the latch is set: a further read does
    // not re-save again.
    await fresh.readCredentials();
    expect(mockSet).toHaveBeenCalledTimes(1);
  });
});
