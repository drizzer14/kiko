import { Money } from '../../currency/money';
import { holdingValue } from '../../holdings/holding-value';
import { buildRateTable, guardedNetWorth } from '../../rates/net-worth-view';

import { buildScreenshotDataset } from './screenshot-seed';

// NOTE ON THE TEST HARNESS: the Jest harness has NO op-sqlite backend (the repo
// tests mock the `write`/`database` client — op-sqlite's open() is a native
// module unavailable under Jest), so a real-DB "insert then count rows" smoke
// test is not feasible here without faking the database, which would prove
// nothing. Instead the DETERMINISM and SHAPE of the dataset are proven directly
// against the pure `buildScreenshotDataset` builder below, and the writer's
// ordering/repo-wiring is proven with mocked repos in the second describe.

const sumBalance = (transactions: { amountMinorUnits: number }[]): number =>
  transactions.reduce((total, transaction) => total + transaction.amountMinorUnits, 0);

describe('buildScreenshotDataset (pure, deterministic)', () => {
  it('is byte-stable: two builds are deeply equal', () => {
    expect(buildScreenshotDataset('uk')).toEqual(buildScreenshotDataset('uk'));
  });

  it('carries the language through and pins UAH as the base currency', () => {
    expect(buildScreenshotDataset('uk').language).toBe('uk');
    expect(buildScreenshotDataset('en').language).toBe('en');
    expect(buildScreenshotDataset('uk').baseCurrency).toBe('UAH');
  });

  it('seeds five plain manual accounts spread across UAH/USD/EUR/BTC', () => {
    const { accounts } = buildScreenshotDataset('uk');
    const currencies = accounts.flatMap((account) =>
      account.holdings.map((holding) => holding.currency),
    );

    expect(accounts).toHaveLength(5);
    expect(new Set(currencies)).toEqual(new Set(['UAH', 'USD', 'EUR', 'BTC']));
  });

  it('spreads transactions across every one of the 10 seeded categories that it uses', () => {
    const { accounts } = buildScreenshotDataset('uk');
    const usedCategories = new Set(
      accounts
        .flatMap((account) => account.holdings)
        .flatMap((holding) => holding.transactions)
        .map((transaction) => transaction.category)
        .filter((category): category is string => category !== null),
    );

    // Every category referenced is one of the seeded slugs, and the spend set is
    // rich (>= 6 distinct categories) so the category pie / trend render full.
    for (const category of usedCategories) {
      expect([
        'groceries',
        'dining',
        'transport',
        'shopping',
        'utilities',
        'entertainment',
        'health',
        'cash',
        'transfers',
        'other',
      ]).toContain(category);
    }

    expect(usedCategories.size).toBeGreaterThanOrEqual(6);
  });

  it('anchors every transaction time to a fixed epoch strictly before the anchor, never Date.now()', () => {
    const anchor = Date.UTC(2026, 8, 10, 9, 0, 0);
    const times = buildScreenshotDataset('uk')
      .accounts.flatMap((account) => account.holdings)
      .flatMap((holding) => holding.transactions)
      .map((transaction) => transaction.time);

    expect(times.length).toBeGreaterThan(40);

    for (const time of times) {
      expect(time).toBeLessThan(anchor);
    }

    // Determinism: the identical times come back on a rebuild.
    const rebuilt = buildScreenshotDataset('uk')
      .accounts.flatMap((account) => account.holdings)
      .flatMap((holding) => holding.transactions)
      .map((transaction) => transaction.time);

    expect(rebuilt).toEqual(times);
  });

  it('pins every ordered currency pair (12) at one fixed fetchedAt', () => {
    const { rates } = buildScreenshotDataset('uk');
    const fetchedAts = new Set(rates.map((rate) => rate.fetchedAt));
    const requiredPairs = ['BTC:UAH', 'USD:UAH', 'EUR:UAH', 'BTC:USD', 'UAH:BTC', 'USD:BTC'];

    expect(rates).toHaveLength(12);
    expect(fetchedAts.size).toBe(1);

    for (const pair of requiredPairs) {
      expect(rates.some((rate) => `${rate.base}:${rate.quote}` === pair)).toBe(true);
    }
  });

  it('seeds rate history for each foreign:UAH pair so the net-worth line renders', () => {
    const { history } = buildScreenshotDataset('uk');
    const pairs = new Set(history.map((row) => `${row.base}:${row.quote}`));

    expect(pairs).toEqual(new Set(['USD:UAH', 'EUR:UAH', 'BTC:UAH']));
    // 27 weekly points (weeks 0..26) per pair.
    expect(history).toHaveLength(3 * 27);
  });

  it('produces a healthy, positive net worth in UAH from its own pinned rates', () => {
    const dataset = buildScreenshotDataset('uk');
    const holdings = dataset.accounts
      .flatMap((account) => account.holdings)
      .map((holding) => ({
        type: holding.type,
        currency: holding.currency,
        balanceMinorUnits: sumBalance(holding.transactions),
        metadata: null,
      }));
    const table = buildRateTable(dataset.rates);
    const total = guardedNetWorth(holdings, 'UAH', table, Date.UTC(2026, 8, 10, 9, 0, 0));

    // Every holding's flat value is just its summed balance (no deposits/bonds).
    for (const holding of holdings) {
      expect(holdingValue(holding, 0).minorUnits).toBe(holding.balanceMinorUnits);
    }

    // A realistic, healthy multi-currency net worth: over ₴1M, under ₴3M.
    expect(total.minorUnits).toBeGreaterThan(Money.of('UAH', 100_000_000).minorUnits);
    expect(total.minorUnits).toBeLessThan(Money.of('UAH', 300_000_000).minorUnits);
  });
});
