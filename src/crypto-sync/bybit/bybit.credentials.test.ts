import { hardenedFor } from '@kiko/crypto-sync/exchange/credentials';

import {
  clearBybitCredentials,
  clearBybitCredentialsIfWrittenBy,
  readBybitCredentials,
  saveBybitCredentials,
} from './bybit.credentials';

const mockSet = jest.fn();

// A service-keyed in-memory Keychain, so two accounts have two items.
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
    getGenericPassword: jest.fn(
      async (options?: { service?: string }) => store[key(options)] ?? false,
    ),
    resetGenericPassword: jest.fn(async (options?: { service?: string }) => {
      delete store[key(options)];

      return true;
    }),
  };
});

const ACCOUNT_A = 'acc-a';
const ACCOUNT_B = 'acc-b';
const SERVICE_A = 'kiko.bybit.credentials.acc-a';
const fixture = { apiKey: 'api-key-fixture', secret: 'secret-fixture' };

const pairOf = (name: string): { apiKey: string; secret: string } => ({
  apiKey: `ak-${name}`,
  secret: `sk-${name}`,
});

beforeEach(async () => {
  await clearBybitCredentials(ACCOUNT_A);
  await clearBybitCredentials(ACCOUNT_B);
  jest.clearAllMocks();
});

describe('the Bybit Keychain item', () => {
  it('is saved and read under the service kiko.bybit.credentials.<accountId> and the username bybit', async () => {
    await saveBybitCredentials(ACCOUNT_A, fixture);

    expect(mockSet).toHaveBeenCalledWith('bybit', JSON.stringify(fixture), expect.anything());
    expect(mockSet.mock.calls[0][2]).toMatchObject({ service: SERVICE_A });
    expect(await readBybitCredentials(ACCOUNT_A)).toEqual(fixture);
  });

  it('the pair is written through hardenedFor at WHEN_UNLOCKED_THIS_DEVICE_ONLY', async () => {
    await saveBybitCredentials(ACCOUNT_A, fixture);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet.mock.calls[0][2]).toEqual(hardenedFor(SERVICE_A));
    expect(mockSet.mock.calls[0][2]).toEqual({
      service: SERVICE_A,
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
  });

  it('adds no accessControl, so a pull-to-refresh asks for no Face ID', async () => {
    await saveBybitCredentials(ACCOUNT_A, fixture);

    expect(mockSet.mock.calls[0][2]).not.toHaveProperty('accessControl');
  });

  it('keeps two accounts apart on a read and on a clear', async () => {
    await saveBybitCredentials(ACCOUNT_A, pairOf('a'));
    await saveBybitCredentials(ACCOUNT_B, pairOf('b'));

    expect(await readBybitCredentials(ACCOUNT_A)).toEqual(pairOf('a'));

    await clearBybitCredentials(ACCOUNT_A);

    expect(await readBybitCredentials(ACCOUNT_A)).toBeUndefined();
    expect(await readBybitCredentials(ACCOUNT_B)).toEqual(pairOf('b'));
  });

  it('reads nothing when nothing is stored', async () => {
    expect(await readBybitCredentials(ACCOUNT_A)).toBeUndefined();
  });

  it('puts no part of the pair in a log', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );

    const token = await saveBybitCredentials(ACCOUNT_A, fixture);
    await readBybitCredentials(ACCOUNT_A);
    await clearBybitCredentialsIfWrittenBy(ACCOUNT_A, token);
    await clearBybitCredentials(ACCOUNT_A);

    expect(JSON.stringify(spies.map((spy) => spy.mock.calls))).not.toMatch(
      /api-key-fixture|secret-fixture/,
    );

    for (const spy of spies) {
      spy.mockRestore();
    }
  });
});

describe('the Bybit credential writes, one at a time per account', () => {
  it('runs two saves for one account in call order', async () => {
    await Promise.all([
      saveBybitCredentials(ACCOUNT_A, pairOf('first')),
      saveBybitCredentials(ACCOUNT_A, pairOf('second')),
    ]);

    expect(mockSet.mock.calls.map(([, password]) => password)).toEqual([
      JSON.stringify(pairOf('first')),
      JSON.stringify(pairOf('second')),
    ]);
    expect(await readBybitCredentials(ACCOUNT_A)).toEqual(pairOf('second'));
  });

  it('does not let a clear queued after a save run before it', async () => {
    await Promise.all([
      saveBybitCredentials(ACCOUNT_A, pairOf('first')),
      clearBybitCredentials(ACCOUNT_A),
    ]);

    expect(await readBybitCredentials(ACCOUNT_A)).toBeUndefined();
  });
});

// A clear for a write is judged by WHICH write stored the pair, never by the pair's value: the
// same keys saved twice are two writes, and the first writer must not clear the second's.
describe('clearBybitCredentialsIfWrittenBy', () => {
  it('clears the pair when the stored pair is still the one the token wrote', async () => {
    const token = await saveBybitCredentials(ACCOUNT_A, fixture);

    await clearBybitCredentialsIfWrittenBy(ACCOUNT_A, token);

    expect(await readBybitCredentials(ACCOUNT_A)).toBeUndefined();
  });

  it('keeps the same pair a second save stored, when the first save token clears', async () => {
    const first = await saveBybitCredentials(ACCOUNT_A, fixture);
    const second = await saveBybitCredentials(ACCOUNT_A, fixture);

    await clearBybitCredentialsIfWrittenBy(ACCOUNT_A, first);

    expect(await readBybitCredentials(ACCOUNT_A)).toEqual(fixture);

    await clearBybitCredentialsIfWrittenBy(ACCOUNT_A, second);

    expect(await readBybitCredentials(ACCOUNT_A)).toBeUndefined();
  });

  it('resolves without an error when the pair was already cleared, and keeps a pair saved after', async () => {
    const cleared = await saveBybitCredentials(ACCOUNT_A, fixture);
    await clearBybitCredentials(ACCOUNT_A);
    await saveBybitCredentials(ACCOUNT_A, pairOf('later'));

    await expect(clearBybitCredentialsIfWrittenBy(ACCOUNT_A, cleared)).resolves.toBeUndefined();

    expect(await readBybitCredentials(ACCOUNT_A)).toEqual(pairOf('later'));
  });

  it('keeps the pair and its token when the Keychain reset fails', async () => {
    const keychain = jest.requireMock('react-native-keychain') as {
      resetGenericPassword: jest.Mock;
    };
    const token = await saveBybitCredentials(ACCOUNT_A, fixture);
    keychain.resetGenericPassword.mockRejectedValueOnce(new Error('keychain reset failed'));

    await expect(clearBybitCredentialsIfWrittenBy(ACCOUNT_A, token)).rejects.toThrow(
      'keychain reset failed',
    );
    expect(await readBybitCredentials(ACCOUNT_A)).toEqual(fixture);

    await clearBybitCredentialsIfWrittenBy(ACCOUNT_A, token);

    expect(await readBybitCredentials(ACCOUNT_A)).toBeUndefined();
  });
});
