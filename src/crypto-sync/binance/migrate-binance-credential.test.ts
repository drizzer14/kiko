import * as Keychain from 'react-native-keychain';

import { BINANCE_CREDENTIALS_SERVICE, serviceFor } from './binance.credentials';
import { migrateBinanceCredentialToPerAccount } from './migrate-binance-credential';

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
      if (service === 'kiko.binance.credentials' && mockFailNextGlobalReset) {
        mockFailNextGlobalReset = false;
        throw new Error('keychain reset boom');
      }
      delete store[service];
      return true;
    }),
  };
});

const CONNECTED_ID = 'acc-binance';
const CREDENTIALS = JSON.stringify({ apiKey: 'AK', secret: 'SK' });

const seedGlobalCredentials = async (raw: string): Promise<void> => {
  await Keychain.setGenericPassword('binance', raw, { service: BINANCE_CREDENTIALS_SERVICE });
};

beforeEach(async () => {
  await Keychain.resetGenericPassword({ service: BINANCE_CREDENTIALS_SERVICE });
  await Keychain.resetGenericPassword({ service: serviceFor(CONNECTED_ID) });
  await Keychain.resetGenericPassword({ service: serviceFor('acc-other') });
  mockFailNextGlobalReset = false;
  jest.clearAllMocks();
});

describe('migrateBinanceCredentialToPerAccount', () => {
  it('moves the global credentials to the per-account service and removes the global item', async () => {
    await seedGlobalCredentials(CREDENTIALS);

    await migrateBinanceCredentialToPerAccount(CONNECTED_ID);

    expect(await Keychain.getGenericPassword({ service: serviceFor(CONNECTED_ID) })).toMatchObject({
      password: CREDENTIALS,
    });
    expect(await Keychain.getGenericPassword({ service: BINANCE_CREDENTIALS_SERVICE })).toBe(false);
  });

  it('keeps the per-account item ISOLATED to its own account id', async () => {
    await seedGlobalCredentials(CREDENTIALS);

    await migrateBinanceCredentialToPerAccount(CONNECTED_ID);

    // Another account's per-account slot is never written by this account's migration.
    expect(await Keychain.getGenericPassword({ service: serviceFor('acc-other') })).toBe(false);
  });

  it('writes the per-account item with the HARDENED options verbatim (only the service differs)', async () => {
    await seedGlobalCredentials(CREDENTIALS);

    await migrateBinanceCredentialToPerAccount(CONNECTED_ID);

    expect(Keychain.setGenericPassword).toHaveBeenCalledWith('binance', CREDENTIALS, {
      service: serviceFor(CONNECTED_ID),
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
    const [, , options] = (Keychain.setGenericPassword as jest.Mock).mock.calls.at(-1) ?? [];
    expect(options).not.toHaveProperty('accessControl');
  });

  it('reads the per-account item back BEFORE deleting the global item (verified-then-delete)', async () => {
    await seedGlobalCredentials(CREDENTIALS);

    await migrateBinanceCredentialToPerAccount(CONNECTED_ID);

    const getMock = Keychain.getGenericPassword as jest.Mock;
    const resetMock = Keychain.resetGenericPassword as jest.Mock;
    const globalDeleteIndex = resetMock.mock.calls.findIndex(
      ([options]) => options?.service === BINANCE_CREDENTIALS_SERVICE,
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
    await seedGlobalCredentials(CREDENTIALS);

    await migrateBinanceCredentialToPerAccount(CONNECTED_ID);
    jest.clearAllMocks();
    await migrateBinanceCredentialToPerAccount(CONNECTED_ID);

    // Nothing to move — no write, no delete.
    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
    expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
    expect(await Keychain.getGenericPassword({ service: serviceFor(CONNECTED_ID) })).toMatchObject({
      password: CREDENTIALS,
    });
  });

  it('converges when a stale global item lingers alongside an existing per-account item', async () => {
    // Per-account already written, but a prior run crashed before deleting the
    // global item. This run clears the leftover global item WITHOUT rewriting.
    await Keychain.setGenericPassword('binance', CREDENTIALS, {
      service: serviceFor(CONNECTED_ID),
    });
    await seedGlobalCredentials(CREDENTIALS);
    jest.clearAllMocks();

    await migrateBinanceCredentialToPerAccount(CONNECTED_ID);

    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
    expect(await Keychain.getGenericPassword({ service: BINANCE_CREDENTIALS_SERVICE })).toBe(false);
    expect(await Keychain.getGenericPassword({ service: serviceFor(CONNECTED_ID) })).toMatchObject({
      password: CREDENTIALS,
    });
  });

  it('gates on the global item PRESENCE: no global item is a no-op (never key-absence)', async () => {
    // No global item; no per-account item either — nothing to do, nothing written.
    await migrateBinanceCredentialToPerAccount(CONNECTED_ID);

    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
    expect(await Keychain.getGenericPassword({ service: serviceFor(CONNECTED_ID) })).toBe(false);
  });

  it('leaves the global item untouched when there is no connected account to bind it to', async () => {
    await seedGlobalCredentials(CREDENTIALS);

    await migrateBinanceCredentialToPerAccount(undefined);

    // Cannot bind credentials to no account — the global item stays for a later
    // connect to adopt, or manual re-entry.
    expect(
      await Keychain.getGenericPassword({ service: BINANCE_CREDENTIALS_SERVICE }),
    ).toMatchObject({ password: CREDENTIALS });
  });

  it('never strands the credentials: a failed global delete leaves a recoverable state that a re-run converges', async () => {
    await seedGlobalCredentials(CREDENTIALS);
    mockFailNextGlobalReset = true;

    // First run: the per-account write + read-back succeed, but the FINAL global
    // delete fails. The credentials are already durable in the per-account item,
    // so they are never lost; the failure surfaces.
    await expect(migrateBinanceCredentialToPerAccount(CONNECTED_ID)).rejects.toThrow(
      'keychain reset boom',
    );
    expect(await Keychain.getGenericPassword({ service: serviceFor(CONNECTED_ID) })).toMatchObject({
      password: CREDENTIALS,
    });
    // The global item is still present (delete failed) — a recoverable state.
    expect(
      await Keychain.getGenericPassword({ service: BINANCE_CREDENTIALS_SERVICE }),
    ).toMatchObject({ password: CREDENTIALS });

    // Second run converges: per-account present, so the leftover global item is cleared.
    await migrateBinanceCredentialToPerAccount(CONNECTED_ID);
    expect(await Keychain.getGenericPassword({ service: BINANCE_CREDENTIALS_SERVICE })).toBe(false);
    expect(await Keychain.getGenericPassword({ service: serviceFor(CONNECTED_ID) })).toMatchObject({
      password: CREDENTIALS,
    });
  });
});
