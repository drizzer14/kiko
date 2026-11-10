// A Binance holding takes the dated read of a Bybit one: the read writes its time and the list of
// the rows it overwrote, the line holds the last read, and a delete or an edit of a row on the list
// moves no balance. This file builds the holding the way a device does: a real `runBalanceSync`
// over fake reads writes the balance, rows come in through `addManyDedup` as a history walk would
// write them, and the line is the one `buildNetWorthSeries` draws from what the database holds.
// A holding that shipped before the read was dated is seeded by raw SQL, one seed per case.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () =>
  require('@kiko/test-support/real-sqlite').databaseClientOver(() => mockDatabase),
);
jest.mock(
  'react-native-keychain',
  () => require('@kiko/test-support/past-line-world').keychainModule,
);
jest.mock('./binance.credentials', () => ({
  ...jest.requireActual('./binance.credentials'),
  clearCredentials: async () => undefined,
}));

import type { DatabaseSync } from 'node:sqlite';
import { runBalanceSync } from '@kiko/crypto-sync/sync';
import { transactionsRepo } from '@kiko/transactions/repo';
import { disconnectCryptoAccount } from '@kiko/crypto-sync/disconnect';
import { at, openPastLineDatabase, pastLineWorld } from '@kiko/test-support/past-line-world';

import { setBinanceCooldownUntil } from './binance.cooldown';
import { type BinanceDeps, binanceProvider } from './binance.provider';
import type { BinanceBalance, BinanceFundingAsset } from './binance.client';

const ACCOUNT_ID = 'acc-1';
const ONE_COIN = 100_000_000;
const TENTH_OF_A_COIN = 10_000_000;
const HALF_OF_A_COIN = 50_000_000;
const SIX_TENTHS_OF_A_COIN = 60_000_000;
const FIFTH_OF_A_COIN = 20_000_000;
const FIVE_COINS = 500_000_000;
const EIGHT_COINS = 800_000_000;

const {
  storedHolding,
  typedRowAt,
  deletedRowChanges,
  lineFrom,
  expectLineAtTheTenthRead,
  expectMarkedRowDeleteMovesNothing,
  expectMarkedRowEditMovesNothing,
  expectLaterRowOnTheMark,
} = pastLineWorld(() => mockDatabase, ACCOUNT_ID);

const spotOf = (free: string): BinanceBalance[] => [{ asset: 'BTC', free, locked: '0' }];

const fundingOf = (free: string): BinanceFundingAsset[] => [
  { asset: 'BTC', free, locked: '0', freeze: '0', withdrawing: '0' },
];

type Reads = { spot: BinanceBalance[]; funding?: BinanceFundingAsset[] };

// The Funding read of a run that gives none fails, as a missing key permission or a throttle does.
const depsAt = (time: number, { spot, funding }: Reads): BinanceDeps => ({
  fetchImpl: (async () => ({ ok: true })) as unknown as typeof fetch,
  now: () => time,
  readCredentials: async () => ({ apiKey: 'api-key-fixture', secret: 'secret-fixture' }),
  fetchAccount: async () => ({ balances: spot, uid: null }),
  fetchFundingAsset: async () => {
    if (funding === undefined) {
      throw new Error('Binance request failed: 403');
    }

    return funding;
  },
  fetchFlexiblePosition: async () => ({ rows: [], total: 0 }),
  fetchLockedPosition: async () => ({ rows: [], total: 0 }),
});

const readAt = (
  time: number,
  reads: Reads,
  accountId = ACCOUNT_ID,
): ReturnType<typeof runBalanceSync> =>
  runBalanceSync(binanceProvider, depsAt(time, reads), {
    targetAccountId: accountId,
    now: () => time,
  });

// A row as a history walk would write it: a Binance row that never moves the balance.
const walkRowAt = async (time: number, amountMinorUnits: number): Promise<void> => {
  const { id } = await storedHolding();

  await transactionsRepo.addManyDedup([
    {
      holdingId: id,
      amountMinorUnits,
      time,
      source: 'binance',
      externalId: `${ACCOUNT_ID}:fill:${time}`,
    },
  ]);
};

const fillAt = (time: number): Promise<void> => walkRowAt(time, -FIFTH_OF_A_COIN);

// A holding as the release before the dated read stored it: a key, the time of its last sync and
// no read time, with the rows it holds.
const seedShippedHolding = (
  balanceMinorUnits: number,
  syncedAt: number,
  rows: { amountMinorUnits: number; time: number }[],
): void => {
  mockDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
       VALUES ('shipped', ?, 'Binance Spot · BTC', 'crypto_asset', 'BTC', ?, ?)`,
    )
    .run(ACCOUNT_ID, balanceMinorUnits, JSON.stringify({ binanceAsset: 'BTC', syncedAt }));

  rows.forEach(({ amountMinorUnits, time }) => {
    mockDatabase
      .prepare(
        `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id)
         VALUES (?, 'shipped', ?, ?, 'binance', ?)`,
      )
      .run(`row-${time}`, amountMinorUnits, time, `${ACCOUNT_ID}:fill:${time}`);
  });
};

beforeEach(() => {
  mockDatabase = openPastLineDatabase(ACCOUNT_ID, 'Binance');
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the line of a Binance holding whose balance is older than its rows, on real SQLite', () => {
  it('W1, a fill that the walk of the read run wrote after it leaves the line at the read balance', async () => {
    await readAt(at(0, 10), { spot: spotOf('1') });
    await fillAt(at(1, 9));

    expect(await lineFrom(-1, 3)).toEqual([1, 1, 1, 1, 1]);
    expect((await storedHolding()).metadata).toEqual({
      binanceAsset: 'BTC',
      syncedAt: at(0, 10),
      balanceReadAt: at(0, 10),
      defaultNameRenameSettled: true,
    });
  });

  it('W2, the next read holds the fill and the line counts it from its own day', async () => {
    await readAt(at(0, 10), { spot: spotOf('1') });
    await fillAt(at(1, 9));
    await readAt(at(2, 10), { spot: spotOf('0.8') });

    expect(await lineFrom(-1, 3)).toEqual([1, 1, 0.8, 0.8, 0.8]);
  });

  it('W3, a Funding read that fails leaves its holding dated at the read before, and the next good read counts the deposit', async () => {
    await readAt(at(0, 10), { spot: [], funding: fundingOf('5') });
    await walkRowAt(at(1, 9), 3 * ONE_COIN);
    await readAt(at(2, 10), { spot: [] });

    const holding = await storedHolding();

    expect(await lineFrom(0, 2)).toEqual([5, 5, 5]);
    expect(holding.balanceMinorUnits).toBe(FIVE_COINS);
    expect(holding.metadata).toEqual({
      binanceAsset: 'BTC:funding',
      syncedAt: at(0, 10),
      balanceReadAt: at(0, 10),
      defaultNameRenameSettled: true,
    });

    await readAt(at(3, 10), { spot: [], funding: fundingOf('8') });

    expect((await storedHolding()).balanceMinorUnits).toBe(EIGHT_COINS);
    expect(await lineFrom(0, 3)).toEqual([5, 8, 8, 8]);
  });

  it('W10, a run that the cooldown skips writes nothing, so the read time and the mark stay', async () => {
    const coolingAccount = 'acc-cooling';

    mockDatabase
      .prepare("INSERT INTO accounts (id, name, kind) VALUES (?, 'Binance', 'crypto')")
      .run(coolingAccount);
    await readAt(at(0, 10), { spot: spotOf('1') }, coolingAccount);

    const before = await storedHolding(coolingAccount);

    expect(before.metadata).toMatchObject({ balanceReadAt: at(0, 10) });

    setBinanceCooldownUntil(coolingAccount, at(5, 0));
    await readAt(at(1, 10), { spot: spotOf('0.8') }, coolingAccount);

    expect(await storedHolding(coolingAccount)).toEqual(before);
  });
});

describe('the line of a Binance holding that shipped with no read time, on real SQLite', () => {
  it('R2, the first read after the update dates the holding and keeps its line', async () => {
    seedShippedHolding(ONE_COIN, at(-5, 10), [{ amountMinorUnits: ONE_COIN, time: at(0, 9) }]);

    expect(await lineFrom(-1, 1)).toEqual([0, 1, 1]);

    await readAt(at(0, 10), { spot: spotOf('1') });

    expect((await storedHolding()).metadata).toEqual({
      binanceAsset: 'BTC',
      syncedAt: at(0, 10),
      balanceReadAt: at(0, 10),
      defaultNameRenameSettled: true,
    });
    expect(await lineFrom(-1, 1)).toEqual([0, 1, 1]);
  });

  it('R4, a fill after its last read keeps the old line until the next read, then holds it and counts it at the one after', async () => {
    seedShippedHolding(ONE_COIN, at(0, 10), [
      { amountMinorUnits: -FIFTH_OF_A_COIN, time: at(1, 9) },
    ]);

    expect(await lineFrom(0, 2)).toEqual([1.2, 1, 1]);

    await readAt(at(1, 8), { spot: spotOf('1') });

    expect(await lineFrom(0, 2)).toEqual([1, 1, 1]);

    await readAt(at(2, 10), { spot: spotOf('0.8') });

    expect(await lineFrom(0, 2)).toEqual([1, 0.8, 0.8]);
  });
});

describe('the line of a Binance holding that shipped with a row the user typed, on real SQLite', () => {
  // The holding at 0.6 as the release before the dated read stored it, with a +0.5 the user typed
  // long before, which that balance holds. Seeded per pin, since each pin names its own world.
  const seedShippedHoldingWithTypedRow = (): void => {
    mockDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
         VALUES ('shipped', ?, 'Binance Spot · BTC', 'crypto_asset', 'BTC', ?, ?)`,
      )
      .run(
        ACCOUNT_ID,
        SIX_TENTHS_OF_A_COIN,
        JSON.stringify({ binanceAsset: 'BTC', syncedAt: at(-5, 10) }),
      );
    mockDatabase
      .prepare(
        `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source)
         VALUES ('typed-row', 'shipped', ?, ?, 'manual')`,
      )
      .run(HALF_OF_A_COIN, at(1, 9));
  };

  it('the first dated read writes the date and no mark, and the old typed row keeps counting', async () => {
    seedShippedHoldingWithTypedRow();

    expect(await lineFrom(-1, 3)).toEqual([0.1, 0.1, 0.6, 0.6, 0.6]);

    await readAt(at(2, 10), { spot: spotOf('0.6') });

    expect((await storedHolding()).metadata).toEqual({
      binanceAsset: 'BTC',
      syncedAt: at(2, 10),
      balanceReadAt: at(2, 10),
      defaultNameRenameSettled: true,
      keptRowIds: ['typed-row'],
    });
    expect(await lineFrom(-1, 3)).toEqual([0.1, 0.1, 0.6, 0.6, 0.6]);
  });

  it('a delete of the old typed row after the first dated read moves the balance as today', async () => {
    seedShippedHoldingWithTypedRow();
    await readAt(at(2, 10), { spot: spotOf('0.6') });

    expect(await deletedRowChanges('typed-row')).toBeDefined();
    expect((await storedHolding()).balanceMinorUnits).toBe(TENTH_OF_A_COIN);
  });

  it('a row typed after the first dated read is on the mark of the next read', async () => {
    seedShippedHoldingWithTypedRow();
    await readAt(at(2, 10), { spot: spotOf('0.6') });
    await disconnectCryptoAccount(ACCOUNT_ID, 'binance');

    const laterRowId = await typedRowAt(at(3, 9), FIFTH_OF_A_COIN);

    await readAt(at(4, 10), { spot: spotOf('0.6') });
    await expectLaterRowOnTheMark(laterRowId);
  });

  it('the old typed row stays off the mark at the second and the third dated read, with a disconnect between them, and keeps counting', async () => {
    seedShippedHoldingWithTypedRow();

    const dayOfRead = [2, 3, 4];

    for (const day of dayOfRead) {
      await readAt(at(day, 10), { spot: spotOf('0.6') });

      expect((await storedHolding()).metadata).toEqual({
        binanceAsset: 'BTC',
        syncedAt: at(day, 10),
        balanceReadAt: at(day, 10),
        defaultNameRenameSettled: true,
        keptRowIds: ['typed-row'],
      });
      expect(await lineFrom(-1, 3)).toEqual([0.1, 0.1, 0.6, 0.6, 0.6]);

      await disconnectCryptoAccount(ACCOUNT_ID, 'binance');
    }
  });

  it('a delete of the old typed row after the third dated read moves the balance as today', async () => {
    seedShippedHoldingWithTypedRow();
    await readAt(at(2, 10), { spot: spotOf('0.6') });
    await disconnectCryptoAccount(ACCOUNT_ID, 'binance');
    await readAt(at(3, 10), { spot: spotOf('0.6') });
    await disconnectCryptoAccount(ACCOUNT_ID, 'binance');
    await readAt(at(4, 10), { spot: spotOf('0.6') });

    expect(await deletedRowChanges('typed-row')).toBeDefined();
    expect((await storedHolding()).balanceMinorUnits).toBe(TENTH_OF_A_COIN);
  });

  it('a deleted old row leaves the kept list at the next dated read', async () => {
    seedShippedHoldingWithTypedRow();
    await readAt(at(2, 10), { spot: spotOf('0.6') });
    await transactionsRepo.remove('typed-row');
    await readAt(at(3, 10), { spot: spotOf('0.1') });

    expect((await storedHolding()).metadata).toEqual({
      binanceAsset: 'BTC',
      syncedAt: at(3, 10),
      balanceReadAt: at(3, 10),
      defaultNameRenameSettled: true,
    });
  });
});

describe('the line of a Binance holding whose read overwrote rows the user typed, on real SQLite', () => {
  // Read 0.1, disconnect, type +0.5 (the balance moves to 0.6), reconnect, read 0.1 again.
  const typedRowThenReadOfATenth = async (): Promise<string> => {
    await readAt(at(0, 10), { spot: spotOf('0.1') });
    await disconnectCryptoAccount(ACCOUNT_ID, 'binance');

    const typedRowId = await typedRowAt(at(1, 9), HALF_OF_A_COIN);

    await readAt(at(2, 10), { spot: spotOf('0.1') });

    return typedRowId;
  };

  it('W4, a row the read overwrote is left off the line, and Home shows the read', async () => {
    const typedRowId = await typedRowThenReadOfATenth();
    const holding = await storedHolding();

    await expectLineAtTheTenthRead(holding);
    expect(holding.metadata).toEqual({
      binanceAsset: 'BTC',
      syncedAt: at(2, 10),
      balanceReadAt: at(2, 10),
      defaultNameRenameSettled: true,
      overwrittenRowIds: [typedRowId],
    });
  });

  it('W5, deleting a row on the mark moves no balance and the confirm names no change', async () => {
    await expectMarkedRowDeleteMovesNothing(await typedRowThenReadOfATenth());
  });

  it('W6, editing a row on the mark moves no balance and keeps its id', async () => {
    await expectMarkedRowEditMovesNothing(await typedRowThenReadOfATenth());
  });
});
