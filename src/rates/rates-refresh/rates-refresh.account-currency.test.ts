// A refresh over the real engine, with the default gate and the real rates repo: an account's own
// currency is what its card totals in, so a currency only an account names (no holding in it)
// must still get its rate or coin price fetched, and the card then shows a real total.
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
import { holdingsRepo } from '@kiko/holdings/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import type { RateEntry } from '../conversion';
import { accountTotal, buildRateTable } from '../net-worth-view';

import { type RefreshDeps, refreshRates } from './rates-refresh';

const NOW = 1_000;
const fiat: RateEntry[] = [{ base: 'USD', quote: 'UAH', rate: 40, source: 'monobank' }];
const bitcoin: RateEntry[] = [{ base: 'BTC', quote: 'USD', rate: 65_000, source: 'coingecko' }];

const makeDeps = () => {
  const fetchFiatRates = jest.fn(async () => fiat);
  const fetchCryptoPrices = jest.fn(async () => bitcoin);
  const deps: RefreshDeps = {
    fetchFiatRates,
    fetchNbuRates: async () => [],
    fetchCryptoPrices,
    binanceMarket: { currentPrice: async () => undefined, dailyCloses: async () => undefined },
    now: () => NOW,
    sleep: async () => {},
  };

  return { deps, fetchFiatRates, fetchCryptoPrices };
};

const storedRates = () =>
  buildRateTable(
    mockDatabase.prepare('SELECT base, quote, rate FROM currency_rates').all() as {
      base: 'BTC';
      quote: 'UAH';
      rate: string;
    }[],
  );

beforeEach(async () => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  await settingsRepo.ensure();
  await settingsRepo.setBaseCurrency('UAH');
});

describe('refreshRates for an account currency no holding is in', () => {
  it('fetches the coin and then totals the account in it, where it showed nothing before', async () => {
    const accountId = await accountsRepo.create({ name: 'Coins', kind: 'bank', currency: 'BTC' });
    // One UAH holding on the BTC account: 2,600,000.00 UAH is exactly 1 BTC at 65,000 USD * 40.
    await holdingsRepo.create({
      accountId,
      name: 'Savings',
      type: 'cash',
      currency: 'UAH',
      openingBalance: Money.of('UAH', 260_000_000),
    });
    const holdings = await holdingsRepo.allQuery();
    const { deps, fetchFiatRates, fetchCryptoPrices } = makeDeps();

    expect(accountTotal(holdings, 'BTC', 'UAH', storedRates(), NOW).total.minorUnits).toBe(0);

    await expect(refreshRates(deps)).resolves.toEqual({ state: 'refreshed', failedLegs: [] });

    expect(fetchCryptoPrices).toHaveBeenCalledWith(['BTC']);
    expect(fetchFiatRates).toHaveBeenCalledTimes(1);
    expect(accountTotal(holdings, 'BTC', 'UAH', storedRates(), NOW)).toMatchObject({
      total: { currency: 'BTC', minorUnits: 100_000_000 },
      inBase: { currency: 'UAH', minorUnits: 260_000_000 },
    });
  });

  it('fetches nothing for an archived account in that currency', async () => {
    const accountId = await accountsRepo.create({ name: 'Coins', kind: 'bank', currency: 'BTC' });
    mockDatabase.prepare('UPDATE accounts SET archived_at = 1 WHERE id = ?').run(accountId);
    const { deps, fetchFiatRates, fetchCryptoPrices } = makeDeps();

    await expect(refreshRates(deps)).resolves.toEqual({ state: 'skipped', failedLegs: [] });

    expect(fetchCryptoPrices).not.toHaveBeenCalled();
    expect(fetchFiatRates).not.toHaveBeenCalled();
  });
});
