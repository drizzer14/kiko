// `holdings.repo.test.ts` doubles `write`'s op-sqlite transaction with a fake
// handle whose `select`/`innerJoin` never enforce real SQLite JOIN semantics —
// it could not have caught a blind write past a disconnected account. This
// file instead applies the REAL, shipped migration SQL (`applyAllMigrations`)
// to an in-process `node:sqlite` engine, and mocks `@kiko/db/client`'s `write`
// to route the repo's OWN `write(...)` calls through `executingDrizzle`
// against it — proving `setBinanceWalkCursor`'s account-institution gate
// (a walk holds the account's credentials for its whole run, so a
// disconnect can commit while it is still in flight) against a real join.
let mockWorkDatabase: unknown;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');

  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockWorkDatabase),
  };
});

import {
  binanceWalkCursorFields,
  binanceWalkPendingFields,
  binanceWalkPointCursorFields,
  binanceWalkRangeCursorFields,
  binanceWalkSpanHintFields,
  type BinanceWalkNumberField,
  type BinanceWalkSpanHintField,
} from '@kiko/holdings/holding-metadata';
import type { database } from '@kiko/db';
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations, executingDrizzle } from '@kiko/test-support/real-sqlite';

import { holdingsRepo } from './holdings.repo';

const openTestDatabase = (institution: string | null): DatabaseSync => {
  const rawDatabase = new DatabaseSync(':memory:');

  applyAllMigrations(rawDatabase);
  rawDatabase.exec('PRAGMA foreign_keys = ON;');
  rawDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution) VALUES ('acc-1', 'Binance', 'crypto', ?)",
    )
    .run(institution);
  rawDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
       VALUES ('h-spot', 'acc-1', 'Binance Spot', 'crypto_asset', 'BTC', 100, ?)`,
    )
    .run(JSON.stringify({ binanceAsset: 'BTC', binanceHistoryCursor: 500, syncedAt: 500 }));

  return rawDatabase;
};

const storedMetadata = (rawDatabase: DatabaseSync): unknown =>
  JSON.parse(
    (
      rawDatabase.prepare("SELECT metadata FROM holdings WHERE id = 'h-spot'").get() as {
        metadata: string;
      }
    ).metadata,
  );

describe("holdingsRepo.setBinanceWalkCursor — gated on the holding's account still being connected to Binance", () => {
  it('is a no-op on a disconnected account: the cursor stays exactly as stored', async () => {
    const rawDatabase = openTestDatabase(null);
    mockWorkDatabase = executingDrizzle<typeof database>(rawDatabase);

    await holdingsRepo.setBinanceWalkCursor('h-spot', 'binanceHistoryCursor', 999_999);

    expect(storedMetadata(rawDatabase)).toEqual({
      binanceAsset: 'BTC',
      binanceHistoryCursor: 500,
      syncedAt: 500,
    });
  });

  it.each(binanceWalkCursorFields)(
    'still writes %s when the account is connected to Binance, keeping every other key',
    async (field) => {
      const rawDatabase = openTestDatabase('binance');
      mockWorkDatabase = executingDrizzle<typeof database>(rawDatabase);

      await holdingsRepo.setBinanceWalkCursor('h-spot', field, 999_999);

      expect(storedMetadata(rawDatabase)).toEqual({
        binanceAsset: 'BTC',
        binanceHistoryCursor: 500,
        syncedAt: 500,
        [field]: 999_999,
      });
    },
  );

  it('keeps the other walks cursors when one walk advances its own', async () => {
    const rawDatabase = openTestDatabase('binance');
    mockWorkDatabase = executingDrizzle<typeof database>(rawDatabase);

    await holdingsRepo.setBinanceWalkCursor('h-spot', 'binancePayHistoryCursor', 700);
    await holdingsRepo.setBinanceWalkCursor('h-spot', 'binanceEarnHistoryCursor', 800);

    expect(storedMetadata(rawDatabase)).toEqual({
      binanceAsset: 'BTC',
      binanceHistoryCursor: 500,
      binancePayHistoryCursor: 700,
      binanceEarnHistoryCursor: 800,
      syncedAt: 500,
    });
  });

  it("a disconnect's floor write is not undone by a walk's late-arriving window commit", async () => {
    const rawDatabase = openTestDatabase('binance');
    mockWorkDatabase = executingDrizzle<typeof database>(rawDatabase);

    // The disconnect itself, in its own real order: reset the cursor to the
    // floor FIRST, then clear the institution — see `disconnectCryptoAccount`.
    await holdingsRepo.resetBinanceWalkCursors('acc-1', 1);
    rawDatabase.prepare("UPDATE accounts SET institution = NULL WHERE id = 'acc-1'").run();

    // A window commit from a walk that started BEFORE the disconnect, whose
    // write only reaches the DB after the disconnect already cleared the
    // institution — it must not resurrect a forward watermark over the floor.
    await holdingsRepo.setBinanceWalkCursor('h-spot', 'binanceHistoryCursor', 999_999);

    expect(storedMetadata(rawDatabase)).toEqual({
      binanceAsset: 'BTC',
      binanceHistoryCursor: 1,
      syncedAt: 500,
    });
  });

  it('a disconnect resets every walk cursor the Spot holding carries to the floor', async () => {
    const rawDatabase = openTestDatabase('binance');
    mockWorkDatabase = executingDrizzle<typeof database>(rawDatabase);

    for (const field of binanceWalkCursorFields) {
      await holdingsRepo.setBinanceWalkCursor('h-spot', field, 999_999);
    }
    await holdingsRepo.resetBinanceWalkCursors('acc-1', 1);

    expect(storedMetadata(rawDatabase)).toEqual({
      binanceAsset: 'BTC',
      binanceHistoryCursor: 1,
      binanceHistoryRescanCursor: 1,
      binancePayHistoryCursor: 1,
      binancePayRescanCursor: 1,
      binanceTransferHistoryCursor: 1,
      binanceTransferRescanCursor: 1,
      binanceEarnHistoryCursor: 1,
      binanceEarnRescanCursor: 1,
      syncedAt: 500,
    });
  });
});

const SPAN_HINTS = {
  forward: [{ start: 100, end: 150 }],
  pending: [],
  rescan: [{ start: 200, end: 210 }],
  point: [],
};

const DROPPED_ON_DISCONNECT = [
  {
    name: 'the point cursors',
    fields: binanceWalkPointCursorFields,
    stored: 4_242,
    write: (field: string) =>
      holdingsRepo.setBinanceWalkCursor('h-spot', field as BinanceWalkNumberField, 4_242),
  },
  {
    name: 'the range cursors',
    fields: binanceWalkRangeCursorFields,
    stored: 4_242,
    write: (field: string) =>
      holdingsRepo.setBinanceWalkCursor('h-spot', field as BinanceWalkNumberField, 4_242),
  },
  {
    name: 'the span hints',
    fields: binanceWalkSpanHintFields,
    stored: SPAN_HINTS,
    write: (field: string) =>
      holdingsRepo.setBinanceWalkSpanHints('h-spot', field as BinanceWalkSpanHintField, SPAN_HINTS),
  },
];

describe.each(DROPPED_ON_DISCONNECT)(
  "the walk-owned writes of $name — gated on the holding's account, dropped by a disconnect",
  ({ fields, stored, write }) => {
    it.each(fields)(
      'writes %s when the account is connected, and a disconnect drops it',
      async (field) => {
        const rawDatabase = openTestDatabase('binance');
        mockWorkDatabase = executingDrizzle<typeof database>(rawDatabase);

        await write(field);

        expect(storedMetadata(rawDatabase)).toMatchObject({ [field]: stored, syncedAt: 500 });

        await holdingsRepo.resetBinanceWalkCursors('acc-1', 1);

        expect(storedMetadata(rawDatabase)).toEqual({
          binanceAsset: 'BTC',
          binanceHistoryCursor: 1,
          syncedAt: 500,
        });
      },
    );

    it('is a no-op on a disconnected account', async () => {
      const rawDatabase = openTestDatabase(null);
      mockWorkDatabase = executingDrizzle<typeof database>(rawDatabase);

      await write(fields[0]);

      expect(storedMetadata(rawDatabase)).toEqual({
        binanceAsset: 'BTC',
        binanceHistoryCursor: 500,
        syncedAt: 500,
      });
    });
  },
);

describe("holdingsRepo.setBinanceWalkPending — gated on the holding's account still being connected to Binance", () => {
  const ranges = [{ start: 100, end: 200 }];

  it.each(binanceWalkPendingFields)(
    'writes %s when the account is connected to Binance, keeping every other key',
    async (field) => {
      const rawDatabase = openTestDatabase('binance');
      mockWorkDatabase = executingDrizzle<typeof database>(rawDatabase);

      await holdingsRepo.setBinanceWalkPending('h-spot', field, ranges);

      expect(storedMetadata(rawDatabase)).toEqual({
        binanceAsset: 'BTC',
        binanceHistoryCursor: 500,
        syncedAt: 500,
        [field]: ranges,
      });
    },
  );

  it('is a no-op on a disconnected account', async () => {
    const rawDatabase = openTestDatabase(null);
    mockWorkDatabase = executingDrizzle<typeof database>(rawDatabase);

    await holdingsRepo.setBinanceWalkPending('h-spot', 'binancePayPendingOverlap', ranges);

    expect(storedMetadata(rawDatabase)).toEqual({
      binanceAsset: 'BTC',
      binanceHistoryCursor: 500,
      syncedAt: 500,
    });
  });

  it('a disconnect resets every list the Spot holding carries to an empty list', async () => {
    const rawDatabase = openTestDatabase('binance');
    mockWorkDatabase = executingDrizzle<typeof database>(rawDatabase);

    for (const field of binanceWalkPendingFields) {
      await holdingsRepo.setBinanceWalkPending('h-spot', field, ranges);
    }
    await holdingsRepo.resetBinanceWalkCursors('acc-1', 1);

    expect(storedMetadata(rawDatabase)).toEqual({
      binanceAsset: 'BTC',
      binanceHistoryCursor: 1,
      binanceHistoryPendingOverlap: [],
      binancePayPendingOverlap: [],
      binanceTransferPendingOverlap: [],
      binanceEarnPendingOverlap: [],
      syncedAt: 500,
    });
  });

  it('stores the series of a typed point on a Transfer list, and a disconnect empties it', async () => {
    const rawDatabase = openTestDatabase('binance');
    mockWorkDatabase = executingDrizzle<typeof database>(rawDatabase);
    const typed = { start: 5, end: 7, kind: 'point' as const, series: 'MAIN_FUNDING' };

    await holdingsRepo.setBinanceWalkPending('h-spot', 'binanceTransferPendingOverlap', [typed]);

    expect(storedMetadata(rawDatabase)).toMatchObject({ binanceTransferPendingOverlap: [typed] });

    await holdingsRepo.resetBinanceWalkCursors('acc-1', 1);

    expect(storedMetadata(rawDatabase)).toMatchObject({ binanceTransferPendingOverlap: [] });
  });

  it("a disconnect's reset is not undone by a walk's late-arriving write", async () => {
    const rawDatabase = openTestDatabase('binance');
    mockWorkDatabase = executingDrizzle<typeof database>(rawDatabase);
    await holdingsRepo.setBinanceWalkPending('h-spot', 'binancePayPendingOverlap', ranges);

    await holdingsRepo.resetBinanceWalkCursors('acc-1', 1);
    rawDatabase.prepare("UPDATE accounts SET institution = NULL WHERE id = 'acc-1'").run();
    await holdingsRepo.setBinanceWalkPending('h-spot', 'binancePayPendingOverlap', ranges);

    expect(storedMetadata(rawDatabase)).toEqual({
      binanceAsset: 'BTC',
      binanceHistoryCursor: 1,
      binancePayPendingOverlap: [],
      syncedAt: 500,
    });
  });
});
