import { Money } from '@kiko/currency/money';
import { validateIsin } from '@kiko/bonds/isin';
import { DAY_MS, defaultDateRange } from '@kiko/dates';
import { holdingValue } from '@kiko/holdings/holding-value';
import { holdingRegisterCoupons } from '@kiko/bonds/nbu-register';
import { templateNameKey } from '@kiko/transaction-templates/template-name';
import { buildRateTable, guardedNetWorth } from '@kiko/rates/net-worth-view';
import { EMPTY_DRAFT, isTemplateDraft, TEMPLATE_MODES } from '@kiko/transaction-templates/draft';

import { buildScreenshotDataset } from './screenshot-seed';

// NOTE ON THE TEST HARNESS: the Jest harness has NO op-sqlite backend (the repo
// tests mock the `write`/`database` client — op-sqlite's open() is a native
// module unavailable under Jest), so a real-DB "insert then count rows" smoke
// test is not feasible here without faking the database, which would prove
// nothing. Instead the DETERMINISM and SHAPE of the dataset are proven directly
// against the pure `buildScreenshotDataset` builder below.

const ANCHOR = Date.UTC(2026, 8, 10, 9, 0, 0);

const sumBalance = (transactions: { amountMinorUnits: number }[]): number =>
  transactions.reduce((total, transaction) => total + transaction.amountMinorUnits, 0);

type Dataset = ReturnType<typeof buildScreenshotDataset>;

const transactionsOf = (dataset: Dataset) =>
  dataset.accounts
    .flatMap((account) => account.holdings)
    .flatMap((holding) => holding.transactions);

// Every epoch-millisecond field in the dataset is a timestamp (money is minor
// units, far below 1e12), so shifting every such number moves the whole dataset.
const TIMESTAMP_FLOOR = 1e12;

const shiftTimestamps = (dataset: unknown, deltaMs: number): unknown =>
  JSON.parse(JSON.stringify(dataset), (_key, value: unknown) =>
    typeof value === 'number' && value > TIMESTAMP_FLOOR ? value + deltaMs : value,
  );

// The monthly gold quotes follow the calendar month, not a fixed day count.
const withoutGoldQuotes = (dataset: Dataset) => ({
  ...dataset,
  pricePoints: dataset.pricePoints.filter((point) => point.source !== 'nbu'),
});

const CYRILLIC = /\p{Script=Cyrillic}/u;

describe('buildScreenshotDataset (pure, deterministic)', () => {
  it('is byte-stable: two builds are deeply equal', () => {
    expect(buildScreenshotDataset('uk', ANCHOR)).toEqual(buildScreenshotDataset('uk', ANCHOR));
  });

  it('carries the language and the anchor through and pins UAH as the base currency', () => {
    expect(buildScreenshotDataset('uk', ANCHOR).language).toBe('uk');
    expect(buildScreenshotDataset('en', ANCHOR).language).toBe('en');
    expect(buildScreenshotDataset('uk', ANCHOR).anchor).toBe(ANCHOR);
    expect(buildScreenshotDataset('uk', ANCHOR).baseCurrency).toBe('UAH');
  });

  it('derives every date from the anchor: a later anchor moves the whole dataset with it', () => {
    const deltaMs = 400 * DAY_MS;

    for (const language of ['uk', 'en'] as const) {
      const base = buildScreenshotDataset(language, ANCHOR);
      const later = buildScreenshotDataset(language, ANCHOR + deltaMs);

      expect(withoutGoldQuotes(later)).toEqual(shiftTimestamps(withoutGoldQuotes(base), deltaMs));
    }
  });

  it('quotes gold once a calendar month, on the anchor day, for the ten months to the anchor', () => {
    const quoteDays = (anchor: number): string[] =>
      buildScreenshotDataset('uk', anchor)
        .pricePoints.filter((point) => point.source === 'nbu')
        .map((point) => new Date(point.day).toISOString().slice(0, 10));

    expect(quoteDays(ANCHOR)).toEqual([
      '2025-11-10',
      '2025-12-10',
      '2026-01-10',
      '2026-02-10',
      '2026-03-10',
      '2026-04-10',
      '2026-05-10',
      '2026-06-10',
      '2026-07-10',
      '2026-08-10',
      '2026-09-10',
    ]);
    // A 31st anchor clamps to the shorter months instead of rolling into the next one.
    expect(quoteDays(Date.UTC(2026, 9, 31, 9)).slice(-3)).toEqual([
      '2026-08-31',
      '2026-09-30',
      '2026-10-31',
    ]);
  });

  it('opens the default 30-day window on the anchor day with a populated ledger', () => {
    const dataset = buildScreenshotDataset('uk', Date.UTC(2026, 9, 10, 9));
    const { from, to } = defaultDateRange(dataset.anchor);
    const inWindow = transactionsOf(dataset).filter(
      (transaction) => transaction.time >= from.getTime() && transaction.time <= to.getTime(),
    );

    expect(inWindow.length).toBeGreaterThanOrEqual(10);
  });

  it('gives the English dataset no Cyrillic letter in any name or description', () => {
    expect(JSON.stringify(buildScreenshotDataset('en', ANCHOR))).not.toMatch(CYRILLIC);
  });

  it('keeps the Ukrainian names in the Ukrainian dataset', () => {
    expect(JSON.stringify(buildScreenshotDataset('uk', ANCHOR))).toMatch(CYRILLIC);
  });

  it('names the English accounts and holdings in English', () => {
    const { accounts } = buildScreenshotDataset('en', ANCHOR);

    expect(accounts.map((account) => account.name)).toEqual([
      'Monobank',
      'Cash',
      'PrivatBank',
      'Wise',
      'Binance',
      'Broker',
      'Real estate',
      'Precious metals',
      'Debts',
    ]);
    expect(accounts.flatMap((account) => account.holdings).map((holding) => holding.name)).toEqual([
      'Monobank',
      'Vacation jar',
      'Deposit',
      'Government bonds (OVDP)',
      'Cash',
      'PrivatBank',
      'Wise',
      'Binance',
      'US dollars',
      'Government bonds (OVDP)',
      'Apartment',
      'Car',
      'Gold',
      'Car loan',
      'Owed to Andrii',
    ]);
  });

  it('differs between the two languages only in names and descriptions', () => {
    const withoutText = (dataset: unknown): unknown =>
      JSON.parse(JSON.stringify(dataset), (key, value: unknown) =>
        key === 'name' || key === 'description' ? undefined : value,
      );

    expect(withoutText(buildScreenshotDataset('en', ANCHOR))).toEqual(
      withoutText({ ...buildScreenshotDataset('uk', ANCHOR), language: 'en' }),
    );
  });

  it('seeds nine plain manual accounts spread across UAH/USD/EUR/BTC', () => {
    const { accounts } = buildScreenshotDataset('uk', ANCHOR);
    const currencies = accounts.flatMap((account) =>
      account.holdings.map((holding) => holding.currency),
    );

    expect(accounts).toHaveLength(9);
    expect(new Set(currencies)).toEqual(new Set(['UAH', 'USD', 'EUR', 'BTC']));
  });

  it('spreads transactions across every one of the 10 seeded categories that it uses', () => {
    const { accounts } = buildScreenshotDataset('uk', ANCHOR);
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
    const times = transactionsOf(buildScreenshotDataset('uk', ANCHOR)).map(
      (transaction) => transaction.time,
    );

    expect(times.length).toBeGreaterThan(40);

    for (const time of times) {
      expect(time).toBeLessThan(ANCHOR);
    }

    // Determinism: the identical times come back on a rebuild.
    const rebuilt = transactionsOf(buildScreenshotDataset('uk', ANCHOR)).map(
      (transaction) => transaction.time,
    );

    expect(rebuilt).toEqual(times);
  });

  it('pins every ordered currency pair (12) at one fixed fetchedAt', () => {
    const { rates } = buildScreenshotDataset('uk', ANCHOR);
    const fetchedAts = new Set(rates.map((rate) => rate.fetchedAt));
    const requiredPairs = ['BTC:UAH', 'USD:UAH', 'EUR:UAH', 'BTC:USD', 'UAH:BTC', 'USD:BTC'];

    expect(rates).toHaveLength(12);
    expect(fetchedAts.size).toBe(1);

    for (const pair of requiredPairs) {
      expect(rates.some((rate) => `${rate.base}:${rate.quote}` === pair)).toBe(true);
    }
  });

  it('seeds rate history for each foreign:UAH pair so the net-worth line renders', () => {
    const { history } = buildScreenshotDataset('uk', ANCHOR);
    const pairs = new Set(history.map((row) => `${row.base}:${row.quote}`));

    expect(pairs).toEqual(new Set(['USD:UAH', 'EUR:UAH', 'BTC:UAH']));
    // 27 weekly points (weeks 0..26) per pair.
    expect(history).toHaveLength(3 * 27);
  });

  it('keeps the invented-ISIN bond its coupons once a register refresh drops the ISIN', () => {
    const dataset = buildScreenshotDataset('uk', ANCHOR);
    const bond = dataset.accounts
      .flatMap((account) => account.holdings)
      .find((holding) => holding.type === 'bond');
    const registerCoupons = dataset.bondRegister[0].terms.payments?.filter(
      (payment) => payment.kind === 'coupon',
    );

    expect(holdingRegisterCoupons(bond?.metadata, 'UAH', null)).toEqual(registerCoupons);
    expect(registerCoupons).toHaveLength(3);
  });

  // A reviewer who edits the demo bond must be able to save it, and the bond
  // form rejects an ISIN whose check digit fails.
  it('gives every ISIN in the dataset a valid check digit', () => {
    const dataset = buildScreenshotDataset('uk', ANCHOR);
    const isins = [
      ...dataset.accounts
        .flatMap((account) => account.holdings)
        .flatMap((holding) =>
          holding.metadata !== undefined && 'isin' in holding.metadata
            ? [holding.metadata.isin]
            : [],
        ),
      ...dataset.bondRegister.flatMap((row) => [row.isin, row.terms.isin]),
    ];

    expect(isins).toHaveLength(4);

    for (const isin of isins) {
      expect(validateIsin(isin ?? '')).toEqual({ ok: true, isin });
    }
  });

  // The reviewer reaches the Templates screen and the form's template modes only through
  // this dataset (Guideline 5.6), so it holds a template of every mode.
  describe.each(['uk', 'en'] as const)('the %s transaction templates', (language) => {
    const { accounts, templates } = buildScreenshotDataset(language, ANCHOR);
    const holdingKeys = new Set(
      accounts
        .flatMap((account) => account.holdings)
        .map((holding) => holding.key)
        .filter((key): key is string => key !== undefined),
    );

    it('holds a template of every form mode', () => {
      expect(new Set(templates.map((template) => template.draft.mode))).toEqual(
        new Set(TEMPLATE_MODES),
      );
    });

    it('gives every template a draft the app accepts, with the fields a draft has and no more', () => {
      expect(templates.length).toBeGreaterThan(0);

      for (const template of templates) {
        expect(isTemplateDraft(template.draft)).toBe(true);
        expect(Object.keys(template.draft).sort()).toEqual(Object.keys(EMPTY_DRAFT).sort());
      }
    });

    it('names every template once, ignoring case', () => {
      const names = templates.map((template) => templateNameKey(template.name));

      expect(names.every((name) => name !== '')).toBe(true);
      expect(new Set(names).size).toBe(names.length);
    });

    it('leaves the amount empty on at least one template, and fills it on another', () => {
      const amounts = templates.map((template) => template.draft.amountMinorUnits);

      expect(amounts).toContain(null);
      expect(amounts.some((amount) => amount !== null)).toBe(true);
    });

    it('points every holding slot at a keyed holding of the dataset', () => {
      const slots = templates.flatMap(({ draft }) => [
        draft.holdingId,
        draft.exchange?.destinationHoldingId ?? null,
        ...draft.returns.map((row) => row.holdingId),
      ]);

      expect(slots.some((slot) => slot !== null)).toBe(true);

      for (const slot of slots) {
        if (slot !== null) {
          expect(holdingKeys.has(slot)).toBe(true);
        }
      }
    });
  });

  it('exposes no scenario or lock dimension — one dataset, parameterized only by language and anchor', () => {
    const dataset = buildScreenshotDataset('uk', ANCHOR);
    expect(Object.keys(dataset).sort()).toEqual([
      'accounts',
      'anchor',
      'baseCurrency',
      'bondRegister',
      'history',
      'language',
      'pricePoints',
      'rates',
      'templates',
    ]);
  });

  it('produces a healthy, positive net worth in UAH from its own pinned rates', () => {
    const dataset = buildScreenshotDataset('uk', ANCHOR);
    const holdings = dataset.accounts
      .flatMap((account) => account.holdings)
      .map((holding) => ({
        id: holding.name,
        type: holding.type,
        currency: holding.currency,
        balanceMinorUnits: sumBalance(holding.transactions),
        metadata: null,
      }));
    const table = buildRateTable(dataset.rates);
    const total = guardedNetWorth(holdings, 'UAH', table, ANCHOR);

    // With the metadata left out, every holding's flat value is just its
    // summed balance, so this measures the cash ledger alone (a deposit, bond,
    // property, metal or loan holds no transactions and reads 0 here).
    for (const holding of holdings) {
      expect(holdingValue(holding, 0).minorUnits).toBe(holding.balanceMinorUnits);
    }

    // A realistic, DOWN-TO-EARTH multi-currency cash ledger: over ₴120k, under
    // ₴180k. The deterministic dataset totals ₴136,650 (₴16,450 UAH card after
    // two ₴10,400 car-loan payments + ₴6,000 jar + ₴5,500 cash + $1,220≈₴50,020
    // + €600≈₴26,700 + 0.012 BTC≈₴31,980); the bracket is tight enough to catch
    // a scale regression, loose enough to survive a single amount tweak.
    expect(total.minorUnits).toBeGreaterThan(Money.of('UAH', 12_000_000).minorUnits);
    expect(total.minorUnits).toBeLessThan(Money.of('UAH', 18_000_000).minorUnits);
  });
});
