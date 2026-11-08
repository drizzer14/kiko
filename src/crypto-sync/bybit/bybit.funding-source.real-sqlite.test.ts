// The unit tests of each walk fake the store of the Funding ledger. This file runs the three source
// walks (capital, transfer, convert) over the REAL repositories on a real `node:sqlite` engine (the
// shipped migrations, foreign keys on): the record of a source row lands in `funding_match_rows`
// beside its row, a second run writes no second one, and a rolled back deposit takes its record
// away with its row (A87, source part). No page with a row was read live: every row is built from
// the docs pages' samples.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { seedWalkMarks } from '@kiko/test-support/walk-marks';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { transferAt } from './bybit.transfer-test-fixtures';
import { createBybitHistoryRun } from './bybit.history-budget';
import { convertRouteOf } from './bybit.convert-test-fixtures';
import { syncBybitConvertHistory } from './bybit.convert-history';
import { syncBybitCapitalHistory } from './bybit.capital-history';
import { fakeBybit, served } from './bybit.capital-test-fixtures';
import { syncBybitTransferHistory } from './bybit.transfer-history';
import { API_KEY, NOW, SECRET } from './bybit.client-test-fixtures';
import { convertAt, depositRow, withdrawalRow } from './bybit.history-test-fixtures';

const ACCOUNT = 'acc-1';
const AT = NOW - 2 * DAY_MS;

type StoredRecord = {
  side: string;
  recordKey: string;
  series: string | null;
  coin: string;
  direction: string;
  amount: string;
  fee: string | null;
  tax: string | null;
  timeStart: number;
  timeEnd: number;
  earnPrincipal: number;
};

const storedRecords = (): StoredRecord[] =>
  mockDatabase
    .prepare(
      `SELECT side, record_key AS recordKey, series, coin, direction, amount, fee, tax,
              time_start AS timeStart, time_end AS timeEnd, earn_principal AS earnPrincipal
         FROM funding_match_rows WHERE account_id = ? ORDER BY record_key`,
    )
    .all(ACCOUNT) as StoredRecord[];

const storedRowKeys = (): string[] =>
  (
    mockDatabase.prepare('SELECT external_id FROM transactions ORDER BY external_id').all() as {
      external_id: string;
    }[]
  ).map((row) => row.external_id);

const request = () => ({
  targetAccountId: ACCOUNT,
  run: createBybitHistoryRun({ now: () => NOW, sleep: async () => undefined }),
});

const deps = (fetchImpl: typeof fetch) => ({
  now: () => NOW,
  fetchImpl,
  readCredentials: async () => ({ apiKey: API_KEY, secret: SECRET }),
});

const capitalOver = (bybit: ReturnType<typeof fakeBybit>) =>
  syncBybitCapitalHistory(request(), deps(bybit.fetchImpl));

const transferOver = (bybit: ReturnType<typeof fakeBybit>) =>
  syncBybitTransferHistory(request(), deps(bybit.fetchImpl));

const convertOver = (rows: Record<string, unknown>[]) => {
  const route = convertRouteOf();
  route.serve([rows]);

  return syncBybitConvertHistory(request(), deps(route.fetchImpl));
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase
    .prepare('INSERT INTO accounts (id, name, kind, institution) VALUES (?, ?, ?, ?)')
    .run(ACCOUNT, 'Bybit', 'crypto', 'bybit');
  seedWalkMarks(mockDatabase, ACCOUNT, 'capital', { cursor: NOW - 3 * DAY_MS });
  seedWalkMarks(mockDatabase, ACCOUNT, 'transfer', { cursor: NOW - 3 * DAY_MS });
});

describe('the source walks on real SQLite: the records of the Funding ledger', () => {
  it('a deposit and a withdrawal each write a record under the key of their row', async () => {
    const bybit = fakeBybit();
    bybit.world.deposit = [
      served(
        AT,
        depositRow({ coin: 'BTC', successAt: String(AT), amount: '0.5', depositFee: '0.1' }),
      ),
    ];
    bybit.world.withdraw = [
      served(
        AT + 1_000,
        withdrawalRow({
          coin: 'BTC',
          createTime: String(AT + 1_000),
          updateTime: String(AT + 5_000),
          amount: '0.125',
          withdrawFee: '0.0005',
          tax: '0.01',
        }),
      ),
    ];

    await capitalOver(bybit);

    expect(storedRecords()).toEqual([
      {
        side: 'source',
        recordKey: 'acc-1:deposit:1234:BTC',
        series: 'deposit',
        coin: 'BTC',
        direction: 'I',
        amount: '0.5',
        fee: '0.1',
        tax: null,
        timeStart: AT,
        timeEnd: AT,
        earnPrincipal: 0,
      },
      {
        side: 'source',
        recordKey: 'acc-1:withdraw:9012:BTC',
        series: 'withdraw',
        coin: 'BTC',
        direction: 'O',
        amount: '0.125',
        fee: '0.0005',
        tax: '0.01',
        timeStart: AT + 1_000,
        timeEnd: AT + 5_000,
        earnPrincipal: 0,
      },
    ]);
    expect(storedRowKeys()).toEqual(['acc-1:deposit:1234:BTC', 'acc-1:withdraw:9012:BTC']);
  });

  it('writes nothing new on a second run over the same records', async () => {
    const bybit = fakeBybit();
    bybit.world.deposit = [served(AT, depositRow({ coin: 'BTC', successAt: String(AT) }))];

    await capitalOver(bybit);
    const first = storedRecords();
    await capitalOver(bybit);

    expect(storedRecords()).toEqual(first);
    expect(first).toHaveLength(1);
  });

  it('a rolled back deposit takes its record away with its row, and leaves another record', async () => {
    const bybit = fakeBybit();
    bybit.world.deposit = [
      served(AT, depositRow({ id: 'gone', coin: 'BTC', successAt: String(AT) })),
      served(AT + 1_000, depositRow({ id: 'kept', coin: 'BTC', successAt: String(AT + 1_000) })),
    ];
    await capitalOver(bybit);

    bybit.world.deposit = [
      served(AT, depositRow({ id: 'gone', coin: 'BTC', status: 70011, successAt: String(AT) })),
      served(AT + 1_000, depositRow({ id: 'kept', coin: 'BTC', successAt: String(AT + 1_000) })),
    ];
    await capitalOver(bybit);

    expect(storedRecords().map(({ recordKey }) => recordKey)).toEqual(['acc-1:deposit:kept:BTC']);
    expect(storedRowKeys()).toEqual(['acc-1:deposit:kept:BTC']);
  });

  describe('a row write or delete that fails takes the record with it (one transaction)', () => {
    // A trigger makes the engine itself refuse the statement, so the proof does not depend on how
    // the code under test splits its writes.
    // The driver wraps the engine's error: the trigger's text is the cause of the one it throws.
    const REFUSED = { cause: { message: 'refused' } };

    const refuse = (event: 'INSERT' | 'DELETE', table: string) =>
      mockDatabase.exec(
        `CREATE TRIGGER refuse BEFORE ${event} ON ${table}
         BEGIN SELECT RAISE(ABORT, 'refused'); END`,
      );

    it('a deposit whose row write fails leaves no record', async () => {
      const bybit = fakeBybit();
      bybit.world.deposit = [served(AT, depositRow({ coin: 'BTC', successAt: String(AT) }))];
      refuse('INSERT', 'transactions');

      await expect(capitalOver(bybit)).rejects.toMatchObject(REFUSED);

      expect(storedRowKeys()).toEqual([]);
      expect(storedRecords()).toEqual([]);
    });

    it('a transfer whose row write fails leaves no record', async () => {
      const bybit = fakeBybit();
      bybit.world.transfer = [
        transferAt(AT, { fromAccountType: 'UNIFIED', toAccountType: 'FUND', amount: '2' }),
      ];
      refuse('INSERT', 'transactions');

      await expect(transferOver(bybit)).rejects.toMatchObject(REFUSED);

      expect(storedRowKeys()).toEqual([]);
      expect(storedRecords()).toEqual([]);
    });

    it('a convert whose row write fails leaves no record', async () => {
      refuse('INSERT', 'transactions');

      await expect(
        convertOver([convertAt(AT, { accountType: 'funding' }, 'on-funding')]),
      ).rejects.toMatchObject(REFUSED);

      expect(storedRowKeys()).toEqual([]);
      expect(storedRecords()).toEqual([]);
    });

    describe('a rolled back deposit whose delete fails', () => {
      const walkRollback = async () => {
        const bybit = fakeBybit();
        bybit.world.deposit = [
          served(AT, depositRow({ id: 'gone', coin: 'BTC', successAt: String(AT) })),
        ];
        await capitalOver(bybit);

        bybit.world.deposit = [
          served(AT, depositRow({ id: 'gone', coin: 'BTC', status: 70011, successAt: String(AT) })),
        ];

        return bybit;
      };

      it.each([
        ['the row delete', 'transactions'],
        ['the record delete', 'funding_match_rows'],
      ])('keeps the row and its record when %s fails', async (_title, table) => {
        const bybit = await walkRollback();
        refuse('DELETE', table);

        await expect(capitalOver(bybit)).rejects.toMatchObject(REFUSED);

        expect(storedRowKeys()).toEqual(['acc-1:deposit:gone:BTC']);
        expect(storedRecords().map(({ recordKey }) => recordKey)).toEqual([
          'acc-1:deposit:gone:BTC',
        ]);
      });
    });
  });

  it('a transfer into Funding writes one record, and a transfer between two Unified wallets none', async () => {
    const bybit = fakeBybit();
    bybit.world.transfer = [
      transferAt(AT, { fromAccountType: 'UNIFIED', toAccountType: 'FUND', amount: '2' }),
      transferAt(AT + 1_000, {
        transferId: 'inside',
        fromAccountType: 'UNIFIED',
        toAccountType: 'UNIFIED',
      }),
    ];

    await transferOver(bybit);

    expect(storedRecords()).toMatchObject([
      {
        recordKey: 'acc-1:xfer:transfer-1:BTC:BTC:fund',
        series: 'transfer',
        direction: 'I',
        amount: '2',
        timeStart: AT,
        timeEnd: AT,
      },
    ]);
    expect(storedRowKeys()).toHaveLength(2);
  });

  it('a convert on a Funding word writes a record for each coin, and one on Unified none', async () => {
    await convertOver([
      convertAt(AT, { accountType: 'funding' }, 'on-funding'),
      convertAt(AT + 1_000, { accountType: 'eb_convert_uta' }, 'on-unified'),
    ]);

    expect(storedRecords()).toMatchObject([
      {
        recordKey: 'acc-1:convert:on-funding:BTC:ETH:BTC:fund',
        series: 'convert',
        coin: 'BTC',
        direction: 'O',
        amount: '0.1',
      },
      {
        recordKey: 'acc-1:convert:on-funding:BTC:ETH:ETH:fund',
        series: 'convert',
        coin: 'ETH',
        direction: 'I',
        amount: '1.773938248611074',
      },
    ]);
    expect(storedRowKeys()).toHaveLength(4);
  });
});
