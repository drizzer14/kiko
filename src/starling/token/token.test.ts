import * as Keychain from 'react-native-keychain';

import {
  clearToken,
  hasToken,
  readToken,
  saveToken,
  serviceFor,
  STARLING_TOKEN_SERVICE,
} from './token';

const ACCOUNT_A = 'acc-a';
const ACCOUNT_B = 'acc-b';

// A service-keyed in-memory Keychain double — mirrors
// `src/monobank/token/token.test.ts` and `src/privatbank/credentials/credentials.test.ts`.
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
  await Keychain.resetGenericPassword({ service: serviceFor(ACCOUNT_A) });
  await Keychain.resetGenericPassword({ service: serviceFor(ACCOUNT_B) });
  jest.clearAllMocks();
});

describe('serviceFor', () => {
  it('derives a distinct per-account service from the account id', () => {
    expect(serviceFor(ACCOUNT_A)).toBe('kiko.starling.token.acc-a');
    expect(serviceFor(ACCOUNT_A)).not.toBe(serviceFor(ACCOUNT_B));
    expect(STARLING_TOKEN_SERVICE).toBe('kiko.starling.token');
  });
});

describe('per-account Starling token', () => {
  it('saves and reads a token under the account id', async () => {
    await saveToken(ACCOUNT_A, 'pat-secret');
    expect(await readToken(ACCOUNT_A)).toBe('pat-secret');
  });

  it('clears the token for the account id', async () => {
    await saveToken(ACCOUNT_A, 'pat-secret');
    await clearToken(ACCOUNT_A);
    expect(await readToken(ACCOUNT_A)).toBeUndefined();
  });

  it('isolates two account ids: reading one never returns the other', async () => {
    await saveToken(ACCOUNT_A, 'pat-a');
    await saveToken(ACCOUNT_B, 'pat-b');

    expect(await readToken(ACCOUNT_A)).toBe('pat-a');
    expect(await readToken(ACCOUNT_B)).toBe('pat-b');
  });

  it('clearing one account never clears another', async () => {
    await saveToken(ACCOUNT_A, 'pat-a');
    await saveToken(ACCOUNT_B, 'pat-b');

    await clearToken(ACCOUNT_A);

    expect(await readToken(ACCOUNT_A)).toBeUndefined();
    expect(await readToken(ACCOUNT_B)).toBe('pat-b');
  });

  it('returns undefined when nothing is stored for the account', async () => {
    expect(await readToken(ACCOUNT_A)).toBeUndefined();
  });
});

describe('hasToken', () => {
  it('reports true for the account that has an item, false for another', async () => {
    await saveToken(ACCOUNT_A, 'pat-secret');

    expect(await hasToken(ACCOUNT_A)).toBe(true);
    expect(await hasToken(ACCOUNT_B)).toBe(false);
    // The existence probe must be attributes-only: reading the item back
    // would decrypt the token into the JS heap, which is the whole point of
    // hasToken.
    expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
  });
});

describe('per-account token hardening', () => {
  it('stores the token under the per-account service, readable only while unlocked', async () => {
    await saveToken(ACCOUNT_A, 'pat-secret');

    expect(Keychain.setGenericPassword).toHaveBeenCalledWith('starling', 'pat-secret', {
      service: serviceFor(ACCOUNT_A),
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
  });

  it('adds no accessControl (a biometric prompt would break the silent auto-sync read)', async () => {
    await saveToken(ACCOUNT_A, 'pat-secret');

    const [, , options] = (Keychain.setGenericPassword as jest.Mock).mock.calls.at(-1) ?? [];

    expect(options).not.toHaveProperty('accessControl');
  });
});
