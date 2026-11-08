// The reconcile of the Funding ledger over the REAL repositories on a real `node:sqlite` engine
// (the shipped migrations, foreign keys on): rule 51 runs on the stored set, and only the
// difference against the rows already written is written (A87, A88, A101, A107). No page with a
// row was read live: the stored set is built by hand from the shape the walks store.
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
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  ...jest.requireActual('@kiko/crypto-sync/binance/binance.credentials'),
  clearCredentials: async () => undefined,
}));
jest.mock('./bybit.credentials', () => ({
  ...jest.requireActual('./bybit.credentials'),
  clearBybitCredentials: async () => undefined,
}));

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { holdingsRepo } from '@kiko/holdings/repo';
import { transactionsRepo } from '@kiko/transactions/repo';
import { seedWalkMarks } from '@kiko/test-support/walk-marks';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { buildSpendingLedger } from '@kiko/statistics/spending-ledger';
import { disconnectCryptoAccount } from '@kiko/crypto-sync/disconnect';
import { type FundingMatchRow, accounts, database, write } from '@kiko/db';
import { BinanceWalkStop, exchangeStateDepsOf } from '@kiko/crypto-sync/exchange/walk';

import { NOW } from './bybit.client-test-fixtures';
import { FUNDING_MATCH_WINDOW_MS } from './bybit.funding-match';
import { bybitFundingMatchRepo } from './bybit.funding-match.repo';
import { reconcileBybitFundingLedger } from './bybit.funding-reconcile';
import { ledgerRowOf, sourceRowOf } from './bybit.funding-test-fixtures';

const ACCOUNT = 'acc-1';
const DEPS = { now: () => NOW };

const ago = (days: number): number => NOW - days * DAY_MS;

const ledgerKey = (name: string, coin = 'USDT'): string => `${ACCOUNT}:funding:${name}:${coin}`;

const depositKey = (name: string): string => `${ACCOUNT}:deposit:${name}:USDT`;

type StoredTransaction = {
  external_id: string;
  amount_minor_units: number;
  time: number;
  description: string;
  untracked_counterpart: string | null;
  operation: string | null;
  category: string | null;
  comment: string | null;
  exchange_counterpart_holding_id: string | null;
  exchange_pair_id: string | null;
  source: string;
  holding_id: string;
};

const transactionRows = (): StoredTransaction[] =>
  mockDatabase
    .prepare(
      `SELECT external_id, amount_minor_units, time, description, untracked_counterpart,
              operation, category, comment, exchange_counterpart_holding_id, exchange_pair_id,
              source, holding_id
         FROM transactions ORDER BY external_id`,
    )
    .all() as StoredTransaction[];

const rowKeys = (): string[] => transactionRows().map((row) => row.external_id);

const storedKeys = (side: 'ledger' | 'source'): string[] =>
  (
    mockDatabase
      .prepare(
        `SELECT record_key FROM funding_match_rows
          WHERE account_id = ? AND side = ? ORDER BY record_key`,
      )
      .all(ACCOUNT, side) as { record_key: string }[]
  ).map((row) => row.record_key);

const stateText = (): string | undefined =>
  (
    mockDatabase
      .prepare('SELECT exchange_state FROM sync_state WHERE account_id = ?')
      .get(ACCOUNT) as { exchange_state: string } | undefined
  )?.exchange_state;

const heldCount = (): unknown => JSON.parse(stateText() ?? '{}').fundingHeld;

const store = (rows: FundingMatchRow[]): Promise<void> =>
  write((databaseTransaction) =>
    bybitFundingMatchRepo.upsertDatabaseTransaction(databaseTransaction, rows),
  );

const settle = (): void => {
  for (const walk of ['capital', 'transfer', 'convert'] as const) {
    seedWalkMarks(mockDatabase, ACCOUNT, walk, { cursor: NOW, pending: [] });
  }
};

const reconcile = (overrides: Parameters<typeof reconcileBybitFundingLedger>[1] = {}) =>
  reconcileBybitFundingLedger({ targetAccountId: ACCOUNT }, { ...DEPS, ...overrides });

// Counts what reaches the table of rows, so "writes nothing" means no insert attempt (an upsert of
// a row already there is one, though it changes nothing), update or delete.
const rowWrites = (): number =>
  (mockDatabase.prepare('SELECT COUNT(*) AS total FROM row_writes').get() as { total: number })
    .total;

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase
    .prepare('INSERT INTO accounts (id, name, kind, institution) VALUES (?, ?, ?, ?)')
    .run(ACCOUNT, 'Bybit', 'crypto', 'bybit');
  settle();
  mockDatabase.exec(`
    CREATE TABLE row_writes (id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TRIGGER row_inserted BEFORE INSERT ON transactions
      BEGIN INSERT INTO row_writes (id) VALUES (NULL); END;
    CREATE TRIGGER row_updated AFTER UPDATE ON transactions
      BEGIN INSERT INTO row_writes (id) VALUES (NULL); END;
    CREATE TRIGGER row_deleted AFTER DELETE ON transactions
      BEGIN INSERT INTO row_writes (id) VALUES (NULL); END;
  `);
});

describe('the reconcile of the Funding ledger on real SQLite', () => {
  it('lists a row no source explains on the Funding holding of its coin, signed by its direction, with the marker', async () => {
    await store([
      ledgerRowOf(ledgerKey('in'), ago(20), { amount: '100.5' }),
      ledgerRowOf(ledgerKey('out'), ago(19), { amount: '40', direction: 'O' }),
    ]);

    await reconcile();

    const holding = mockDatabase
      .prepare("SELECT id FROM holdings WHERE account_id = ? AND metadata LIKE '%USDT:fund%'")
      .get(ACCOUNT) as { id: string };

    expect(transactionRows()).toEqual([
      expect.objectContaining({
        external_id: ledgerKey('in'),
        amount_minor_units: 10_050_000_000,
        time: ago(20),
        description: '',
        untracked_counterpart: 'ledger:funding',
        operation: null,
        category: null,
        exchange_counterpart_holding_id: null,
        exchange_pair_id: null,
        source: 'bybit',
        holding_id: holding.id,
      }),
      expect.objectContaining({
        external_id: ledgerKey('out'),
        amount_minor_units: -4_000_000_000,
        time: ago(19),
      }),
    ]);
  });

  it('writes no row for a ledger row that rounds to no units or is too large to hold, and lists the rest', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await store([
      ledgerRowOf(ledgerKey('dust'), ago(20), { amount: '0.0000000001' }),
      ledgerRowOf(ledgerKey('huge'), ago(20), { amount: '99999999999999999999' }),
      ledgerRowOf(ledgerKey('fine'), ago(20), { amount: '1' }),
    ]);

    await reconcile();

    expect(rowKeys()).toEqual([ledgerKey('fine')]);
    expect(storedKeys('ledger')).toEqual([ledgerKey('dust'), ledgerKey('fine'), ledgerKey('huge')]);
    jest.restoreAllMocks();
  });

  describe('which verdict removes a listed row', () => {
    const listFirst = async (rows: FundingMatchRow[]) => {
      await store(rows);
      await reconcile();
    };

    it('a source that lands after its row is listed removes the listed row at the next reconcile', async () => {
      await listFirst([ledgerRowOf(ledgerKey('late'), ago(20))]);
      expect(rowKeys()).toEqual([ledgerKey('late')]);

      await store([sourceRowOf(depositKey('1'), 'deposit', ago(20))]);
      await reconcile();

      expect(rowKeys()).toEqual([]);
      expect(storedKeys('ledger')).toEqual([ledgerKey('late')]);
    });

    it('a row that becomes held, because a free source lies within the window, is removed too', async () => {
      await listFirst([ledgerRowOf(ledgerKey('odd'), ago(20), { amount: '99' })]);

      await store([sourceRowOf(depositKey('1'), 'deposit', ago(20))]);
      await reconcile();

      expect(rowKeys()).toEqual([]);
    });

    it('an Earn row is removed when the clause reads Earn, and listed when it does not', async () => {
      await store([ledgerRowOf(ledgerKey('earn'), ago(20), { earnPrincipal: true })]);

      await reconcile();
      expect(rowKeys()).toEqual([ledgerKey('earn')]);

      await reconcile({ earnClause: 'read' });
      expect(rowKeys()).toEqual([]);
    });

    it('a waiting verdict keeps a listed row with its note and category, and adds none', async () => {
      await listFirst([ledgerRowOf(ledgerKey('kept'), ago(20))]);
      mockDatabase
        .prepare(
          "UPDATE transactions SET comment = 'rent', category = 'rent' WHERE external_id = ?",
        )
        .run(ledgerKey('kept'));
      seedWalkMarks(mockDatabase, ACCOUNT, 'capital', {
        pending: [
          { kind: 'point', series: 'deposit', start: ago(20), end: ago(20) + 1, since: ago(5) },
        ],
      });
      await store([ledgerRowOf(ledgerKey('new'), ago(19), { amount: '7' })]);

      await reconcile();

      expect(transactionRows()).toEqual([
        expect.objectContaining({
          external_id: ledgerKey('kept'),
          comment: 'rent',
          category: 'rent',
        }),
      ]);
    });

    it('never removes a row whose key has no stored ledger row', async () => {
      await listFirst([ledgerRowOf(ledgerKey('gone'), ago(20))]);
      mockDatabase
        .prepare('DELETE FROM funding_match_rows WHERE account_id = ? AND side = ?')
        .run(ACCOUNT, 'ledger');
      await store([sourceRowOf(depositKey('1'), 'deposit', ago(20))]);

      await reconcile();

      expect(rowKeys()).toEqual([ledgerKey('gone')]);
    });
  });

  it('a row under seven days waits, an older row lists, and a convert that lands later removes it at that reconcile', async () => {
    seedWalkMarks(mockDatabase, ACCOUNT, 'convert', { cursor: null, pending: [] });
    await store([
      ledgerRowOf(ledgerKey('young'), ago(3)),
      ledgerRowOf(ledgerKey('old'), ago(8), { amount: '55' }),
    ]);

    await reconcile();

    expect(rowKeys()).toEqual([ledgerKey('old')]);

    await store([sourceRowOf(`${ACCOUNT}:convert:1:USDT`, 'convert', ago(8), { amount: '55' })]);
    await reconcile();

    expect(rowKeys()).toEqual([]);
  });

  it('a new row within a day waits and writes nothing', async () => {
    seedWalkMarks(mockDatabase, ACCOUNT, 'capital', { cursor: NOW - DAY_MS / 2 });
    await store([ledgerRowOf(ledgerKey('fresh'), NOW - 60_000)]);

    await reconcile();

    expect(rowKeys()).toEqual([]);
    expect(rowWrites()).toBe(0);
  });

  it('a second reconcile with no new record writes no row and no mark, and the prune removes only rows past the floor by two windows and leaves their listed rows', async () => {
    const pruneBefore = NOW - 729 * DAY_MS - 2 * FUNDING_MATCH_WINDOW_MS;

    await store([
      ledgerRowOf(ledgerKey('a'), ago(30), { amount: '10' }),
      ledgerRowOf(ledgerKey('held'), ago(30), { amount: '98', direction: 'O' }),
      ledgerRowOf(ledgerKey('b'), ago(29), { amount: '11' }),
      sourceRowOf(`${ACCOUNT}:withdraw:free:USDT`, 'withdraw', ago(30), { amount: '1' }),
      ledgerRowOf(ledgerKey('edge'), pruneBefore, { amount: '12' }),
      ledgerRowOf(ledgerKey('past'), pruneBefore - 1, { amount: '13' }),
    ]);

    await reconcile();
    const rowsAfterFirst = transactionRows();
    const stateAfterFirst = stateText();
    const writesAfterFirst = rowWrites();

    await reconcile();

    expect(transactionRows()).toEqual(rowsAfterFirst);
    expect(stateText()).toBe(stateAfterFirst);
    expect(rowWrites()).toBe(writesAfterFirst);
    expect(rowKeys()).toEqual(
      [ledgerKey('a'), ledgerKey('b'), ledgerKey('edge'), ledgerKey('past')].sort(),
    );
    expect(storedKeys('ledger')).toEqual(
      [ledgerKey('a'), ledgerKey('b'), ledgerKey('edge'), ledgerKey('held')].sort(),
    );
    expect(storedKeys('source')).toEqual([`${ACCOUNT}:withdraw:free:USDT`]);
  });

  it('patches the count of held rows only when it changes, and drops its key at zero', async () => {
    const patches: unknown[] = [];
    const real = exchangeStateDepsOf('bybit');
    const spy = {
      patchExchangeState: (
        accountId: string,
        list: Parameters<typeof real.patchExchangeState>[1],
      ) => {
        patches.push(list);

        return real.patchExchangeState(accountId, list);
      },
    };

    await store([
      sourceRowOf(depositKey('free'), 'deposit', ago(30)),
      ledgerRowOf(ledgerKey('held'), ago(30), { amount: '98' }),
    ]);

    await reconcile(spy);
    await reconcile(spy);

    expect(patches).toEqual([[{ kind: 'fundingHeld', count: 1 }]]);
    expect(heldCount()).toBe(1);

    mockDatabase.prepare('DELETE FROM funding_match_rows WHERE side = ?').run('source');
    await reconcile(spy);

    expect(patches).toEqual([
      [{ kind: 'fundingHeld', count: 1 }],
      [{ kind: 'fundingHeld', count: 0 }],
    ]);
    expect(heldCount()).toBeUndefined();
  });

  describe('what rejects the reconcile before it writes anything', () => {
    it('a holding it cannot find rejects it with a fixed code', async () => {
      await store([ledgerRowOf(ledgerKey('a'), ago(20)), ledgerRowOf(ledgerKey('old'), ago(900))]);

      await expect(
        reconcile({ listHoldings: async () => [], ensureHoldings: async () => undefined }),
      ).rejects.toEqual(new BinanceWalkStop('funding-holding-missing'));

      expect(rowKeys()).toEqual([]);
      expect(storedKeys('ledger')).toEqual([ledgerKey('a'), ledgerKey('old')]);
    });

    it('an unreadable pending mark of a source walk rejects it, so no verdict is taken on a guess', async () => {
      await store([ledgerRowOf(ledgerKey('a'), ago(20))]);
      mockDatabase
        .prepare('UPDATE sync_state SET exchange_state = ? WHERE account_id = ?')
        .run(
          JSON.stringify({ version: 1, walks: { capital: { cursor: NOW, pending: 'bad' } } }),
          ACCOUNT,
        );

      await expect(reconcile()).rejects.toEqual(new BinanceWalkStop('funding-marks-unreadable'));
      expect(rowKeys()).toEqual([]);
    });

    it('a state no build reads rejects it with the code the walks use', async () => {
      mockDatabase
        .prepare('UPDATE sync_state SET exchange_state = ? WHERE account_id = ?')
        .run('not json', ACCOUNT);

      await expect(reconcile()).rejects.toEqual(new BinanceWalkStop('exchange-state-malformed'));
    });
  });

  describe('what a listed row can take from its neighbours', () => {
    const MINUTE_MS = 60_000;
    const THOUSAND_USDT_MINOR_UNITS = 100_000_000_000;
    const FIAT_DEBIT_MINOR_UNITS = 415_000;

    const idWhere = (column: 'external_id' | 'description', value: string): string =>
      (
        mockDatabase.prepare(`SELECT id FROM transactions WHERE ${column} = ?`).get(value) as {
          id: string;
        }
      ).id;

    const idOf = (externalId: string): string => idWhere('external_id', externalId);

    const idByDescription = (description: string): string => idWhere('description', description);

    const setMarker = (externalId: string, marker: string | null): void => {
      mockDatabase
        .prepare('UPDATE transactions SET untracked_counterpart = ? WHERE external_id = ?')
        .run(marker, externalId);
    };

    const excludedIds = async (): Promise<ReadonlySet<string>> => {
      const holdings = await holdingsRepo.allQuery();

      return buildSpendingLedger({
        transactions: await transactionsRepo.listAllQuery(),
        holdings,
        accounts: await database.select().from(accounts),
        shownHoldings: holdings,
      }).excludedTransactionIds;
    };

    const loanCandidateIds = async (): Promise<string[]> =>
      (await transactionsRepo.loanMatchCandidatesQuery({ minTime: 0, currencies: ['USDT'] })).map(
        ({ id }) => id,
      );

    // A credit one minute after the Out row, of the same amount on another holding, is the partner
    // the transfer matcher would take. A bank debit before the In row, of a total in fiat, is the
    // funding the funding matcher would pair with an exchange row of that code. A debit of the
    // Out row's amount is a loan payment candidate.
    const seedNeighbours = async (): Promise<void> => {
      mockDatabase.exec(`
        INSERT INTO accounts (id, name, kind) VALUES ('cash-account', 'Cash', 'cash');
        INSERT INTO accounts (id, name, kind) VALUES ('bank-account', 'Bank', 'bank');
        INSERT INTO holdings (id, account_id, name, type, currency)
          VALUES ('cash', 'cash-account', 'Cash', 'cash', 'USDT');
        INSERT INTO holdings (id, account_id, name, type, currency)
          VALUES ('card', 'bank-account', 'Card', 'card', 'UAH');
      `);

      for (const neighbour of [
        {
          holdingId: 'cash',
          amountMinorUnits: THOUSAND_USDT_MINOR_UNITS,
          time: ago(10) + MINUTE_MS,
          description: 'partner credit',
        },
        {
          holdingId: 'cash',
          amountMinorUnits: -THOUSAND_USDT_MINOR_UNITS,
          time: ago(5),
          description: 'loan candidate',
        },
        {
          holdingId: 'card',
          amountMinorUnits: -FIAT_DEBIT_MINOR_UNITS,
          time: ago(20) - 10 * MINUTE_MS,
          description: 'bank debit',
        },
      ]) {
        await transactionsRepo.add({ ...neighbour, source: 'manual' });
      }
    };

    it('a listed row stays out of spending and of the transfer, funding and loan matchers', async () => {
      await store([
        ledgerRowOf(ledgerKey('in'), ago(20), { amount: '4150' }),
        ledgerRowOf(ledgerKey('out'), ago(10), { amount: '1000', direction: 'O' }),
      ]);
      await reconcile();
      await seedNeighbours();

      const inId = idOf(ledgerKey('in'));
      const outId = idOf(ledgerKey('out'));
      const partnerId = idByDescription('partner credit');
      const bankDebitId = idByDescription('bank debit');
      const loanCandidateId = idByDescription('loan candidate');

      const excluded = await excludedIds();

      // Both rows are out of spending, in either direction, and neither takes a neighbour.
      expect(excluded.has(inId)).toBe(true);
      expect(excluded.has(outId)).toBe(true);
      expect(excluded.has(partnerId)).toBe(false);
      expect(excluded.has(bankDebitId)).toBe(false);
      expect(await loanCandidateIds()).toEqual([loanCandidateId]);

      // Without the marker the same rows take them, so the marker is what keeps the neighbours.
      setMarker(ledgerKey('out'), null);
      setMarker(ledgerKey('in'), 'p2p:UAH:4150.00');

      const unmarked = await excludedIds();

      expect(unmarked.has(partnerId)).toBe(true);
      expect(unmarked.has(bankDebitId)).toBe(true);
      expect((await loanCandidateIds()).sort()).toEqual([loanCandidateId, outId].sort());
    });
  });

  it('a disconnect clears the stored set and keeps the listed rows, and a reconnect removes none of them', async () => {
    await store([
      ledgerRowOf(ledgerKey('a'), ago(20)),
      sourceRowOf(`${ACCOUNT}:withdraw:1:USDT`, 'withdraw', ago(20), { amount: '5' }),
    ]);
    await reconcile();
    expect(rowKeys()).toEqual([ledgerKey('a')]);

    await disconnectCryptoAccount(ACCOUNT, 'bybit');

    expect(storedKeys('ledger')).toEqual([]);
    expect(storedKeys('source')).toEqual([]);
    expect(rowKeys()).toEqual([ledgerKey('a')]);

    mockDatabase.prepare("UPDATE accounts SET institution = 'bybit' WHERE id = ?").run(ACCOUNT);
    settle();
    await reconcile();

    expect(rowKeys()).toEqual([ledgerKey('a')]);
  });
});
