// The one-write create finds or inserts the live implicit account and inserts
// the holding in the same transaction. The find, the sort slot and the
// rollback are SQL behaviours, so only a real engine shows them; the fake
// handle in `accounts.repo.test.ts` answers every query with a canned row.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { accountsRepo } from './accounts.repo';

type AccountRecord = {
  id: string;
  name: string;
  kind: string;
  icon: string | null;
  color: string | null;
  institution: string | null;
  bank_id: string | null;
  sort_order: number;
  archived_at: number | null;
};

const run = (statement: string, ...parameters: (string | number | null)[]): void => {
  mockDatabase.prepare(statement).run(...parameters);
};

const seedAccount = (
  accountId: string,
  kind: string,
  sortOrder: number,
  archivedAt: number | null = null,
): void => {
  run(
    'INSERT INTO accounts (id, name, kind, sort_order, archived_at) VALUES (?, ?, ?, ?, ?)',
    accountId,
    accountId,
    kind,
    sortOrder,
    archivedAt,
  );
};

const accountsOfKind = (kind: string): AccountRecord[] =>
  mockDatabase
    .prepare('SELECT * FROM accounts WHERE kind = ? ORDER BY sort_order, id')
    .all(kind) as AccountRecord[];

const liveAccountsOfKind = (kind: string): AccountRecord[] =>
  accountsOfKind(kind).filter((account) => account.archived_at === null);

const count = (table: string): number =>
  (mockDatabase.prepare(`SELECT count(*) AS value FROM ${table}`).get() as { value: number }).value;

const sortOrderOf = (accountId: string): number =>
  (
    mockDatabase
      .prepare('SELECT sort_order AS value FROM accounts WHERE id = ?')
      .get(accountId) as {
      value: number;
    }
  ).value;

const flat = { name: 'Flat', type: 'property_item', currency: 'USD' } as const;
const mortgage = { name: 'Mortgage', type: 'loan', currency: 'USD' } as const;

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
});

describe('accountsRepo.createImplicitHolding', () => {
  it('the first property create makes the sentinel account and the holding in it', async () => {
    const { accountId, holdingId } = await accountsRepo.createImplicitHolding('property', flat);

    expect(accountsOfKind('property')).toEqual([
      {
        id: accountId,
        name: 'Properties',
        kind: 'property',
        icon: null,
        color: null,
        institution: null,
        bank_id: null,
        sort_order: 0,
        archived_at: null,
        created_at: expect.any(Number),
      },
    ]);
    expect(
      mockDatabase.prepare('SELECT account_id, name FROM holdings WHERE id = ?').get(holdingId),
    ).toEqual({ account_id: accountId, name: 'Flat' });
  });

  it('a second property create reuses the live account and appends its holding', async () => {
    const first = await accountsRepo.createImplicitHolding('property', flat);
    const second = await accountsRepo.createImplicitHolding('property', {
      ...flat,
      name: 'Garage',
    });

    expect(second.accountId).toBe(first.accountId);
    expect(liveAccountsOfKind('property')).toHaveLength(1);
    expect(
      mockDatabase
        .prepare('SELECT name, sort_order FROM holdings WHERE account_id = ? ORDER BY sort_order')
        .all(first.accountId),
    ).toEqual([
      { name: 'Flat', sort_order: 0 },
      { name: 'Garage', sort_order: 1 },
    ]);
  });

  it('the first property account sorts before every debt account and shifts them up', async () => {
    seedAccount('bank', 'bank', 0);
    seedAccount('loan-account', 'debt', 1);

    const { accountId } = await accountsRepo.createImplicitHolding('property', flat);

    expect(sortOrderOf('bank')).toBe(0);
    expect(sortOrderOf(accountId)).toBe(1);
    expect(sortOrderOf('loan-account')).toBe(2);
  });

  it('the first debt account appends after every account, archived rows included', async () => {
    seedAccount('bank', 'bank', 0);
    seedAccount('old-cash', 'cash', 5, 1);

    const { accountId } = await accountsRepo.createImplicitHolding('debt', mortgage);

    expect(accountsOfKind('debt')).toEqual([
      expect.objectContaining({
        id: accountId,
        name: 'Loans',
        icon: null,
        color: null,
        sort_order: 6,
      }),
    ]);
  });

  it('a debt account appends after an archived debt account too, not just after the assets', async () => {
    seedAccount('bank', 'bank', 1);
    seedAccount('archived-debt', 'debt', 4, 1);

    const { accountId } = await accountsRepo.createImplicitHolding('debt', mortgage);

    expect(sortOrderOf(accountId)).toBe(5);
    expect(sortOrderOf('archived-debt')).toBe(4);
  });

  it('never reuses an archived property account, and creates a live one beside it', async () => {
    seedAccount('archived-property', 'property', 0, 1);

    const { accountId } = await accountsRepo.createImplicitHolding('property', flat);

    expect(accountId).not.toBe('archived-property');
    expect(accountsOfKind('property')).toHaveLength(2);
    expect(liveAccountsOfKind('property').map((account) => account.id)).toEqual([accountId]);
    expect(
      mockDatabase
        .prepare('SELECT count(*) AS value FROM holdings WHERE account_id = ?')
        .get('archived-property'),
    ).toEqual({ value: 0 });
  });

  it('reuses the live property account that sits beside an archived one', async () => {
    seedAccount('archived-property', 'property', 0, 1);
    seedAccount('live-property', 'property', 1);

    const { accountId } = await accountsRepo.createImplicitHolding('property', flat);

    expect(accountId).toBe('live-property');
    expect(accountsOfKind('property')).toHaveLength(2);
  });

  it('keeps the property and debt accounts apart', async () => {
    const property = await accountsRepo.createImplicitHolding('property', flat);
    const debt = await accountsRepo.createImplicitHolding('debt', mortgage);

    expect(debt.accountId).not.toBe(property.accountId);
    expect(liveAccountsOfKind('property')).toHaveLength(1);
    expect(liveAccountsOfKind('debt')).toHaveLength(1);
  });

  it('a rejected holding rolls the account insert back, leaving no empty implicit account', async () => {
    await expect(
      accountsRepo.createImplicitHolding('property', {
        name: 'Wallet',
        type: 'cash',
        currency: 'BTC',
      }),
    ).rejects.toThrow('a cash holding cannot hold BTC');

    expect(count('accounts')).toBe(0);
    expect(count('holdings')).toBe(0);
  });
});

describe('accountsRepo.create', () => {
  it('refuses a property account, which is implicit', async () => {
    await expect(accountsRepo.create({ name: 'Flats', kind: 'property' })).rejects.toThrow(
      'accountsRepo.create: a property/debt account is implicit; use createImplicitHolding',
    );
    expect(count('accounts')).toBe(0);
  });

  it('refuses a debt account, which is implicit', async () => {
    await expect(accountsRepo.create({ name: 'Loans', kind: 'debt' })).rejects.toThrow(
      'accountsRepo.create: a property/debt account is implicit; use createImplicitHolding',
    );
    expect(count('accounts')).toBe(0);
  });

  it('still creates an account of every other kind', async () => {
    const accountId = await accountsRepo.create({ name: 'Wallet', kind: 'cash' });

    expect(accountsOfKind('cash').map((account) => account.id)).toEqual([accountId]);
  });
});
