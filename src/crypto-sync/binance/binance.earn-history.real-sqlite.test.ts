// The unit tests in `binance.earn-history.test.ts` fake the repos. This file runs the Earn walk
// over the REAL repos on a real `node:sqlite` engine (the shipped migrations): the legs of a
// subscription land on their wallets with their markers, a reward group that grows on a re-read
// is two rows and not a duplicate, the `(source, external_id)` upsert dedupes a second run, and a
// reward group owed as a point imports once its type is known.
let mockDatabase: DatabaseSync;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import type {
  EarnRecordByKind,
  EarnRecordKind,
  TotalPage,
  TotalQuery,
} from './binance.history-client';
import {
  flexibleRewardOf,
  flexibleSubscriptionOf,
  lockedRewardOf,
} from './binance.earn-test-fixtures';
import { NOW } from './binance.pay-test-fixtures';
import { syncBinanceEarnHistory } from './binance.earn-history';
import { createBinanceHistoryRun } from './binance.history-budget';

const CURSOR = NOW - 5 * DAY_MS;
const REWARD_TIME = NOW - 2 * DAY_MS;

type StoredRow = {
  external_id: string;
  holding_id: string;
  amount_minor_units: number;
  exchange_counterpart_holding_id: string | null;
  exchange_pair_id: string | null;
  untracked_counterpart: string | null;
  description: string;
};

const openDatabase = (): DatabaseSync => {
  const rawDatabase = new DatabaseSync(':memory:');

  applyAllMigrations(rawDatabase);
  rawDatabase.exec('PRAGMA foreign_keys = ON;');

  for (const account of ['acc-1', 'acc-2']) {
    rawDatabase
      .prepare('INSERT INTO accounts (id, name, kind, institution) VALUES (?, ?, ?, ?)')
      .run(account, `Binance ${account}`, 'crypto', 'binance');
    rawDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
         VALUES (?, ?, 'Binance Spot', 'crypto_asset', 'BTC', 100, ?)`,
      )
      .run(
        `h-spot-${account}`,
        account,
        JSON.stringify({ binanceAsset: 'BTC', binanceEarnHistoryCursor: CURSOR }),
      );
  }

  return rawDatabase;
};

type Held = { kind: EarnRecordKind; time: number; row: EarnRecordByKind[EarnRecordKind] };

const heldOf = <Kind extends EarnRecordKind>(kind: Kind, row: EarnRecordByKind[Kind]): Held => ({
  kind,
  time: row.time,
  row,
});

/** Binance answering the given records, by kind and range (both ends included). */
const fetchOf =
  (held: Held[]) =>
  async (
    _apiKey: string,
    _secret: string,
    kind: EarnRecordKind,
    query: TotalQuery,
  ): Promise<TotalPage<EarnRecordByKind[EarnRecordKind]>> => {
    const rows = held
      .filter(
        (entry) =>
          entry.kind === kind && query.startTime <= entry.time && entry.time <= query.endTime,
      )
      .map((entry) => entry.row);

    return {
      rows,
      unreadable: [],
      gathered: rows.length,
      total: rows.length,
      usedUidWeight1m: undefined,
      usedIpWeight1m: undefined,
    };
  };

const runWalk = (accountId: string, held: Held[]) =>
  syncBinanceEarnHistory(
    {
      targetAccountId: accountId,
      run: createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined }),
    },
    {
      now: () => NOW,
      readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
      fetchEarnRecords: fetchOf(held) as never,
    },
  );

const storedRows = (): StoredRow[] =>
  mockDatabase
    .prepare(
      `SELECT external_id, holding_id, amount_minor_units, exchange_counterpart_holding_id,
              exchange_pair_id, untracked_counterpart, description
         FROM transactions ORDER BY external_id`,
    )
    .all() as StoredRow[];

const holdingByKey = (
  accountId: string,
  key: string,
): { id: string; balance_minor_units: number } | undefined =>
  mockDatabase
    .prepare(
      `SELECT id, balance_minor_units FROM holdings
        WHERE account_id = ? AND json_extract(metadata, '$.binanceAsset') = ?`,
    )
    .get(accountId, key) as { id: string; balance_minor_units: number } | undefined;

const spotMetadata = (accountId: string): Record<string, unknown> => {
  const stored = mockDatabase
    .prepare('SELECT metadata FROM holdings WHERE id = ?')
    .get(`h-spot-${accountId}`) as { metadata: string };

  return JSON.parse(stored.metadata);
};

const rewardKey = (number: number): string =>
  `acc-1:earn:reward:flexible:BTC001:REALTIME:${REWARD_TIME}:${number}`;

describe('the Earn walk on real SQLite', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    mockDatabase = openDatabase();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('writes the two legs of a Spot to Earn subscription on their wallets, creating the Earn wallet at zero, each naming the other, one pair id', async () => {
    const result = await runWalk('acc-1', [
      heldOf('flexibleSubscription', flexibleSubscriptionOf({ time: NOW - 2 * DAY_MS })),
    ]);

    const earn = holdingByKey('acc-1', 'BTC:earn');
    expect(result).toEqual({ imported: 2, complete: true });
    expect(earn?.balance_minor_units).toBe(0);
    expect(storedRows()).toEqual([
      {
        external_id: 'acc-1:earn:sub:flexible:p-1:BTC',
        holding_id: 'h-spot-acc-1',
        amount_minor_units: -100_000,
        exchange_counterpart_holding_id: earn?.id,
        exchange_pair_id: 'acc-1:earn:sub:flexible:p-1',
        untracked_counterpart: null,
        description: '',
      },
      {
        external_id: 'acc-1:earn:sub:flexible:p-1:BTC:earn',
        holding_id: earn?.id,
        amount_minor_units: 100_000,
        exchange_counterpart_holding_id: 'h-spot-acc-1',
        exchange_pair_id: 'acc-1:earn:sub:flexible:p-1',
        untracked_counterpart: null,
        description: '',
      },
    ]);
  });

  it('writes a reward as income on its wallet, "Binance Earn", with no marker and no pair', async () => {
    await runWalk('acc-1', [
      heldOf('flexibleRewards', flexibleRewardOf({ time: REWARD_TIME })),
      heldOf('lockedRewards', lockedRewardOf({ time: REWARD_TIME })),
    ]);

    const earn = holdingByKey('acc-1', 'BTC:earn');
    expect(storedRows()).toEqual([
      {
        external_id: rewardKey(0),
        holding_id: earn?.id,
        amount_minor_units: 12,
        exchange_counterpart_holding_id: null,
        exchange_pair_id: null,
        untracked_counterpart: null,
        description: 'Binance Earn',
      },
      {
        external_id: `acc-1:earn:reward:locked:pos-1:Booster:${REWARD_TIME}:0`,
        holding_id: 'h-spot-acc-1',
        amount_minor_units: 12,
        exchange_counterpart_holding_id: null,
        exchange_pair_id: null,
        untracked_counterpart: null,
        description: 'Binance Earn',
      },
    ]);
  });

  it('a reward group that grows on a re-read is two rows and 3 satoshis in all: the first row is refreshed, nothing is doubled', async () => {
    const reward = (amount: string) =>
      heldOf('flexibleRewards', flexibleRewardOf({ time: REWARD_TIME, rewards: amount }));

    await runWalk('acc-1', [reward('0.00000002')]);
    expect(storedRows().map((row) => [row.external_id, row.amount_minor_units])).toEqual([
      [rewardKey(0), 2],
    ]);

    await runWalk('acc-1', [reward('0.00000001'), reward('0.00000002')]);

    const rows = storedRows();
    expect(rows.map((row) => [row.external_id, row.amount_minor_units])).toEqual([
      [rewardKey(0), 1],
      [rewardKey(1), 2],
    ]);
    expect(rows.reduce((total, row) => total + row.amount_minor_units, 0)).toBe(3);
  });

  it('E10/E11: imports nothing new on a second identical run, and never moves the Earn balance', async () => {
    const held = [
      heldOf('flexibleSubscription', flexibleSubscriptionOf({ time: NOW - 2 * DAY_MS })),
      heldOf('flexibleRewards', flexibleRewardOf({ time: REWARD_TIME })),
    ];
    await runWalk('acc-1', held);
    const earn = holdingByKey('acc-1', 'BTC:earn');
    mockDatabase
      .prepare('UPDATE holdings SET balance_minor_units = 777 WHERE id = ?')
      .run(earn?.id ?? '');

    const second = await runWalk('acc-1', held);

    expect(second.imported).toBe(0);
    expect(storedRows()).toHaveLength(3);
    expect(holdingByKey('acc-1', 'BTC:earn')?.balance_minor_units).toBe(777);
  });

  it('keeps the rows of two accounts apart for the same purchase id', async () => {
    const held = [heldOf('flexibleSubscription', flexibleSubscriptionOf())];

    await runWalk('acc-1', held);
    await runWalk('acc-2', held);

    const rows = storedRows();
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.exchange_pair_id))).toEqual(
      new Set(['acc-1:earn:sub:flexible:p-1', 'acc-2:earn:sub:flexible:p-1']),
    );
  });

  it('owes a reward group of a type not known yet as a point, imports it once the type is known, and takes the point off the list', async () => {
    const reward = (type: string) =>
      heldOf('flexibleRewards', flexibleRewardOf({ time: REWARD_TIME - 5 * DAY_MS, type }));

    const first = await runWalk('acc-1', [reward('REWARDS')]);

    expect(first.imported).toBe(0);
    expect(storedRows()).toEqual([]);
    expect(spotMetadata('acc-1').binanceEarnPendingOverlap).toEqual([
      {
        start: REWARD_TIME - 5 * DAY_MS - 1,
        end: REWARD_TIME - 5 * DAY_MS + 1,
        kind: 'point',
        series: 'flexibleRewards',
      },
    ]);

    const second = await runWalk('acc-1', [reward('REALTIME')]);

    expect(second.imported).toBe(1);
    expect(storedRows()).toHaveLength(1);
    expect(spotMetadata('acc-1').binanceEarnPendingOverlap).toEqual([]);
  });
});
