// The currency an account stores is written by its own insert or update, read from the real
// engine: the column default would hide a path that forgot it, and the fake handle in
// `accounts.repo.test.ts` answers every query with a canned row.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { Money } from '@kiko/currency/money';
import { settingsRepo } from '@kiko/settings';
import { holdingsRepo } from '@kiko/holdings/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { accountsRepo } from './accounts.repo';

const currenciesByName = (): Record<string, string> =>
  Object.fromEntries(
    (
      mockDatabase.prepare('SELECT name, currency FROM accounts ORDER BY name').all() as {
        name: string;
        currency: string;
      }[]
    ).map(({ name, currency }) => [name, currency]),
  );

const currencyOf = (accountId: string): string =>
  (
    mockDatabase.prepare('SELECT currency FROM accounts WHERE id = ?').get(accountId) as {
      currency: string;
    }
  ).currency;

beforeEach(async () => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  await settingsRepo.ensure();
  await settingsRepo.setBaseCurrency('USD');
});

describe('the currency an account write stores', () => {
  it('a cash account stores its cash pick, not the base', async () => {
    await accountsRepo.createCashAccount({
      name: 'Wallet',
      currency: 'EUR',
      initialBalance: Money.of('EUR', 0),
    });

    expect(currenciesByName()).toEqual({ Wallet: 'EUR' });
  });

  it('a Connect insert stores the input currency', async () => {
    await accountsRepo.createIfAbsent({
      id: 'connected',
      name: 'Mono',
      kind: 'bank',
      currency: 'EUR',
    });

    expect(currencyOf('connected')).toBe('EUR');
  });

  it('a plain create stores the input currency', async () => {
    const accountId = await accountsRepo.create({ name: 'Savings', kind: 'bank', currency: 'GBP' });

    expect(currencyOf(accountId)).toBe('GBP');
  });

  it('a Save that inserts stores the input currency', async () => {
    await accountsRepo.saveFormAccount({
      id: 'fresh',
      name: 'Bank',
      kind: 'bank',
      currency: 'EUR',
    });

    expect(currencyOf('fresh')).toBe('EUR');
  });

  it('a Save after a Connect keeps the pick made in between', async () => {
    await accountsRepo.createIfAbsent({
      id: 'connected',
      name: 'Mono',
      kind: 'bank',
      currency: 'USD',
    });
    await accountsRepo.saveFormAccount({
      id: 'connected',
      name: 'Mono',
      kind: 'bank',
      currency: 'EUR',
    });

    expect(currencyOf('connected')).toBe('EUR');
  });

  it('a Connect insert with no currency takes the base currency read in the write', async () => {
    await accountsRepo.createIfAbsent({
      id: 'connected',
      name: 'Mono',
      kind: 'bank',
      currency: null,
    });

    expect(currencyOf('connected')).toBe('USD');
  });

  it('a plain create with no currency takes the base currency read in the write', async () => {
    const accountId = await accountsRepo.create({ name: 'Savings', kind: 'bank', currency: null });

    expect(currencyOf(accountId)).toBe('USD');
  });

  it('a Save that inserts with no currency takes the base currency read in the write', async () => {
    await accountsRepo.saveFormAccount({ id: 'fresh', name: 'Bank', kind: 'bank', currency: null });

    expect(currencyOf('fresh')).toBe('USD');
  });

  it('an insert with no currency stores the base changed since the form opened', async () => {
    await settingsRepo.setBaseCurrency('EUR');

    await accountsRepo.saveFormAccount({ id: 'fresh', name: 'Bank', kind: 'bank', currency: null });

    expect(currencyOf('fresh')).toBe('EUR');
  });

  it('a Save with no currency keeps the currency a Connect stored when the base changed after it', async () => {
    await accountsRepo.createIfAbsent({
      id: 'connected',
      name: 'Mono',
      kind: 'bank',
      currency: null,
    });
    await settingsRepo.setBaseCurrency('EUR');

    await accountsRepo.saveFormAccount({
      id: 'connected',
      name: 'Renamed',
      kind: 'bank',
      currency: null,
    });

    expect(currencyOf('connected')).toBe('USD');
    expect(currenciesByName()).toEqual({ Renamed: 'USD' });
  });

  it('the first property holding creates its account in the base currency read in the write', async () => {
    const { accountId } = await accountsRepo.createImplicitHolding('property', {
      name: 'Flat',
      type: 'property_item',
      currency: 'EUR',
    });

    expect(currencyOf(accountId)).toBe('USD');
  });

  it('an implicit account falls back to UAH when no settings row is stored', async () => {
    mockDatabase.exec('DELETE FROM settings');

    const { accountId } = await accountsRepo.createImplicitHolding('debt', {
      name: 'Mortgage',
      type: 'loan',
      currency: 'EUR',
    });

    expect(currencyOf(accountId)).toBe('UAH');
  });

  it('a base-currency change and a holding in another currency leave every stored currency', async () => {
    const bankId = await accountsRepo.create({ name: 'Bank', kind: 'bank', currency: 'EUR' });
    const { accountId: propertyId } = await accountsRepo.createImplicitHolding('property', {
      name: 'Flat',
      type: 'property_item',
      currency: 'EUR',
    });

    await settingsRepo.setBaseCurrency('UAH');
    await holdingsRepo.create({
      accountId: bankId,
      name: 'Pounds',
      type: 'cash',
      currency: 'GBP',
    });

    expect(currencyOf(bankId)).toBe('EUR');
    expect(currencyOf(propertyId)).toBe('USD');
  });
});
