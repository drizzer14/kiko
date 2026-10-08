// A card disconnected, a statement imported over the gap, then the account
// reconnected, through the REAL repositories on a real, fully migrated SQLite
// engine: only here do the import, the sync's fetch of the same purchases and the
// stored balance meet. Only the network, the clock, the sleep and the token are
// faked.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { accountsRepo } from '@kiko/accounts';
import { transactionsRepo } from '@kiko/transactions/repo';
import statement from '@kiko/monobank/__fixtures__/statement.json';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import clientInfo from '@kiko/monobank/__fixtures__/client-info.json';

import type { MonobankAccount, MonobankJar, MonobankStatementItem } from '../monobank-types';

import { runSync } from './sync';

const FIRST_RUN_MS = 1_700_000_000_000;
const RECONNECT_RUN_MS = FIRST_RUN_MS + 3 * DAY_MS;
const SECOND = 1_000;
const cardId = clientInfo.accounts[0].id;
const PURCHASES_AT_MS = FIRST_RUN_MS + DAY_MS;
// The bank's balance after the two purchases below.
const BALANCE_AFTER_PURCHASES = clientInfo.accounts[0].balance - 8_000;

const purchase = (id: string, amount: number, atMs: number): MonobankStatementItem => ({
  ...(statement[0] as MonobankStatementItem),
  id,
  amount,
  operationAmount: amount,
  time: atMs / SECOND,
});

const items = [
  purchase('coffee', -5_000, PURCHASES_AT_MS + 5 * SECOND),
  purchase('bus', -3_000, PURCHASES_AT_MS + 600 * SECOND),
];

const cardAccounts = (balance: number): MonobankAccount[] =>
  (clientInfo.accounts as MonobankAccount[]).map((account) =>
    account.id === cardId ? { ...account, balance } : account,
  );

const sync = (atMs: number, balance: number) =>
  runSync({
    targetAccountId: 'acc-1',
    now: () => atMs,
    sleep: async () => undefined,
    readToken: async () => 'token',
    fetchClientInfo: async () => ({
      accounts: cardAccounts(balance),
      jars: clientInfo.jars as MonobankJar[],
    }),
    fetchStatement: async (_token, accountId, from, to) =>
      decodeURIComponent(accountId) === cardId
        ? items.filter((item) => item.time >= from && item.time <= to)
        : [],
  });

const cardHoldingId = (): string =>
  (
    mockDatabase
      .prepare("SELECT id FROM holdings WHERE json_extract(metadata, '$.monobankId') = ?")
      .get(cardId) as { id: string }
  ).id;

const cardBalance = (): number =>
  (
    mockDatabase
      .prepare('SELECT balance_minor_units AS value FROM holdings WHERE id = ?')
      .get(cardHoldingId()) as { value: number }
  ).value;

const cardRows = () =>
  mockDatabase
    .prepare(
      'SELECT source, amount_minor_units AS amount, category FROM transactions WHERE holding_id = ? ORDER BY time',
    )
    .all(cardHoldingId()) as { source: string; amount: number; category: string | null }[];

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

describe('a Monobank card reconnected after a statement was imported over the gap', () => {
  it('keeps one row per purchase and takes its balance from the bank', async () => {
    await sync(FIRST_RUN_MS, clientInfo.accounts[0].balance);
    await accountsRepo.disconnect('acc-1');
    await transactionsRepo.importRows({
      holdingId: cardHoldingId(),
      rows: items.map((item) => ({
        holdingId: cardHoldingId(),
        amountMinorUnits: item.amount,
        time: item.time * SECOND + 2 * SECOND,
        source: 'import' as const,
        externalId: `file-${item.id}`,
        category: 'gifts',
      })),
    });

    expect(cardRows()).toHaveLength(2);

    await sync(RECONNECT_RUN_MS, BALANCE_AFTER_PURCHASES);

    expect(cardRows()).toEqual([
      { source: 'monobank', amount: -5_000, category: 'gifts' },
      { source: 'monobank', amount: -3_000, category: 'gifts' },
    ]);
    expect(cardBalance()).toBe(BALANCE_AFTER_PURCHASES);
  });
});
