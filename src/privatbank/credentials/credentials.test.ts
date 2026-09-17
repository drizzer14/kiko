import {
  clearCredentials,
  hasCredentials,
  PRIVATBANK_CREDENTIALS_SERVICE,
  readCredentials,
  saveCredentials,
  serviceFor,
} from './credentials';

// Mirrors `src/crypto-sync/binance/binance.credentials.test.ts`'s service-keyed
// Keychain double, minus the legacy-policy re-save latch — PrivatBank has no
// pre-multi-account era to migrate from (unlike Binance/Monobank), so this
// double only needs the plain per-account round trip.
const mockSet = jest.fn();
const mockGet = jest.fn();

jest.mock('react-native-keychain', () => {
  const store: Record<string, { username: string; password: string }> = {};
  const key = (options?: { service?: string }): string => options?.service ?? 'default';
  return {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
    setGenericPassword: jest.fn(
      async (username: string, password: string, options?: { service?: string }) => {
        mockSet(username, password, options);
        store[key(options)] = { username, password };
        return true;
      },
    ),
    getGenericPassword: jest.fn(async (options?: { service?: string }) => {
      mockGet(options);
      return store[key(options)] ?? false;
    }),
    hasGenericPassword: jest.fn(async (options?: { service?: string }) => key(options) in store),
    resetGenericPassword: jest.fn(async (options?: { service?: string }) => {
      delete store[key(options)];
      return true;
    }),
  };
});

const ACCOUNT_A = 'acc-a';
const ACCOUNT_B = 'acc-b';
const fixture = { token: 'token-fixture', clientId: 'client-id-fixture' };

const keychain = jest.requireMock('react-native-keychain') as {
  resetGenericPassword: (options?: { service?: string }) => Promise<boolean>;
  setGenericPassword: (username: string, password: string, options?: unknown) => Promise<boolean>;
};

beforeEach(async () => {
  await keychain.resetGenericPassword({ service: serviceFor(ACCOUNT_A) });
  await keychain.resetGenericPassword({ service: serviceFor(ACCOUNT_B) });
  jest.clearAllMocks();
});

describe('serviceFor', () => {
  it('derives a distinct per-account service from the account id', () => {
    expect(serviceFor(ACCOUNT_A)).toBe('kiko.privatbank.credentials.acc-a');
    expect(serviceFor(ACCOUNT_A)).not.toBe(serviceFor(ACCOUNT_B));
    expect(PRIVATBANK_CREDENTIALS_SERVICE).toBe('kiko.privatbank.credentials');
  });
});

describe('per-account PrivatBank credentials', () => {
  it('saves the pair as one JSON Keychain item under the per-account service, unlocked-only with no per-read biometric', async () => {
    await saveCredentials(ACCOUNT_A, fixture);

    expect(mockSet).toHaveBeenCalledWith('privatbank', JSON.stringify(fixture), {
      service: serviceFor(ACCOUNT_A),
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
    const [, , options] = mockSet.mock.calls.at(-1) ?? [];
    expect(options).not.toHaveProperty('accessControl');
  });

  it('reads the pair back under the account id', async () => {
    await saveCredentials(ACCOUNT_A, fixture);

    expect(await readCredentials(ACCOUNT_A)).toEqual(fixture);
    expect(mockGet).toHaveBeenCalledWith({ service: serviceFor(ACCOUNT_A) });
  });

  it('isolates two account ids: reading one never returns the other', async () => {
    await saveCredentials(ACCOUNT_A, { token: 'tok-a', clientId: 'client-a' });
    await saveCredentials(ACCOUNT_B, { token: 'tok-b', clientId: 'client-b' });

    expect(await readCredentials(ACCOUNT_A)).toEqual({ token: 'tok-a', clientId: 'client-a' });
    expect(await readCredentials(ACCOUNT_B)).toEqual({ token: 'tok-b', clientId: 'client-b' });
  });

  it('clearing one account never clears another', async () => {
    await saveCredentials(ACCOUNT_A, { token: 'tok-a', clientId: 'client-a' });
    await saveCredentials(ACCOUNT_B, { token: 'tok-b', clientId: 'client-b' });

    await clearCredentials(ACCOUNT_A);

    expect(await readCredentials(ACCOUNT_A)).toBeUndefined();
    expect(await readCredentials(ACCOUNT_B)).toEqual({ token: 'tok-b', clientId: 'client-b' });
  });

  it('returns undefined when nothing is stored for the account', async () => {
    expect(await readCredentials(ACCOUNT_A)).toBeUndefined();
  });

  it('returns undefined for a corrupt or mis-shaped stored value', async () => {
    await keychain.setGenericPassword('privatbank', 'not-json', {
      service: serviceFor(ACCOUNT_A),
    });
    expect(await readCredentials(ACCOUNT_A)).toBeUndefined();

    await keychain.setGenericPassword('privatbank', JSON.stringify({ token: 'only-token' }), {
      service: serviceFor(ACCOUNT_A),
    });
    expect(await readCredentials(ACCOUNT_A)).toBeUndefined();
  });

  it('reports whether credentials are stored, without handing the value back', async () => {
    expect(await hasCredentials(ACCOUNT_A)).toBe(false);

    await saveCredentials(ACCOUNT_A, fixture);

    expect(await hasCredentials(ACCOUNT_A)).toBe(true);
    expect(await hasCredentials(ACCOUNT_B)).toBe(false);
  });
});
