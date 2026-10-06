// The close and reopen of a Monobank card or jar through the REAL repositories on a
// real, fully migrated SQLite engine: `sync.test.ts`'s in-memory doubles
// mirror the reopen by hand, so only this file proves that the real
// `closeManyBySync`, `upsertByMetadataKey` and `clearStatementFrom` agree with
// the sync. Only the network (client-info, statements), the clock, the sleep
// and the token are faked. The backup round-trip of the same state is pinned in
// `data-transfer/snapshot/restore-sync-reopen.test.ts`.
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
import statement from '@kiko/monobank/__fixtures__/statement.json';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import clientInfo from '@kiko/monobank/__fixtures__/client-info.json';

import type { MonobankAccount, MonobankJar, MonobankStatementItem } from '../monobank-types';

import { runSync } from './sync';

const FIRST_RUN_MS = 1_700_000_000_000;
const HOUR_MS = 60 * 60 * 1000;
const cardId = clientInfo.accounts[0].id;
const otherCardId = clientInfo.accounts[1].id;
const jarId = clientInfo.jars[0].id;
const allAccounts = clientInfo.accounts as MonobankAccount[];
const allJars = clientInfo.jars as MonobankJar[];
const withoutCard = allAccounts.filter((account) => account.id !== cardId);
const returnRunMs = FIRST_RUN_MS + 40 * DAY_MS + HOUR_MS;

// A purchase on the card between the close and the return, which only a
// widened statement window can reach.
const gapItem: MonobankStatementItem = {
  ...(statement[0] as MonobankStatementItem),
  id: 'gap-item',
  time: (FIRST_RUN_MS + 20 * DAY_MS) / 1000,
};

// The same for a jar: a top-up inside the gap.
const jarGapItem: MonobankStatementItem = {
  ...gapItem,
  id: 'jar-gap-item',
  amount: 300_000,
  operationAmount: 300_000,
};

const freshWorld = () => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution) VALUES ('acc-1', 'Monobank', 'bank', 'monobank')",
    )
    .run();

  const network = { accounts: allAccounts, jars: allJars };
  const fetchStatementSpy = jest.fn();
  const gapItemOf = (monobankId: string): MonobankStatementItem | undefined =>
    ({ [cardId]: gapItem, [jarId]: jarGapItem })[monobankId];

  const sync = (atMs: number) =>
    runSync({
      targetAccountId: 'acc-1',
      now: () => atMs,
      sleep: async () => undefined,
      readToken: async () => 'token',
      fetchClientInfo: async () => ({
        accounts: network.accounts,
        jars: network.jars,
      }),
      fetchStatement: async (_token, accountId, from, to) => {
        const monobankId = decodeURIComponent(accountId);
        const item = gapItemOf(monobankId);
        fetchStatementSpy(monobankId, from, to);

        return item !== undefined && item.time >= from && item.time <= to ? [item] : [];
      },
    });

  return { network, sync, fetchStatementSpy };
};

const rowOf = (monobankId: string) =>
  mockDatabase
    .prepare(
      `SELECT id, closed_at AS closedAt, metadata FROM holdings
       WHERE json_extract(metadata, '$.monobankId') = ?`,
    )
    .get(monobankId) as { id: string; closedAt: number | null; metadata: string };

const cardRow = () => rowOf(cardId);
const jarRow = () => rowOf(jarId);

const cardMetadata = (): Record<string, unknown> => JSON.parse(cardRow().metadata);
const jarMetadata = (): Record<string, unknown> => JSON.parse(jarRow().metadata);

const rowCountOf = (holdingId: string): number =>
  (
    mockDatabase
      .prepare('SELECT count(*) AS total FROM transactions WHERE holding_id = ?')
      .get(holdingId) as { total: number }
  ).total;

const gapRowCount = (): number => rowCountOf(cardRow().id);

// Run 1 stores every card; run 2, a due full fetch, does not list the card
// and so closes it. The return (run 3) is then an INCREMENTAL run.
const closeTheCard = async (world: ReturnType<typeof freshWorld>) => {
  await world.sync(FIRST_RUN_MS);
  world.network.accounts = withoutCard;
  await world.sync(FIRST_RUN_MS + 40 * DAY_MS);
};

describe('a Monobank card or jar the sync closed, then sees again', () => {
  // The per-run `[monobank sync] done` summary is not under test here.
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('closes with the full-fetch instant it read, reopens on return and imports the gap from there', async () => {
    const world = freshWorld();

    await closeTheCard(world);

    expect(cardRow().closedAt).not.toBeNull();
    expect(cardMetadata().syncClosedFromMs).toBe(FIRST_RUN_MS);

    world.network.accounts = allAccounts;
    world.fetchStatementSpy.mockClear();
    await world.sync(returnRunMs);

    expect(cardRow().closedAt).toBeNull();
    expect(cardMetadata()).not.toHaveProperty('syncClosedFromMs');
    expect(cardMetadata()).not.toHaveProperty('statementFromMs');
    expect(gapRowCount()).toBe(1);
    // The other card kept its skip: its balance never moved.
    expect(
      world.fetchStatementSpy.mock.calls.filter(([monobankId]) => monobankId === otherCardId),
    ).toHaveLength(0);
  });

  it('keeps the mark across a disconnect and reopens on the first sync after reconnecting', async () => {
    const world = freshWorld();

    await closeTheCard(world);
    await accountsRepo.disconnect('acc-1');

    expect(cardMetadata().syncClosedFromMs).toBe(FIRST_RUN_MS);

    world.network.accounts = allAccounts;
    await world.sync(returnRunMs);

    expect(cardRow().closedAt).toBeNull();
    expect(gapRowCount()).toBe(1);
  });

  it('keeps the first mark while the card stays absent across several full fetches', async () => {
    const world = freshWorld();

    await closeTheCard(world);
    await world.sync(FIRST_RUN_MS + 80 * DAY_MS);
    await world.sync(FIRST_RUN_MS + 120 * DAY_MS);

    expect(cardMetadata().syncClosedFromMs).toBe(FIRST_RUN_MS);
  });

  it('reopens a returned jar and imports its gap from the mark, like a card', async () => {
    const world = freshWorld();

    await world.sync(FIRST_RUN_MS);
    world.network.jars = [];
    await world.sync(FIRST_RUN_MS + 40 * DAY_MS);

    expect(jarRow().closedAt).not.toBeNull();
    expect(jarMetadata().syncClosedFromMs).toBe(FIRST_RUN_MS);

    world.network.jars = allJars;
    await world.sync(returnRunMs);

    expect(jarRow().closedAt).toBeNull();
    expect(jarMetadata()).not.toHaveProperty('syncClosedFromMs');
    expect(jarMetadata()).not.toHaveProperty('statementFromMs');
    expect(rowCountOf(jarRow().id)).toBe(1);
  });

  it('leaves a card the user closed while disconnected closed on reconnect', async () => {
    const world = freshWorld();

    await world.sync(FIRST_RUN_MS);
    await accountsRepo.disconnect('acc-1');
    mockDatabase.prepare('UPDATE holdings SET closed_at = 5 WHERE id = ?').run(cardRow().id);
    await world.sync(returnRunMs);

    expect(cardRow().closedAt).toBe(5);
    expect(cardMetadata()).not.toHaveProperty('statementFromMs');
  });
});
