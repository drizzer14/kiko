// The gate over the real engine, with no repo mocked: which stored accounts and holdings make a
// currency worth a rate or coin-price fetch. The fake handle in `open-currencies-gate.test.ts`
// answers each query with canned rows, so it cannot show an archived account dropping out.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { Money } from '@kiko/currency/money';
import { settingsRepo } from '@kiko/settings';
import { accountsRepo } from '@kiko/accounts';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { openCurrencies } from './open-currencies-gate';

const archive = (accountId: string): void => {
  mockDatabase.prepare('UPDATE accounts SET archived_at = 1 WHERE id = ?').run(accountId);
};

beforeEach(async () => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  await settingsRepo.ensure();
  await settingsRepo.setBaseCurrency('UAH');
});

describe('openCurrencies over stored accounts and holdings', () => {
  it('asks for the coin of a property account set to BTC that holds no BTC', async () => {
    const { accountId } = await accountsRepo.createImplicitHolding('property', {
      name: 'Flat',
      type: 'property_item',
      currency: 'UAH',
    });
    await accountsRepo.update(accountId, { name: 'Property', color: null, currency: 'BTC' });

    await expect(openCurrencies()).resolves.toEqual({
      needsFiat: true,
      cryptoCurrencies: ['BTC'],
      nonBaseCurrencies: ['BTC'],
    });
  });

  it('asks for the fiat rate of a bank account set to EUR that only holds UAH', async () => {
    await accountsRepo.create({ name: 'Bank', kind: 'bank', currency: 'EUR' });
    await accountsRepo.createCashAccount({
      name: 'Wallet',
      currency: 'UAH',
      initialBalance: Money.of('UAH', 100),
    });

    await expect(openCurrencies()).resolves.toEqual({
      needsFiat: true,
      cryptoCurrencies: [],
      nonBaseCurrencies: ['EUR'],
    });
  });

  it('does not ask for the currency of an archived account', async () => {
    const bankId = await accountsRepo.create({ name: 'Bank', kind: 'bank', currency: 'EUR' });
    const cryptoId = await accountsRepo.create({ name: 'Coins', kind: 'crypto', currency: 'BTC' });
    archive(bankId);
    archive(cryptoId);

    await expect(openCurrencies()).resolves.toEqual({
      needsFiat: false,
      cryptoCurrencies: [],
      nonBaseCurrencies: [],
    });
  });

  it('keeps a held currency and lists one shared with an account once', async () => {
    await accountsRepo.create({ name: 'Bank', kind: 'bank', currency: 'USD' });
    await accountsRepo.createCashAccount({
      name: 'Dollars',
      currency: 'USD',
      initialBalance: Money.of('USD', 100),
    });
    await accountsRepo.create({ name: 'Other', kind: 'bank', currency: 'USD' });

    await expect(openCurrencies()).resolves.toEqual({
      needsFiat: true,
      cryptoCurrencies: [],
      nonBaseCurrencies: ['USD'],
    });
  });
});
