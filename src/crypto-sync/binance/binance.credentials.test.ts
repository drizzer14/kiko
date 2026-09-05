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
    const keychain = jest.requireMock('react-native-keychain') as {
      setGenericPassword: (
        username: string,
        password: string,
        options: unknown,
      ) => Promise<boolean>;
    };
    // A pair written before the hardening shipped: gated by BIOMETRY_CURRENT_SET.
    await keychain.setGenericPassword('binance', JSON.stringify(fixture), {
      service: 'kiko.binance.credentials',
      accessControl: 'BiometryCurrentSet',
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
    mockSet.mockClear();

    expect(await readCredentials()).toEqual(fixture);

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
