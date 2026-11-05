// Disconnecting a Monobank account keeps the account and its holdings, so a rule that names the
// account keeps matching, and a reconnect adopts the very same holding, so the rule still wins
// the rows the sync then adds. Real repositories on a real, fully migrated engine; only the
// network, the clock, the sleep and the token are faked.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});

jest.mock('@kiko/monobank/token', () => ({ clearToken: jest.fn(async () => undefined) }));

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { runSync } from '@kiko/monobank/sync';
import statement from '@kiko/monobank/__fixtures__/statement.json';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import clientInfo from '@kiko/monobank/__fixtures__/client-info.json';
import { categoryRulesRepo } from '@kiko/categories/category-rules-repo';

import type { MonobankAccount, MonobankJar, MonobankStatementItem } from '../monobank-types';

import { disconnectMonobank } from './disconnect';

const FIRST_RUN_MS = 1_700_000_000_000;
const RECONNECT_RUN_MS = FIRST_RUN_MS + 3 * DAY_MS;
const SECOND = 1_000;
const cardId = clientInfo.accounts[0].id;

const purchaseAt = (id: string, atMs: number): MonobankStatementItem => ({
  ...(statement[0] as MonobankStatementItem),
  id,
  amount: -5_000,
  operationAmount: -5_000,
  time: atMs / SECOND,
});

const items = [
  purchaseAt('coffee', FIRST_RUN_MS + DAY_MS),
  purchaseAt('bus', RECONNECT_RUN_MS - DAY_MS),
];

const sync = (atMs: number) =>
  runSync({
    targetAccountId: 'acc-1',
    now: () => atMs,
    sleep: async () => undefined,
    readToken: async () => 'token',
    fetchClientInfo: async () => ({
      accounts: clientInfo.accounts as MonobankAccount[],
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

const holdingIdsOfAccount = (): string[] =>
  (
    mockDatabase
      .prepare("SELECT id FROM holdings WHERE account_id = 'acc-1' ORDER BY id")
      .all() as { id: string }[]
  ).map((row) => row.id);

const institutionOfAccount = (): string | null =>
  (
    mockDatabase.prepare("SELECT institution FROM accounts WHERE id = 'acc-1'").get() as {
      institution: string | null;
    }
  ).institution;

const categoryOf = (externalIdSuffix: string): string | null =>
  (
    mockDatabase
      .prepare('SELECT category FROM transactions WHERE external_id LIKE ?')
      .get(`%${externalIdSuffix}`) as { category: string | null }
  ).category;

const ACCOUNT_RULE_MATCHERS = [{ type: 'account', accountId: 'acc-1' }];

// Stronger than the stored rule, so it would win every row that rule names.
const PROBE = {
  id: null,
  category: 'travel',
  matchers: [
    { type: 'account' as const, accountId: 'acc-1' },
    { type: 'direction' as const, direction: 'expense' as const },
  ],
};

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

describe('a rule on a Monobank account that is disconnected and connected again', () => {
  it('a disconnect keeps the rule matching, and a reconnect re-adopts it', async () => {
    await sync(FIRST_RUN_MS);

    const holdingsBefore = holdingIdsOfAccount();

    expect(holdingsBefore.length).toBeGreaterThan(0);

    mockDatabase
      .prepare(
        `INSERT INTO category_rules (id, category, matchers, created_at, updated_at)
         VALUES ('account-rule', 'gifts', ?, 1, 1)`,
      )
      .run(JSON.stringify(ACCOUNT_RULE_MATCHERS));
    mockDatabase.exec(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, source)
       VALUES ('typed', '${cardHoldingId()}', -100, 1000, 'Anything', 'manual')`,
    );

    const matchingBefore = await categoryRulesRepo.countRuleRewrite(PROBE);

    expect(matchingBefore).toBeGreaterThan(0);

    await disconnectMonobank('acc-1');

    expect(institutionOfAccount()).toBeNull();
    expect(await categoryRulesRepo.countRuleRewrite(PROBE)).toBe(matchingBefore);

    await sync(RECONNECT_RUN_MS);

    expect(holdingIdsOfAccount()).toEqual(holdingsBefore);
    expect(categoryOf('bus')).toBe('gifts');
  });
});
