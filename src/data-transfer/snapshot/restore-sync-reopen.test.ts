// A backup taken while a Monobank card is sync-closed (carrying
// `syncClosedFromMs`) or freshly reopened (carrying `statementFromMs`) must
// restore those marks whole: the next sync reopens the card and imports its gap
// from the stored instant. The real export read, the real restore and the real
// sync repositories run on a fully migrated `node:sqlite` engine; only the
// network, the clock, the sleep and the token are faked.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { runSync } from '@kiko/monobank/sync';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import type { MonobankAccount, MonobankStatementItem } from '@kiko/monobank/monobank-types';

import { readDataSnapshot } from './read-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

const HOUR_MS = 60 * 60 * 1000;
const NOW_MS = 1_700_000_000_000;
const MARK_MS = NOW_MS - 40 * DAY_MS;
const BALANCE = 1_250_000;

const card: MonobankAccount = {
  id: 'card-1',
  sendId: 'send-1',
  balance: BALANCE,
  creditLimit: 0,
  type: 'black',
  currencyCode: 980,
  cashbackType: 'UAH',
  maskedPan: ['537541******1234'],
  iban: 'UA733220010000026201234567890',
};

// A purchase inside the gap, reachable only from the stored mark.
const gapItem: MonobankStatementItem = {
  id: 'gap-item',
  time: (NOW_MS - 20 * DAY_MS) / 1000,
  description: 'Сільпо',
  mcc: 5411,
  originalMcc: 5411,
  hold: false,
  amount: -45000,
  operationAmount: -45000,
  currencyCode: 980,
  commissionRate: 0,
  cashbackAmount: 0,
  balance: BALANCE,
};

const openDatabase = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.exec('PRAGMA foreign_keys = ON;');

  return database;
};

// The state the sync leaves a card in, on an account whose last full fetch was
// an hour ago, with the card's import marker equal to its balance: only the
// stored mark can make the next incremental run fetch it.
const seedCard = (closedAt: number | null, metadata: Record<string, unknown>): void => {
  mockDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution) VALUES ('acc-1', 'Monobank', 'bank', 'monobank')",
    )
    .run();
  mockDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units,
         synced_balance_minor_units, metadata, closed_at)
       VALUES ('h-card', 'acc-1', 'Black', 'card', 'UAH', ?, ?, ?, ?)`,
    )
    .run(
      BALANCE,
      BALANCE,
      JSON.stringify({ monobankId: card.id, iban: card.iban, ...metadata }),
      closedAt,
    );
  mockDatabase
    .prepare(
      "INSERT INTO sync_state (account_id, last_sync_at, last_full_sync_at) VALUES ('acc-1', ?, ?)",
    )
    .run(NOW_MS - HOUR_MS, NOW_MS - HOUR_MS);
};

const restoredFromBackup = async (): Promise<void> => {
  const snapshot = await readDataSnapshot();

  mockDatabase = openDatabase();
  await restoreDataSnapshot(snapshot);
};

const syncOnce = () =>
  runSync({
    targetAccountId: 'acc-1',
    now: () => NOW_MS,
    sleep: async () => undefined,
    readToken: async () => 'token',
    fetchClientInfo: async () => ({ accounts: [card], jars: [] }),
    fetchStatement: async (_token, _accountId, from, to) =>
      gapItem.time >= from && gapItem.time <= to ? [gapItem] : [],
  });

const storedCard = () =>
  mockDatabase
    .prepare("SELECT closed_at AS closedAt, metadata FROM holdings WHERE id = 'h-card'")
    .get() as { closedAt: number | null; metadata: string };

const storedMetadata = (): Record<string, unknown> => JSON.parse(storedCard().metadata);

const gapRowCount = (): number =>
  (
    mockDatabase
      .prepare("SELECT count(*) AS total FROM transactions WHERE holding_id = 'h-card'")
      .get() as { total: number }
  ).total;

describe('restoring a backup of a Monobank card the sync closed or reopened', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockDatabase = openDatabase();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps the sync-close mark whole, so the next sync reopens the card and imports from it (row 16)', async () => {
    seedCard(5, { syncClosedFromMs: MARK_MS });
    await restoredFromBackup();

    expect(storedMetadata()).toMatchObject({ syncClosedFromMs: MARK_MS });
    expect(storedCard().closedAt).toBe(5);

    await syncOnce();

    expect(storedCard().closedAt).toBeNull();
    expect(storedMetadata()).not.toHaveProperty('syncClosedFromMs');
    expect(storedMetadata()).not.toHaveProperty('statementFromMs');
    expect(gapRowCount()).toBe(1);
  });

  it('keeps a pending statement cursor whole, so the next sync imports the gap and clears it (row 17)', async () => {
    seedCard(null, { statementFromMs: MARK_MS });
    await restoredFromBackup();

    expect(storedMetadata()).toMatchObject({ statementFromMs: MARK_MS });

    await syncOnce();

    expect(storedMetadata()).not.toHaveProperty('statementFromMs');
    expect(gapRowCount()).toBe(1);
  });
});
