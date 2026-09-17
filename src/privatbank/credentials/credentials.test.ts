import * as Keychain from 'react-native-keychain';

import {
  clearCredentials,
  hasCredentials,
  PRIVATBANK_CREDENTIALS_SERVICE,
  readCredentials,
  saveCredentials,
  serviceFor,
} from './credentials';

// A service-keyed in-memory Keychain double — mirrors
// `src/starling/token/token.test.ts` and `src/monobank/token/token.test.ts`.
// VERIFIED (task-6 brief): the AutoClient credential is a SINGLE `token`
// header, not a `{ token, clientId }` pair, so this module (and its test)
// drop the JSON-blob shape and store the token as ONE plain string, exactly
// like Starling's own per-account PAT.
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

const ACCOUNT_A = 'acc-a';
const ACCOUNT_B = 'acc-b';

beforeEach(async () => {
  await Keychain.resetGenericPassword({ service: serviceFor(ACCOUNT_A) });
  await Keychain.resetGenericPassword({ service: serviceFor(ACCOUNT_B) });
  jest.clearAllMocks();
});

describe('serviceFor', () => {
  it('derives a distinct per-account service from the account id', () => {
    expect(serviceFor(ACCOUNT_A)).toBe('kiko.privatbank.credentials.acc-a');
    expect(serviceFor(ACCOUNT_A)).not.toBe(serviceFor(ACCOUNT_B));
    expect(PRIVATBANK_CREDENTIALS_SERVICE).toBe('kiko.privatbank.credentials');
  });
});

describe('per-account PrivatBank token', () => {
  it('saves and reads the token under the account id', async () => {
    await saveCredentials(ACCOUNT_A, 'token-fixture');

    expect(await readCredentials(ACCOUNT_A)).toBe('token-fixture');
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith('privatbank', 'token-fixture', {
      service: serviceFor(ACCOUNT_A),
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
  });

  it('adds no accessControl (a biometric prompt would break the silent auto-sync read)', async () => {
    await saveCredentials(ACCOUNT_A, 'token-fixture');

    const [, , options] = (Keychain.setGenericPassword as jest.Mock).mock.calls.at(-1) ?? [];

    expect(options).not.toHaveProperty('accessControl');
  });

  it('isolates two account ids: reading one never returns the other', async () => {
    await saveCredentials(ACCOUNT_A, 'tok-a');
    await saveCredentials(ACCOUNT_B, 'tok-b');

    expect(await readCredentials(ACCOUNT_A)).toBe('tok-a');
    expect(await readCredentials(ACCOUNT_B)).toBe('tok-b');
  });

  it('clearing one account never clears another', async () => {
    await saveCredentials(ACCOUNT_A, 'tok-a');
    await saveCredentials(ACCOUNT_B, 'tok-b');

    await clearCredentials(ACCOUNT_A);

    expect(await readCredentials(ACCOUNT_A)).toBeUndefined();
    expect(await readCredentials(ACCOUNT_B)).toBe('tok-b');
  });

  it('returns undefined when nothing is stored for the account', async () => {
    expect(await readCredentials(ACCOUNT_A)).toBeUndefined();
  });

  it('reports whether a token is stored, without handing the value back', async () => {
    expect(await hasCredentials(ACCOUNT_A)).toBe(false);

    await saveCredentials(ACCOUNT_A, 'token-fixture');

    expect(await hasCredentials(ACCOUNT_A)).toBe(true);
    expect(await hasCredentials(ACCOUNT_B)).toBe(false);
    // The existence probe must be attributes-only: reading the item back
    // would decrypt the token into the JS heap, which is the whole point of
    // hasCredentials.
    expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
  });
});
