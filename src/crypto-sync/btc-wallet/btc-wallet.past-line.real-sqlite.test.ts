// A Bitcoin wallet takes the dated read of a Bybit holding: the read writes its time and the list
// of the rows it overwrote, and a delete or an edit of a row on the list moves no balance. The
// wallet writes no ledger row of its own (`btc_wallet` is never a row's source), so only the list
// changes a value. This file builds the holding the way a device does: a real `runBalanceSync`
// over a fake explorer, rows typed through the repo, and the line `buildNetWorthSeries` draws from
// what the database holds.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () =>
  require('@kiko/test-support/real-sqlite').databaseClientOver(() => mockDatabase),
);
jest.mock(
  'react-native-keychain',
  () => require('@kiko/test-support/keychain-module').keychainModule,
);

import type { DatabaseSync } from 'node:sqlite';
import { runBalanceSync } from '@kiko/crypto-sync/sync';
import { transactionsRepo } from '@kiko/transactions/repo';
import { disconnectCryptoAccount } from '@kiko/crypto-sync/disconnect';
import { at, openPastLineDatabase, pastLineWorld } from '@kiko/test-support/past-line-world';

import { bitcoinWalletProvider } from './btc-wallet.provider';

const ACCOUNT_ID = 'acc-wallet';
const ADDRESS = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const ONE_COIN = 100_000_000;
const TENTH_OF_A_COIN = 10_000_000;
const HALF_OF_A_COIN = 50_000_000;
const SIX_TENTHS_OF_A_COIN = 60_000_000;

const {
  storedHolding,
  typedRowAt,
  deletedRowChanges,
  lineFrom,
  expectLineAtTheRead,
  expectMarkedRowDeleteMovesNothing,
  expectMarkedRowEditMovesNothing,
  expectLaterRowOnTheMark,
} = pastLineWorld(() => mockDatabase, ACCOUNT_ID);

const readAt = (time: number, balanceMinorUnits: number): ReturnType<typeof runBalanceSync> =>
  runBalanceSync(
    bitcoinWalletProvider,
    { fetchImpl: fetch, fetchAddressBalance: async () => balanceMinorUnits, address: ADDRESS },
    { targetAccountId: ACCOUNT_ID, now: () => time },
  );

beforeEach(() => {
  mockDatabase = openPastLineDatabase(ACCOUNT_ID, 'Wallet');
});

describe('the line of a Bitcoin wallet whose read overwrote rows the user typed, on real SQLite', () => {
  // Read 0.1, disconnect, type +0.5 (the balance moves to 0.6), reconnect, read 0.1 again.
  const readOfATenth = { line: [0.1, 0.1, 0.1, 0.1, 0.1], balanceMinorUnits: TENTH_OF_A_COIN };
  const typedRowThenReadOfATenth = async (): Promise<string> => {
    await readAt(at(0, 10), TENTH_OF_A_COIN);
    await disconnectCryptoAccount(ACCOUNT_ID, 'btc_wallet');

    const typedRowId = await typedRowAt(at(1, 9), HALF_OF_A_COIN);

    await readAt(at(2, 10), TENTH_OF_A_COIN);

    return typedRowId;
  };

  it('W8, a row the read overwrote is left off the line, and Home shows the read', async () => {
    const typedRowId = await typedRowThenReadOfATenth();
    const holding = await storedHolding();

    await expectLineAtTheRead(holding, readOfATenth);
    expect(holding.metadata).toEqual({
      walletAddress: ADDRESS,
      syncedAt: at(2, 10),
      balanceReadAt: at(2, 10),
      overwrittenRowIds: [typedRowId],
    });
  });

  it('W8, deleting a row on the mark moves no balance and the confirm names no change', async () => {
    await expectMarkedRowDeleteMovesNothing(await typedRowThenReadOfATenth(), readOfATenth);
  });

  it('W8, editing a row on the mark moves no balance and keeps its id', async () => {
    await expectMarkedRowEditMovesNothing(await typedRowThenReadOfATenth(), readOfATenth);
  });
});

describe('the line of a Bitcoin wallet that shipped with a row the user typed, on real SQLite', () => {
  // Shipped, disconnected, a +0.5 typed (the balance 0.6), then reconnected. Seeded per pin, since
  // each pin names its own world.
  const seedShippedWalletWithTypedRow = (): void => {
    mockDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
         VALUES ('shipped', ?, 'BTC Wallet', 'crypto_asset', 'BTC', ?, ?)`,
      )
      .run(ACCOUNT_ID, SIX_TENTHS_OF_A_COIN, JSON.stringify({ walletAddress: ADDRESS }));
    mockDatabase
      .prepare(
        `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source)
         VALUES ('typed-row', 'shipped', ?, ?, 'manual')`,
      )
      .run(HALF_OF_A_COIN, at(1, 9));
  };

  it('the first dated read writes the date and no mark, and the old typed row keeps counting', async () => {
    seedShippedWalletWithTypedRow();

    expect(await lineFrom(-1, 3)).toEqual([0.1, 0.1, 0.6, 0.6, 0.6]);

    await readAt(at(2, 10), SIX_TENTHS_OF_A_COIN);

    expect((await storedHolding()).metadata).toEqual({
      walletAddress: ADDRESS,
      syncedAt: at(2, 10),
      balanceReadAt: at(2, 10),
      keptRowIds: ['typed-row'],
    });
    expect(await lineFrom(-1, 3)).toEqual([0.1, 0.1, 0.6, 0.6, 0.6]);
  });

  it('a delete of the old typed row after the first dated read moves the balance as today', async () => {
    seedShippedWalletWithTypedRow();
    await readAt(at(2, 10), SIX_TENTHS_OF_A_COIN);

    expect(await deletedRowChanges('typed-row')).toBeDefined();
    expect((await storedHolding()).balanceMinorUnits).toBe(TENTH_OF_A_COIN);
  });

  it('a row typed after the first dated read is on the mark of the next read', async () => {
    seedShippedWalletWithTypedRow();
    await readAt(at(2, 10), SIX_TENTHS_OF_A_COIN);
    await disconnectCryptoAccount(ACCOUNT_ID, 'btc_wallet');

    const laterRowId = await typedRowAt(at(3, 9), HALF_OF_A_COIN);

    await readAt(at(4, 10), SIX_TENTHS_OF_A_COIN);
    await expectLaterRowOnTheMark(laterRowId, 'typed-row', SIX_TENTHS_OF_A_COIN);
  });

  it('the old typed row stays off the mark at the second and the third dated read, with a disconnect between them, and keeps counting', async () => {
    seedShippedWalletWithTypedRow();

    const dayOfRead = [2, 3, 4];

    for (const day of dayOfRead) {
      await readAt(at(day, 10), SIX_TENTHS_OF_A_COIN);

      expect((await storedHolding()).metadata).toEqual({
        walletAddress: ADDRESS,
        syncedAt: at(day, 10),
        balanceReadAt: at(day, 10),
        keptRowIds: ['typed-row'],
      });
      expect(await lineFrom(-1, 3)).toEqual([0.1, 0.1, 0.6, 0.6, 0.6]);

      await disconnectCryptoAccount(ACCOUNT_ID, 'btc_wallet');
    }
  });

  it('a delete of the old typed row after the third dated read moves the balance as today', async () => {
    seedShippedWalletWithTypedRow();
    await readAt(at(2, 10), SIX_TENTHS_OF_A_COIN);
    await disconnectCryptoAccount(ACCOUNT_ID, 'btc_wallet');
    await readAt(at(3, 10), SIX_TENTHS_OF_A_COIN);
    await disconnectCryptoAccount(ACCOUNT_ID, 'btc_wallet');
    await readAt(at(4, 10), SIX_TENTHS_OF_A_COIN);

    expect(await deletedRowChanges('typed-row')).toBeDefined();
    expect((await storedHolding()).balanceMinorUnits).toBe(TENTH_OF_A_COIN);
  });

  it('a deleted old row leaves the kept list at the next dated read', async () => {
    seedShippedWalletWithTypedRow();
    await readAt(at(2, 10), SIX_TENTHS_OF_A_COIN);
    await transactionsRepo.remove('typed-row');
    await readAt(at(3, 10), TENTH_OF_A_COIN);

    expect((await storedHolding()).metadata).toEqual({
      walletAddress: ADDRESS,
      syncedAt: at(3, 10),
      balanceReadAt: at(3, 10),
    });
  });
});

describe('the line of a Bitcoin wallet that shipped and was disconnected, on real SQLite', () => {
  beforeEach(() => {
    mockDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
         VALUES ('shipped', ?, 'BTC Wallet', 'crypto_asset', 'BTC', ?, ?)`,
      )
      .run(ACCOUNT_ID, ONE_COIN, JSON.stringify({ walletAddress: ADDRESS }));
  });

  it('W9, a row typed after the disconnect moves the balance and the line as typed, with no read and no mark', async () => {
    const typedRowId = await typedRowAt(at(1, 9), HALF_OF_A_COIN);

    expect((await storedHolding()).balanceMinorUnits).toBe(ONE_COIN + HALF_OF_A_COIN);
    expect((await storedHolding()).metadata).toEqual({ walletAddress: ADDRESS });
    expect(await lineFrom(0, 2)).toEqual([1, 1.5, 1.5]);

    await transactionsRepo.remove(typedRowId);

    expect((await storedHolding()).balanceMinorUnits).toBe(ONE_COIN);
    expect(await lineFrom(0, 2)).toEqual([1, 1, 1]);
  });
});
