import { buildScreenshotDataset } from '../seed/screenshot-seed';
import { SEEDED_CATEGORIES } from '../../../src/db/__fixtures__/seeded-categories';
import { readSeedCategoryColors } from '../../../src/db/__fixtures__/seed-category-colors';

import { buildDemoSnapshot } from './build-demo-snapshot';

describe('buildDemoSnapshot', () => {
  const dataset = buildScreenshotDataset('uk');
  const snapshot = buildDemoSnapshot(dataset);

  it('is deterministic: two builds of the same dataset are deeply equal', () => {
    expect(buildDemoSnapshot(buildScreenshotDataset('uk'))).toEqual(snapshot);
  });

  it('carries every account and holding the dataset describes', () => {
    expect(snapshot.accounts).toHaveLength(dataset.accounts.length);
    expect(snapshot.holdings).toHaveLength(
      dataset.accounts.reduce((total, account) => total + account.holdings.length, 0),
    );
  });

  it('gives every holding a balance equal to the sum of its own transactions', () => {
    for (const holding of snapshot.holdings) {
      const sum = snapshot.transactions
        .filter((transaction) => transaction.holdingId === holding.id)
        .reduce((total, transaction) => total + transaction.amountMinorUnits, 0);
      expect(holding.balanceMinorUnits).toBe(sum);
    }
  });

  it('references only real parents: every holding an account, every transaction a holding', () => {
    const accountIds = new Set(snapshot.accounts.map((account) => account.id));
    const holdingIds = new Set(snapshot.holdings.map((holding) => holding.id));
    expect(snapshot.holdings.every((holding) => accountIds.has(holding.accountId))).toBe(true);
    expect(
      snapshot.transactions.every((transaction) => holdingIds.has(transaction.holdingId)),
    ).toBe(true);
  });

  it('marks every transaction manual with no external id, so no row looks synced', () => {
    expect(snapshot.transactions.every((t) => t.source === 'manual')).toBe(true);
    expect(snapshot.transactions.every((t) => t.externalId === null)).toBe(true);
  });

  it('carries the 10 default categories and an empty syncState', () => {
    expect(snapshot.categories.map((category) => category.key)).toEqual(
      SEEDED_CATEGORIES.map((category) => category.key),
    );
    expect(snapshot.syncState).toEqual([]);
    expect(snapshot.categoryOverrides).toEqual([]);
  });

  it('seeds every category color from the branded-colors migration, matching a real fresh install', () => {
    const seedColors = new Map(readSeedCategoryColors().map((seed) => [seed.key, seed.color]));

    // Mirrors 0017's own comment: `utilities` and `entertainment` are
    // intentionally left uncolored on a real fresh install too, so they fall
    // back to the same hashed `categoryColor` both here and in production.
    expect(seedColors.size).toBe(8);

    for (const category of snapshot.categories) {
      expect(category.color).toBe(seedColors.get(category.key) ?? null);
    }
  });

  it('carries one settings row with the dataset language, UAH, and the lock OFF', () => {
    expect(snapshot.settings).toHaveLength(1);
    expect(snapshot.settings[0].language).toBe('uk');
    expect(snapshot.settings[0].baseCurrency).toBe('UAH');
    // Never true: importing a locked snapshot would put a reviewer behind a
    // Face ID / passcode gate on a device that may have no biometric enrolled.
    expect(snapshot.settings[0].lockEnabled).toBe(false);
  });

  it('carries the dataset rates and history verbatim', () => {
    expect(snapshot.currencyRates).toHaveLength(dataset.rates.length);
    expect(snapshot.currencyRateHistory).toHaveLength(dataset.history.length);
  });

  it('applies the requested language to the settings row', () => {
    expect(buildDemoSnapshot(buildScreenshotDataset('en')).settings[0].language).toBe('en');
  });
});
