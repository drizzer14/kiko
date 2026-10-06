// A card-to-jar top-up through the REAL repositories on a real, fully migrated
// SQLite engine: only here do the two statement legs, the stored balances, the
// net-worth line and the read-time own-transfer pairing meet. Only the network
// (client-info, statements), the clock, the sleep and the token are faked.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { DAY_MS, startOfLocalDay } from '@kiko/dates';
import statement from '@kiko/monobank/__fixtures__/statement.json';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import clientInfo from '@kiko/monobank/__fixtures__/client-info.json';
import { buildNetWorthSeries } from '@kiko/statistics/net-worth-series';
import { internalTransferTransactionIds } from '@kiko/statistics/internal-transfers';

import type { MonobankAccount, MonobankJar, MonobankStatementItem } from '../monobank-types';

import { runSync } from './sync';

const SECOND = 1_000;
const TOP_UP_AT_MS = new Date(2026, 8, 10, 12, 0, 0).getTime();
const RUN_AT_MS = TOP_UP_AT_MS + 6 * 60 * 60 * SECOND;
const cardId = clientInfo.accounts[0].id;
const jarId = clientInfo.jars[0].id;
// The bank's figures after the top-up: 5000.00 on the card, 3000.00 in the jar.
const cards = [{ ...clientInfo.accounts[0], balance: 500_000 }] as MonobankAccount[];
const jars = [{ ...clientInfo.jars[0], balance: 300_000 }] as MonobankJar[];

const leg = (id: string, amount: number): MonobankStatementItem => ({
  ...(statement[0] as MonobankStatementItem),
  id,
  amount,
  operationAmount: amount,
  time: TOP_UP_AT_MS / SECOND,
});

const legsOf = (monobankId: string): MonobankStatementItem[] => {
  if (monobankId === cardId) {
    return [leg('card-leg', -300_000)];
  }

  return monobankId === jarId ? [leg('jar-leg', 300_000)] : [];
};

const sync = (atMs: number) =>
  runSync({
    targetAccountId: 'acc-1',
    now: () => atMs,
    sleep: async () => undefined,
    readToken: async () => 'token',
    fetchClientInfo: async () => ({ accounts: cards, jars }),
    fetchStatement: async (_token, accountId) => legsOf(decodeURIComponent(accountId)),
  });

const holdingIdOf = (monobankId: string): string =>
  (
    mockDatabase
      .prepare("SELECT id FROM holdings WHERE json_extract(metadata, '$.monobankId') = ?")
      .get(monobankId) as { id: string }
  ).id;

const rowsOf = (monobankId: string) =>
  mockDatabase
    .prepare(
      'SELECT external_id AS externalId, amount_minor_units AS amount FROM transactions WHERE holding_id = ?',
    )
    .all(holdingIdOf(monobankId)) as { externalId: string; amount: number }[];

const storedHoldings = () =>
  (
    mockDatabase
      .prepare(
        `SELECT id, currency, type, balance_minor_units AS balanceMinorUnits, closed_at AS closedAt
         FROM holdings`,
      )
      .all() as {
      id: string;
      currency: 'UAH';
      type: 'card' | 'jar';
      balanceMinorUnits: number;
      closedAt: number | null;
    }[]
  ).map((holding) => ({ ...holding, metadata: null }));

const storedTransactions = () =>
  mockDatabase
    .prepare(
      'SELECT id, holding_id AS holdingId, time, amount_minor_units AS amountMinorUnits FROM transactions',
    )
    .all() as { id: string; holdingId: string; time: number; amountMinorUnits: number }[];

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution) VALUES ('acc-1', 'Monobank', 'bank', 'monobank')",
    )
    .run();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('a Monobank card-to-jar top-up', () => {
  it('stores one row per leg on its own holding and inserts nothing on a re-run', async () => {
    const first = await sync(RUN_AT_MS);

    expect(first.importedTransactions).toBe(2);
    expect(rowsOf(cardId)).toEqual([{ externalId: 'acc-1:card-leg', amount: -300_000 }]);
    expect(rowsOf(jarId)).toEqual([{ externalId: 'acc-1:jar-leg', amount: 300_000 }]);

    const again = await sync(RUN_AT_MS + DAY_MS + SECOND);

    expect(again.importedTransactions).toBe(0);
    expect(storedTransactions()).toHaveLength(2);
  });

  it('keeps net worth flat across the top-up day', async () => {
    await sync(RUN_AT_MS);

    const before = startOfLocalDay(new Date(2026, 8, 9, 12).getTime());
    const on = startOfLocalDay(TOP_UP_AT_MS);
    const holdings = storedHoldings();
    const transactions = storedTransactions();
    const series = buildNetWorthSeries({
      holdings,
      transactionsByHolding: new Map(
        holdings.map((holding) => [
          holding.id,
          transactions.filter((row) => row.holdingId === holding.id),
        ]),
      ),
      historyRows: [],
      baseCurrency: 'UAH',
      range: { from: before, to: on },
    });

    expect(series.points).toEqual([
      { t: before, amount: 8_000 },
      { t: on, amount: 8_000 },
    ]);
  });

  it('pairs the two legs as an own transfer at read time', async () => {
    await sync(RUN_AT_MS);

    const transactions = storedTransactions();
    const paired = internalTransferTransactionIds(
      transactions.map((row) => ({ ...row, currency: 'UAH' as const })),
    );

    expect(paired).toEqual(new Set(transactions.map((row) => row.id)));
  });
});
