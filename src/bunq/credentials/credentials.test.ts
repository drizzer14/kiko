import {
  apiKeyServiceFor,
  BUNQ_APIKEY_SERVICE,
  BUNQ_CONTEXT_SERVICE,
  clearCredentials,
  contextServiceFor,
  hasCredentials,
  readApiKey,
  readContext,
  saveApiKey,
  saveContext,
} from './credentials';

// Mirrors `src/privatbank/credentials/credentials.test.ts`'s service-keyed
// Keychain double, extended with a SECOND per-account service (the derived
// session context) so `clearCredentials` clearing BOTH items can be asserted.
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
const apiKeyFixture = { apiKey: 'bunq-key-fixture' };
const contextFixture = {
  privateKeyPem: '-----BEGIN PRIVATE KEY-----fixture',
  publicKeyPem: '-----BEGIN PUBLIC KEY-----fixture',
  installationToken: 'install-token-fixture',
  deviceId: 'device-1',
  sessionToken: 'session-token-fixture',
  sessionExpiresAt: 1_700_000_000_000,
  userId: 'user-1',
};

const keychain = jest.requireMock('react-native-keychain') as {
  resetGenericPassword: (options?: { service?: string }) => Promise<boolean>;
  setGenericPassword: (username: string, password: string, options?: unknown) => Promise<boolean>;
};

beforeEach(async () => {
  await keychain.resetGenericPassword({ service: apiKeyServiceFor(ACCOUNT_A) });
  await keychain.resetGenericPassword({ service: apiKeyServiceFor(ACCOUNT_B) });
  await keychain.resetGenericPassword({ service: contextServiceFor(ACCOUNT_A) });
  await keychain.resetGenericPassword({ service: contextServiceFor(ACCOUNT_B) });
  jest.clearAllMocks();
});

describe('service derivation', () => {
  it('derives distinct per-account services for the API key and the context, from distinct roots', () => {
    expect(apiKeyServiceFor(ACCOUNT_A)).toBe('kiko.bunq.apiKey.acc-a');
    expect(contextServiceFor(ACCOUNT_A)).toBe('kiko.bunq.context.acc-a');
    expect(apiKeyServiceFor(ACCOUNT_A)).not.toBe(apiKeyServiceFor(ACCOUNT_B));
    expect(apiKeyServiceFor(ACCOUNT_A)).not.toBe(contextServiceFor(ACCOUNT_A));
    expect(BUNQ_APIKEY_SERVICE).toBe('kiko.bunq.apiKey');
    expect(BUNQ_CONTEXT_SERVICE).toBe('kiko.bunq.context');
  });
});

describe('per-account bunq API key', () => {
  it('saves the key as one JSON Keychain item under the per-account service, unlocked-only with no per-read biometric', async () => {
    await saveApiKey(ACCOUNT_A, apiKeyFixture);

    expect(mockSet).toHaveBeenCalledWith('bunq', JSON.stringify(apiKeyFixture), {
      service: apiKeyServiceFor(ACCOUNT_A),
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
    const [, , options] = mockSet.mock.calls.at(-1) ?? [];
    expect(options).not.toHaveProperty('accessControl');
  });

  it('reads the key back under the account id, round-tripping the exact value', async () => {
    await saveApiKey(ACCOUNT_A, apiKeyFixture);

    expect(await readApiKey(ACCOUNT_A)).toEqual(apiKeyFixture);
  });

  it('isolates two account ids: reading one never returns the other', async () => {
    await saveApiKey(ACCOUNT_A, { apiKey: 'key-a' });
    await saveApiKey(ACCOUNT_B, { apiKey: 'key-b' });

    expect(await readApiKey(ACCOUNT_A)).toEqual({ apiKey: 'key-a' });
    expect(await readApiKey(ACCOUNT_B)).toEqual({ apiKey: 'key-b' });
  });

  it('returns undefined when nothing is stored, or the stored value is corrupt or mis-shaped', async () => {
    expect(await readApiKey(ACCOUNT_A)).toBeUndefined();

    await keychain.setGenericPassword('bunq', 'not-json', { service: apiKeyServiceFor(ACCOUNT_A) });
    expect(await readApiKey(ACCOUNT_A)).toBeUndefined();

    await keychain.setGenericPassword('bunq', JSON.stringify({ notApiKey: 'x' }), {
      service: apiKeyServiceFor(ACCOUNT_A),
    });
    expect(await readApiKey(ACCOUNT_A)).toBeUndefined();
  });

  it('reports whether an API key is stored, without handing the value back', async () => {
    expect(await hasCredentials(ACCOUNT_A)).toBe(false);

    await saveApiKey(ACCOUNT_A, apiKeyFixture);

    expect(await hasCredentials(ACCOUNT_A)).toBe(true);
    expect(await hasCredentials(ACCOUNT_B)).toBe(false);
  });
});

describe('per-account bunq session context', () => {
  it('saves and reads back the full context round trip', async () => {
    await saveContext(ACCOUNT_A, contextFixture);

    expect(await readContext(ACCOUNT_A)).toEqual(contextFixture);
  });

  it('isolates two account ids', async () => {
    await saveContext(ACCOUNT_A, contextFixture);
    await saveContext(ACCOUNT_B, { ...contextFixture, userId: 'user-2' });

    expect(await readContext(ACCOUNT_A)).toEqual(contextFixture);
    expect((await readContext(ACCOUNT_B))?.userId).toBe('user-2');
  });

  it('returns undefined when nothing is stored, or the stored value is missing a required field', async () => {
    expect(await readContext(ACCOUNT_A)).toBeUndefined();

    const { sessionExpiresAt: _sessionExpiresAt, ...withoutExpiry } = contextFixture;
    await keychain.setGenericPassword('bunq', JSON.stringify(withoutExpiry), {
      service: contextServiceFor(ACCOUNT_A),
    });
    expect(await readContext(ACCOUNT_A)).toBeUndefined();
  });
});

describe('clearCredentials', () => {
  it('removes BOTH the API key and the context for the account, leaving another account untouched', async () => {
    await saveApiKey(ACCOUNT_A, apiKeyFixture);
    await saveContext(ACCOUNT_A, contextFixture);
    await saveApiKey(ACCOUNT_B, { apiKey: 'key-b' });
    await saveContext(ACCOUNT_B, { ...contextFixture, userId: 'user-2' });

    await clearCredentials(ACCOUNT_A);

    expect(await readApiKey(ACCOUNT_A)).toBeUndefined();
    expect(await readContext(ACCOUNT_A)).toBeUndefined();
    expect(await readApiKey(ACCOUNT_B)).toEqual({ apiKey: 'key-b' });
    expect((await readContext(ACCOUNT_B))?.userId).toBe('user-2');
  });
});
