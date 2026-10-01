import { buildPriceBook } from '@kiko/prices/price-book';
import { holdingValue } from '@kiko/holdings/holding-value';
import { isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';
import { readSeedCategoryColors } from '@kiko/db/__fixtures__/seed-category-colors';
import { SEEDED_CATEGORIES, LOAN_INTEREST_CATEGORY } from '@kiko/db/__fixtures__/seeded-categories';

import { ANCHOR, buildScreenshotDataset } from '../seed/screenshot-seed';

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

  it('links every loan payment to a loan holding, manually', () => {
    const loanIds = new Set(
      snapshot.holdings.filter((holding) => holding.type === 'loan').map((holding) => holding.id),
    );
    const linked = snapshot.transactions.filter(
      (transaction) => transaction.loanHoldingId !== null,
    );

    expect(linked.length).toBeGreaterThan(0);

    for (const transaction of linked) {
      expect(loanIds.has(transaction.loanHoldingId ?? '')).toBe(true);
      expect(transaction.loanLinkSource).toBe('manual');
    }
  });

  it('prices every holding-scoped point against a real holding', () => {
    const holdingInstruments = new Set(snapshot.holdings.map((holding) => `holding:${holding.id}`));
    const holdingPoints = snapshot.pricePoints.filter((point) =>
      point.instrument.startsWith('holding:'),
    );

    expect(holdingPoints.length).toBeGreaterThan(0);
    expect(holdingPoints.every((point) => holdingInstruments.has(point.instrument))).toBe(true);
  });

  // A holding whose metadata does not parse, or whose price is missing, reads
  // as 0 on screen: the reviewer would see the type but not the feature.
  it('values every holding with no ledger of its own through the app valuation', () => {
    const book = buildPriceBook(
      snapshot.pricePoints,
      snapshot.transactions.map((transaction) => ({
        loanHoldingId: transaction.loanHoldingId,
        time: transaction.time,
        amountMinorUnits: transaction.amountMinorUnits,
        currency: 'UAH' as const,
      })),
    );
    const ledgerless = snapshot.holdings.filter((holding) => isLedgerlessHoldingType(holding.type));

    expect(ledgerless).toHaveLength(8);

    for (const holding of ledgerless) {
      expect(holdingValue(holding, ANCHOR, book).minorUnits).not.toBe(0);
    }
  });

  it('caches the register terms of every bond added under an ISIN', () => {
    const registerIsins = new Set(snapshot.bondRegister.map((row) => row.isin));
    const bondIsins = snapshot.holdings
      .filter((holding) => holding.type === 'bond')
      .map((holding) => (holding.metadata as { isin?: string }).isin);

    expect(bondIsins.length).toBeGreaterThan(0);
    expect(bondIsins.every((isin) => isin !== undefined && registerIsins.has(isin))).toBe(true);
  });

  // A real install seeds loan_interest by its own migration; the import
  // replaces every category, so the snapshot must carry it for the linked
  // loan payment's interest to file under a named category.
  it('carries the 10 default categories plus loan interest, and an empty syncState', () => {
    expect(snapshot.categories.map((category) => category.key)).toEqual([
      ...SEEDED_CATEGORIES.map((category) => category.key),
      LOAN_INTEREST_CATEGORY.key,
    ]);
    expect(snapshot.syncState).toEqual([]);
    expect(snapshot.categoryOverrides).toEqual([]);
  });

  it('seeds every category color from the branded-colors migration, matching a real fresh install', () => {
    const seedColors = new Map(readSeedCategoryColors().map((seed) => [seed.key, seed.color]));

    // Mirrors 0017's own comment: `utilities` and `entertainment` are
    // intentionally left uncolored on a real fresh install too, so they fall
    // back to the same hashed `categoryColor` both here and in production.
    expect(seedColors.size).toBe(8);

    for (const category of snapshot.categories.slice(0, SEEDED_CATEGORIES.length)) {
      expect(category.color).toBe(seedColors.get(category.key) ?? null);
    }
  });

  // The color `0039_seed_loan_interest_category.sql` seeds on a fresh install.
  it('colors loan interest the way its own migration does', () => {
    const loanInterest = snapshot.categories.find(
      (category) => category.key === LOAN_INTEREST_CATEGORY.key,
    );

    expect(loanInterest?.color).toBe('#5E5CE6');
    expect(loanInterest?.sortOrder).toBe(SEEDED_CATEGORIES.length);
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
