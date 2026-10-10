import {
  BINANCE_CREDENTIALS_SERVICE,
  clearCredentials,
  clearCredentialsIfStored,
  readCredentials,
  saveCredentials,
  serviceFor,
} from './binance.credentials';

// Mirrors `src/monobank/token.test.ts`'s service-keyed Keychain double, extended
// to record the options each call was made with so the access-control flags can
// be asserted. Each `service` has its own credential slot, so per-account
// isolation and the global -> per-account move can both be exercised.
const mockSet = jest.fn();
const mockGet = jest.fn();

jest.mock('react-native-keychain', () => {
  const store: Record<string, { username: string; password: string }> = {};
  const key = (options?: { service?: string }): string => options?.service ?? 'default';

  return {
    ACCESS_CONTROL: { BIOMETRY_CURRENT_SET: 'BiometryCurrentSet' },
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
    resetGenericPassword: jest.fn(async (options?: { service?: string }) => {
      delete store[key(options)];

      return true;
    }),
  };
});

const ACCOUNT_A = 'acc-a';
const ACCOUNT_B = 'acc-b';
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

const keychain = jest.requireMock('react-native-keychain') as {
  resetGenericPassword: (options?: { service?: string }) => Promise<boolean>;
  setGenericPassword: (username: string, password: string, options?: unknown) => Promise<boolean>;
};

beforeEach(async () => {
  // The mock's credential store lives in the factory closure and persists across
  // tests; clear every service each test touches so it starts from an empty
  // Keychain. jest.clearAllMocks only resets call records, not that store.
  await keychain.resetGenericPassword({ service: BINANCE_CREDENTIALS_SERVICE });
  await keychain.resetGenericPassword({ service: serviceFor(ACCOUNT_A) });
  await keychain.resetGenericPassword({ service: serviceFor(ACCOUNT_B) });
  jest.clearAllMocks();
});

describe('serviceFor', () => {
  it('derives a distinct per-account service from the account id', () => {
    expect(serviceFor(ACCOUNT_A)).toBe('kiko.binance.credentials.acc-a');
    expect(serviceFor(ACCOUNT_A)).not.toBe(serviceFor(ACCOUNT_B));
  });
});

describe('per-account binance credentials', () => {
  it('saves the pair as one JSON Keychain item under the per-account service, unlocked-only with no per-read biometric', async () => {
    await saveCredentials(ACCOUNT_A, fixture);

    expect(mockSet).toHaveBeenCalledWith('binance', JSON.stringify(fixture), {
      service: serviceFor(ACCOUNT_A),
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
  });

  it('adds no accessControl (a per-read biometric prompt would fire Face ID on every pull-to-refresh)', async () => {
    await saveCredentials(ACCOUNT_A, fixture);

    const [, , options] = mockSet.mock.calls.at(-1) ?? [];

    expect(options).not.toHaveProperty('accessControl');
  });

  it('reads the pair back under the account id, without a biometric prompt', async () => {
    await saveCredentials(ACCOUNT_A, fixture);

    expect(await readCredentials(ACCOUNT_A)).toEqual(fixture);
    expect(mockGet).toHaveBeenCalledWith({ service: serviceFor(ACCOUNT_A) });
  });

  it('isolates two account ids: reading one never returns the other', async () => {
    await saveCredentials(ACCOUNT_A, { apiKey: 'ak-a', secret: 'sk-a' });
    await saveCredentials(ACCOUNT_B, { apiKey: 'ak-b', secret: 'sk-b' });

    expect(await readCredentials(ACCOUNT_A)).toEqual({ apiKey: 'ak-a', secret: 'sk-a' });
    expect(await readCredentials(ACCOUNT_B)).toEqual({ apiKey: 'ak-b', secret: 'sk-b' });
  });

  it('clearing one account never clears another', async () => {
    await saveCredentials(ACCOUNT_A, { apiKey: 'ak-a', secret: 'sk-a' });
    await saveCredentials(ACCOUNT_B, { apiKey: 'ak-b', secret: 'sk-b' });

    await clearCredentials(ACCOUNT_A);

    expect(await readCredentials(ACCOUNT_A)).toBeUndefined();
    expect(await readCredentials(ACCOUNT_B)).toEqual({ apiKey: 'ak-b', secret: 'sk-b' });
  });

  it('returns undefined when nothing is stored for the account', async () => {
    expect(await readCredentials(ACCOUNT_A)).toBeUndefined();
  });

  it('returns undefined for a corrupt or mis-shaped stored value', async () => {
    await keychain.setGenericPassword('binance', 'not-json', { service: serviceFor(ACCOUNT_A) });
    expect(await readCredentials(ACCOUNT_A)).toBeUndefined();

    await keychain.setGenericPassword('binance', JSON.stringify({ apiKey: 'only-half' }), {
      service: serviceFor(ACCOUNT_A),
    });
    expect(await readCredentials(ACCOUNT_A)).toBeUndefined();
  });

  it('clears the stored pair for the account', async () => {
    await saveCredentials(ACCOUNT_A, fixture);
    await clearCredentials(ACCOUNT_A);

    expect(await readCredentials(ACCOUNT_A)).toBeUndefined();
  });
});

describe('binance credentials — once-per-process re-save latch', () => {
  it('re-saves a pair stored under the old biometric policy under the hardened policy on read', async () => {
    const { mod: fresh, keychain: freshKeychain } = freshCredentials();
    // A pair written before the hardening shipped: gated by BIOMETRY_CURRENT_SET.
    await freshKeychain.setGenericPassword('binance', JSON.stringify(fixture), {
      service: serviceFor(ACCOUNT_A),
      accessControl: 'BiometryCurrentSet',
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
    mockSet.mockClear();

    expect(await fresh.readCredentials(ACCOUNT_A)).toEqual(fixture);

    expect(mockSet).toHaveBeenCalledWith('binance', JSON.stringify(fixture), {
      service: serviceFor(ACCOUNT_A),
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
  });

  it('re-saves the pair at most once per process, so a read is otherwise pure', async () => {
    const { mod: fresh, keychain: freshKeychain } = freshCredentials();
    await freshKeychain.setGenericPassword('binance', JSON.stringify(fixture), {
      service: serviceFor(ACCOUNT_A),
      accessControl: 'BiometryCurrentSet',
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
    mockSet.mockClear();

    await fresh.readCredentials(ACCOUNT_A);
    await fresh.readCredentials(ACCOUNT_A);
    await fresh.readCredentials(ACCOUNT_A);

    expect(mockSet).toHaveBeenCalledTimes(1);
  });

  it('does not trip the latch when the re-save rejects, so a later read retries it', async () => {
    const { mod: fresh, keychain: freshKeychain } = freshCredentials();
    await freshKeychain.setGenericPassword('binance', JSON.stringify(fixture), {
      service: serviceFor(ACCOUNT_A),
      accessControl: 'BiometryCurrentSet',
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
    mockSet.mockClear();

    // The first repair-save attempt fails (a real Keychain write can reject —
    // e.g. the device locks mid-write).
    (freshKeychain.setGenericPassword as jest.Mock).mockRejectedValueOnce(
      new Error('keychain write failed'),
    );

    await expect(fresh.readCredentials(ACCOUNT_A)).rejects.toThrow('keychain write failed');
    expect(mockSet).not.toHaveBeenCalled();

    // The latch must not have been set by the failed attempt: the next read
    // retries the repair-save, and this one succeeds.
    await fresh.readCredentials(ACCOUNT_A);
    expect(mockSet).toHaveBeenCalledTimes(1);

    // Now that a save has succeeded, the latch is set: a further read does
    // not re-save again.
    await fresh.readCredentials(ACCOUNT_A);
    expect(mockSet).toHaveBeenCalledTimes(1);
  });
});

type HeldWrite = { release: () => void; fail: () => void };

// Holds the next Keychain write of one kind until the test releases or fails it, so a test can
// queue more writes behind it and see which of them start before it ends.
const holdNextWrite = (method: 'setGenericPassword' | 'resetGenericPassword'): HeldWrite => {
  const mocked = keychain[method] as jest.Mock<Promise<boolean>, unknown[]>;
  const original = mocked.getMockImplementation() as (...args: unknown[]) => Promise<boolean>;
  let release = (): void => undefined;
  let fail = (): void => undefined;
  const gate = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = () => reject(new Error('keychain write failed'));
  });

  mocked.mockImplementationOnce(async (...args: unknown[]) => {
    await gate;

    return original(...args);
  });

  return { release, fail };
};

// Lets every write already allowed to start run to its next wait.
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const pairOf = (name: string): { apiKey: string; secret: string } => ({
  apiKey: `ak-${name}`,
  secret: `sk-${name}`,
});

describe('binance credential writes — one at a time per account', () => {
  it('runs two saves for one account in call order, the second starting after the first ends', async () => {
    const first = holdNextWrite('setGenericPassword');
    const saves = Promise.all([
      saveCredentials(ACCOUNT_A, pairOf('first')),
      saveCredentials(ACCOUNT_A, pairOf('second')),
    ]);

    await settle();
    expect(mockSet).not.toHaveBeenCalled();

    first.release();
    await saves;

    expect(mockSet.mock.calls.map(([, password]) => password)).toEqual([
      JSON.stringify(pairOf('first')),
      JSON.stringify(pairOf('second')),
    ]);
    expect(await readCredentials(ACCOUNT_A)).toEqual(pairOf('second'));
  });

  it('does not interleave a clear with a save for the same account', async () => {
    const save = holdNextWrite('setGenericPassword');
    const writes = Promise.all([
      saveCredentials(ACCOUNT_A, pairOf('first')),
      clearCredentials(ACCOUNT_A),
    ]);

    await settle();
    expect(keychain.resetGenericPassword).not.toHaveBeenCalled();

    save.release();
    await writes;

    expect(await readCredentials(ACCOUNT_A)).toBeUndefined();
  });

  it('does not make one account wait for another', async () => {
    const held = holdNextWrite('setGenericPassword');
    const slow = saveCredentials(ACCOUNT_A, pairOf('a'));

    await saveCredentials(ACCOUNT_B, pairOf('b'));
    expect(await readCredentials(ACCOUNT_B)).toEqual(pairOf('b'));

    held.release();
    await slow;
  });

  it('starts the next write for the account after a failed one ends', async () => {
    const failing = holdNextWrite('setGenericPassword');
    const failed = expect(saveCredentials(ACCOUNT_A, pairOf('first'))).rejects.toThrow(
      'keychain write failed',
    );
    const next = saveCredentials(ACCOUNT_A, pairOf('second'));

    await settle();
    expect(mockSet).not.toHaveBeenCalled();

    failing.fail();
    await failed;
    await next;

    expect(await readCredentials(ACCOUNT_A)).toEqual(pairOf('second'));
  });
});

describe('clearCredentialsIfStored', () => {
  it('clears the pair when the stored pair is still the expected one', async () => {
    await saveCredentials(ACCOUNT_A, fixture);

    await clearCredentialsIfStored(ACCOUNT_A, fixture);

    expect(await readCredentials(ACCOUNT_A)).toBeUndefined();
  });

  it.each([
    ['a newer pair', pairOf('newer')],
    ['the same key with another secret', { ...fixture, secret: 'secret-newer' }],
    ['another key with the same secret', { ...fixture, apiKey: 'api-key-newer' }],
  ])('keeps the stored pair when it is %s', async (_name, newer) => {
    await saveCredentials(ACCOUNT_A, newer);

    await clearCredentialsIfStored(ACCOUNT_A, fixture);

    expect(await readCredentials(ACCOUNT_A)).toEqual(newer);
  });

  it('resolves without an error when nothing is stored', async () => {
    await expect(clearCredentialsIfStored(ACCOUNT_A, fixture)).resolves.toBeUndefined();
  });

  it('only touches the account it is given', async () => {
    await saveCredentials(ACCOUNT_B, fixture);

    await clearCredentialsIfStored(ACCOUNT_A, fixture);

    expect(await readCredentials(ACCOUNT_B)).toEqual(fixture);
  });

  it('reads the stored pair only after a save for the account ends, so it keeps a newer pair', async () => {
    await saveCredentials(ACCOUNT_A, fixture);
    mockGet.mockClear();
    const save = holdNextWrite('setGenericPassword');
    const newer = saveCredentials(ACCOUNT_A, pairOf('newer'));
    const clear = clearCredentialsIfStored(ACCOUNT_A, fixture);

    await settle();
    expect(mockGet).not.toHaveBeenCalled();

    save.release();
    await Promise.all([newer, clear]);

    expect(await readCredentials(ACCOUNT_A)).toEqual(pairOf('newer'));
  });
});
