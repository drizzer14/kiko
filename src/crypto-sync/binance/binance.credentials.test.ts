import {
  BINANCE_CREDENTIALS_SERVICE,
  clearCredentials,
  clearCredentialsIfWrittenBy,
  readCredentials,
  saveCredentials,
  serviceFor,
} from './binance.credentials';

// Mirrors `src/monobank/token/token.test.ts`'s service-keyed Keychain double, extended
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
  getGenericPassword: jest.Mock<Promise<unknown>, [unknown]>;
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

// Holds the answer of the next Keychain read, after the read itself ran, so a test can change what
// is stored while the reader still holds the old answer.
const holdNextReadAnswer = (target: KeychainMock): (() => void) => {
  const mocked = target.getGenericPassword;
  const original = mocked.getMockImplementation() as (...args: unknown[]) => Promise<unknown>;
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  mocked.mockImplementationOnce(async (...args: unknown[]) => {
    const answer = await original(...args);

    await gate;

    return answer;
  });

  return release;
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

// A clear for a write is judged by WHICH write stored the pair, never by the pair's value: the
// same keys saved twice are two writes, and the first writer must not clear the second's.
describe('clearCredentialsIfWrittenBy', () => {
  it('clears the pair when the stored pair is still the one the token wrote', async () => {
    const token = await saveCredentials(ACCOUNT_A, fixture);

    await clearCredentialsIfWrittenBy(ACCOUNT_A, token);

    expect(await readCredentials(ACCOUNT_A)).toBeUndefined();
  });

  it('gives every save its own token, even for the same pair', async () => {
    const first = await saveCredentials(ACCOUNT_A, fixture);
    const second = await saveCredentials(ACCOUNT_A, fixture);

    expect(second).not.toBe(first);
  });

  it('keeps the same pair a second save stored, when the first save token clears', async () => {
    const first = await saveCredentials(ACCOUNT_A, fixture);
    const second = await saveCredentials(ACCOUNT_A, fixture);

    await clearCredentialsIfWrittenBy(ACCOUNT_A, first);

    expect(await readCredentials(ACCOUNT_A)).toEqual(fixture);

    await clearCredentialsIfWrittenBy(ACCOUNT_A, second);

    expect(await readCredentials(ACCOUNT_A)).toBeUndefined();
  });

  it('keeps a newer pair when an older save token clears', async () => {
    const older = await saveCredentials(ACCOUNT_A, fixture);
    await saveCredentials(ACCOUNT_A, pairOf('newer'));

    await clearCredentialsIfWrittenBy(ACCOUNT_A, older);

    expect(await readCredentials(ACCOUNT_A)).toEqual(pairOf('newer'));
  });

  it('resolves without an error when the pair was already cleared', async () => {
    const token = await saveCredentials(ACCOUNT_A, fixture);
    await clearCredentials(ACCOUNT_A);

    await expect(clearCredentialsIfWrittenBy(ACCOUNT_A, token)).resolves.toBeUndefined();
  });

  it('keeps a pair saved after a clear when the token of the cleared pair clears', async () => {
    const cleared = await saveCredentials(ACCOUNT_A, fixture);
    await clearCredentials(ACCOUNT_A);
    await saveCredentials(ACCOUNT_A, fixture);

    await clearCredentialsIfWrittenBy(ACCOUNT_A, cleared);

    expect(await readCredentials(ACCOUNT_A)).toEqual(fixture);
  });

  it('keeps the token of the earlier save after a later save failed', async () => {
    const stored = await saveCredentials(ACCOUNT_A, fixture);
    const failing = holdNextWrite('setGenericPassword');
    const failed = expect(saveCredentials(ACCOUNT_A, pairOf('lost'))).rejects.toThrow(
      'keychain write failed',
    );

    await settle();
    failing.fail();
    await failed;
    await clearCredentialsIfWrittenBy(ACCOUNT_A, stored);

    expect(await readCredentials(ACCOUNT_A)).toBeUndefined();
  });

  it('keeps matching the token after a clear that failed', async () => {
    const token = await saveCredentials(ACCOUNT_A, fixture);
    const failing = holdNextWrite('resetGenericPassword');
    const failed = expect(clearCredentialsIfWrittenBy(ACCOUNT_A, token)).rejects.toThrow(
      'keychain write failed',
    );

    await settle();
    failing.fail();
    await failed;
    await clearCredentialsIfWrittenBy(ACCOUNT_A, token);

    expect(await readCredentials(ACCOUNT_A)).toBeUndefined();
  });

  it('only touches the account it is given', async () => {
    const tokenA = await saveCredentials(ACCOUNT_A, fixture);
    await saveCredentials(ACCOUNT_B, fixture);

    await clearCredentialsIfWrittenBy(ACCOUNT_B, tokenA);

    expect(await readCredentials(ACCOUNT_B)).toEqual(fixture);
    expect(await readCredentials(ACCOUNT_A)).toEqual(fixture);
  });

  it('judges the token only after a save for the account ends, so it keeps a newer pair', async () => {
    const older = await saveCredentials(ACCOUNT_A, fixture);
    const save = holdNextWrite('setGenericPassword');
    const newer = saveCredentials(ACCOUNT_A, pairOf('newer'));
    const clear = clearCredentialsIfWrittenBy(ACCOUNT_A, older);

    await settle();
    expect(keychain.resetGenericPassword).not.toHaveBeenCalled();

    save.release();
    await Promise.all([newer, clear]);

    expect(await readCredentials(ACCOUNT_A)).toEqual(pairOf('newer'));
  });

  // A process restart loses every token: nothing matches, so nothing is cleared.
  it('clears nothing with a token no save of this process made', async () => {
    const { mod: fresh, keychain: freshKeychain } = freshCredentials();
    await freshKeychain.setGenericPassword('binance', JSON.stringify(fixture), {
      service: serviceFor(ACCOUNT_A),
    });
    const token = await saveCredentials(ACCOUNT_A, fixture);

    await fresh.clearCredentialsIfWrittenBy(ACCOUNT_A, token);

    expect(await fresh.readCredentials(ACCOUNT_A)).toEqual(fixture);
  });
});

describe('binance credentials — the access-policy repair is one serialized step', () => {
  // A read of a pair stored under the old policy answers, then `between` runs before the repair
  // can save, and the read ends.
  const readLegacyPairWhile = async (
    between: (fresh: CredentialsModule) => Promise<unknown>,
  ): Promise<CredentialsModule> => {
    const { mod: fresh, keychain: freshKeychain } = freshCredentials();
    await freshKeychain.setGenericPassword('binance', JSON.stringify(fixture), {
      service: serviceFor(ACCOUNT_A),
      accessControl: 'BiometryCurrentSet',
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
    const release = holdNextReadAnswer(freshKeychain);
    const reading = fresh.readCredentials(ACCOUNT_A);

    await settle();
    await between(fresh);
    release();
    await reading;

    return fresh;
  };

  it('leaves a pair that was cleared between its read and its save cleared', async () => {
    const fresh = await readLegacyPairWhile((module) => module.clearCredentials(ACCOUNT_A));

    expect(await fresh.readCredentials(ACCOUNT_A)).toBeUndefined();
  });

  it('keeps a pair saved between its read and its save', async () => {
    const fresh = await readLegacyPairWhile((module) =>
      module.saveCredentials(ACCOUNT_A, pairOf('newer')),
    );

    expect(await fresh.readCredentials(ACCOUNT_A)).toEqual(pairOf('newer'));
  });
});
