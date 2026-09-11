import * as Keychain from 'react-native-keychain';

import { MONOBANK_TOKEN_SERVICE, serviceFor } from '../token';

import { migrateSingleTokenToPerAccount } from './migrate-credential';

// A service-keyed in-memory Keychain: each `service` has its own credential
// slot, so the global -> per-account move can be exercised across services.
// `resetGenericPassword` can be forced to reject once, to simulate a crash-like
// failure of the FINAL delete after the per-account write already succeeded.
let mockFailNextGlobalReset = false;

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
      const service = key(options);
      if (service === 'kiko.monobank.token' && mockFailNextGlobalReset) {
        mockFailNextGlobalReset = false;
        throw new Error('keychain reset boom');
      }
      delete store[service];
      return true;
    }),
  };
});

const CONNECTED_ID = 'acc-mono';

const seedGlobalToken = async (token: string): Promise<void> => {
  await Keychain.setGenericPassword('monobank', token, { service: MONOBANK_TOKEN_SERVICE });
};

beforeEach(async () => {
  await Keychain.resetGenericPassword({ service: MONOBANK_TOKEN_SERVICE });
  await Keychain.resetGenericPassword({ service: serviceFor(CONNECTED_ID) });
  await Keychain.resetGenericPassword({ service: serviceFor('acc-other') });
  mockFailNextGlobalReset = false;
  jest.clearAllMocks();
});

describe('migrateSingleTokenToPerAccount', () => {
  it('moves the global token to the per-account service and removes the global item', async () => {
    await seedGlobalToken('the-token');

    await migrateSingleTokenToPerAccount(CONNECTED_ID);

    expect(await Keychain.getGenericPassword({ service: serviceFor(CONNECTED_ID) })).toMatchObject({
      password: 'the-token',
    });
    expect(await Keychain.getGenericPassword({ service: MONOBANK_TOKEN_SERVICE })).toBe(false);
  });

  it('keeps the per-account item ISOLATED to its own account id', async () => {
    await seedGlobalToken('the-token');

    await migrateSingleTokenToPerAccount(CONNECTED_ID);

    // Another account's per-account slot is never written by this account's migration.
    expect(await Keychain.getGenericPassword({ service: serviceFor('acc-other') })).toBe(false);
  });

  it('writes the per-account item with the HARDENED options verbatim (only the service differs)', async () => {
    await seedGlobalToken('the-token');

    await migrateSingleTokenToPerAccount(CONNECTED_ID);

    expect(Keychain.setGenericPassword).toHaveBeenCalledWith('monobank', 'the-token', {
      service: serviceFor(CONNECTED_ID),
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
    const [, , options] = (Keychain.setGenericPassword as jest.Mock).mock.calls.at(-1) ?? [];
    expect(options).not.toHaveProperty('accessControl');
  });

  it('reads the per-account item back BEFORE deleting the global item (verified-then-delete)', async () => {
    await seedGlobalToken('the-token');

    await migrateSingleTokenToPerAccount(CONNECTED_ID);

    // `invocationCallOrder` is a global monotonic counter shared across every
    // mock, so the read-back of the per-account item and the delete of the
    // global item are directly comparable — the token must be verified durable
    // BEFORE the source is removed.
    const getMock = Keychain.getGenericPassword as jest.Mock;
    const resetMock = Keychain.resetGenericPassword as jest.Mock;
    const globalDeleteIndex = resetMock.mock.calls.findIndex(
      ([options]) => options?.service === MONOBANK_TOKEN_SERVICE,
    );
    const globalDeleteOrder = resetMock.mock.invocationCallOrder[globalDeleteIndex];
    const perAccountReadOrders = getMock.mock.calls
      .map((call, index) =>
        call[0]?.service === serviceFor(CONNECTED_ID)
          ? getMock.mock.invocationCallOrder[index]
          : -1,
      )
      .filter((order) => order > 0);

    expect(globalDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(perAccountReadOrders.some((order) => order < globalDeleteOrder)).toBe(true);
  });

  it('is idempotent: a second run after a completed migration is a no-op', async () => {
    await seedGlobalToken('the-token');

    await migrateSingleTokenToPerAccount(CONNECTED_ID);
    jest.clearAllMocks();
    await migrateSingleTokenToPerAccount(CONNECTED_ID);

    // Nothing to move — no write, no delete.
    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
    expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
    expect(await Keychain.getGenericPassword({ service: serviceFor(CONNECTED_ID) })).toMatchObject({
      password: 'the-token',
    });
  });

  it('converges when a stale global item lingers alongside an existing per-account item', async () => {
    // Per-account already written, but a prior run crashed before deleting the
    // global item. This run clears the leftover global item WITHOUT rewriting.
    await Keychain.setGenericPassword('monobank', 'the-token', {
      service: serviceFor(CONNECTED_ID),
    });
    await seedGlobalToken('the-token');
    jest.clearAllMocks();

    await migrateSingleTokenToPerAccount(CONNECTED_ID);

    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
    expect(await Keychain.getGenericPassword({ service: MONOBANK_TOKEN_SERVICE })).toBe(false);
    expect(await Keychain.getGenericPassword({ service: serviceFor(CONNECTED_ID) })).toMatchObject({
      password: 'the-token',
    });
  });

  it('gates on the global item PRESENCE: no global item is a no-op (never key-absence)', async () => {
    // No global item; no per-account item either — nothing to do, nothing written.
    await migrateSingleTokenToPerAccount(CONNECTED_ID);

    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
    expect(await Keychain.getGenericPassword({ service: serviceFor(CONNECTED_ID) })).toBe(false);
  });

  it('leaves the global item untouched when there is no connected account to bind it to', async () => {
    await seedGlobalToken('the-token');

    await migrateSingleTokenToPerAccount(undefined);

    // Cannot bind a token to no account — the global item stays for a later
    // connect to adopt, or manual re-entry.
    expect(await Keychain.getGenericPassword({ service: MONOBANK_TOKEN_SERVICE })).toMatchObject({
      password: 'the-token',
    });
  });

  it('never strands the token: a failed global delete leaves a recoverable state that a re-run converges', async () => {
    await seedGlobalToken('the-token');
    mockFailNextGlobalReset = true;

    // First run: the per-account write + read-back succeed, but the FINAL global
    // delete fails. The token is already durable in the per-account item, so it
    // is never lost; the failure surfaces.
    await expect(migrateSingleTokenToPerAccount(CONNECTED_ID)).rejects.toThrow(
      'keychain reset boom',
    );
    expect(await Keychain.getGenericPassword({ service: serviceFor(CONNECTED_ID) })).toMatchObject({
      password: 'the-token',
    });
    // The global item is still present (delete failed) — a recoverable state.
    expect(await Keychain.getGenericPassword({ service: MONOBANK_TOKEN_SERVICE })).toMatchObject({
      password: 'the-token',
    });

    // Second run converges: per-account present, so the leftover global item is cleared.
    await migrateSingleTokenToPerAccount(CONNECTED_ID);
    expect(await Keychain.getGenericPassword({ service: MONOBANK_TOKEN_SERVICE })).toBe(false);
    expect(await Keychain.getGenericPassword({ service: serviceFor(CONNECTED_ID) })).toMatchObject({
      password: 'the-token',
    });
  });
});
