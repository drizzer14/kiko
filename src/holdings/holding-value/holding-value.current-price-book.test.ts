let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { sumByCurrency } from '@kiko/rates/currency-totals';
import { loanLedgerSummary } from '@kiko/holdings/loan-ledger';
import { pricePointsRepo } from '@kiko/prices/price-points-repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { buildRateTable, guardedNetWorth } from '@kiko/rates/net-worth-view';
import { buildPriceBook, dayKeyOf, localMidnightOfDayKey } from '@kiko/prices/price-book';

import { asLoanMeta } from '../holding-metadata';

import { holdingValueBreakdown, type ValuableHolding } from './holding-value';

// Every screen that reads `useCurrentPriceBook` shows a number computed from
// the book `currentQuery` builds. This proves each such number equals the one
// the whole-table book gives, on a realistic ledger of daily metal closes, a
// stale series, a series that has not started, a priced holding with no series
// at all, and manual series, on the days a local-day key is easiest to get
// wrong.
const SCENARIOS: [string, number][] = [
  ['an ordinary afternoon', new Date(2026, 8, 20, 15, 0).getTime()],
  ['Kyiv local midnight on the day DST starts', new Date(2026, 2, 29, 0, 0).getTime()],
  ['Kyiv local midnight the day after DST starts', new Date(2026, 2, 30, 0, 0).getTime()],
  ['the last hour of the day DST ends', new Date(2026, 9, 25, 23, 30).getTime()],
];

const insertPoint = (instrument: string, day: number, price: string, currency: string): void => {
  mockDatabase
    .prepare(
      `INSERT INTO price_points (instrument, day, price, currency, source)
       VALUES (?, ?, ?, ?, 'manual')`,
    )
    .run(instrument, day, price, currency);
};

const insertSeries = (
  instrument: string,
  today: number,
  firstOffset: number,
  lastOffset: number,
  currency: string,
): void => {
  for (let offset = firstOffset; offset <= lastOffset; offset += 1) {
    insertPoint(
      instrument,
      today + offset * DAY_MS,
      (100 + offset * 0.37 + (offset % 7) * 0.11).toFixed(2),
      currency,
    );
  }
};

const seedPricePoints = (today: number): void => {
  insertSeries('metal:XAG', today, -420, 0, 'UAH');
  insertSeries('metal:XPT', today, -420, -6, 'UAH');
  insertSeries('metal:XPD', today, 2, 3, 'UAH');
  insertSeries('metal:XAU', today, -400, 1, 'UAH');
  insertPoint('holding:prop-1', today - 200 * DAY_MS, '2500000', 'UAH');
  insertPoint('holding:prop-1', today - 10 * DAY_MS, '2650000', 'UAH');
  insertPoint('holding:prop-1', today + 3 * DAY_MS, '2700000', 'UAH');
  insertPoint('holding:loan-1', today - 300 * DAY_MS, '950000', 'UAH');
  insertPoint('holding:loan-1', today - 120 * DAY_MS, '880000', 'UAH');
  insertPoint('holding:loan-1', today - 3 * DAY_MS, '860000', 'UAH');
  insertPoint('holding:loan-2', today + 5 * DAY_MS, '40000', 'UAH');
  insertPoint('holding:loan-3', today - 100 * DAY_MS, '70000', 'UAH');
  insertPoint('holding:loan-3', today - 20 * DAY_MS, '55000', 'UAH');
};

const metalHolding = (
  id: string,
  metal: string,
  lots: Record<string, unknown>[],
): ValuableHolding => ({
  id,
  type: 'metal',
  currency: 'UAH',
  balanceMinorUnits: 0,
  metadata: { metal, form: 'bar', unit: 'g', purity: '1', lots },
});

const holdingsAt = (today: number): ValuableHolding[] => {
  const lots = [
    { day: today - 200 * DAY_MS, quantityDelta: '3', costMinorUnits: 90_000 },
    { day: today - 5 * DAY_MS, quantityDelta: '-1', costMinorUnits: -30_000 },
  ];
  const middayOf = (offset: number): number =>
    localMidnightOfDayKey(today) + offset * DAY_MS + 12 * 3_600_000;

  return [
    metalHolding('silver', 'XAG', lots),
    metalHolding('stale', 'XPT', lots),
    metalHolding('later', 'XPD', lots),
    {
      id: 'gold-1',
      type: 'metal',
      currency: 'UAH',
      balanceMinorUnits: 0,
      metadata: {
        metal: 'XAU',
        form: 'bar',
        unit: 'g',
        purity: '1',
        lots: [
          { day: today - 300 * DAY_MS, quantityDelta: '31.1034768', costMinorUnits: 8_500_000 },
        ],
      },
    },
    {
      id: 'prop-1',
      type: 'property_item',
      currency: 'UAH',
      balanceMinorUnits: 0,
      metadata: {
        category: 'real_estate',
        lots: [{ day: today - 400 * DAY_MS, quantityDelta: '1', costMinorUnits: 2_000_000 }],
      },
    },
    {
      id: 'prop-unpriced',
      type: 'property_item',
      currency: 'UAH',
      balanceMinorUnits: 0,
      metadata: {
        category: 'real_estate',
        lots: [{ day: today - 400 * DAY_MS, quantityDelta: '1', costMinorUnits: 1_500_000 }],
      },
    },
    {
      id: 'loan-1',
      type: 'loan',
      currency: 'UAH',
      balanceMinorUnits: 0,
      metadata: {
        kind: 'mortgage',
        principalMinorUnits: 1_000_000,
        startDate: middayOf(-400),
        annualRatePct: 12,
        termMonths: 240,
        schedule: 'annuity',
      },
    },
    {
      id: 'loan-2',
      type: 'loan',
      currency: 'UAH',
      balanceMinorUnits: 0,
      metadata: {
        kind: 'personal',
        principalMinorUnits: 50_000,
        startDate: middayOf(-500),
        schedule: 'none',
      },
    },
    {
      id: 'loan-3',
      type: 'loan',
      currency: 'UAH',
      balanceMinorUnits: 0,
      metadata: {
        kind: 'car_loan',
        principalMinorUnits: 80_000,
        startDate: middayOf(-250),
        annualRatePct: 9,
        termMonths: 36,
        schedule: 'differentiated',
      },
    },
    { id: 'cash-1', type: 'cash', currency: 'UAH', balanceMinorUnits: 12_345, metadata: null },
    {
      id: 'btc-1',
      type: 'crypto_asset',
      currency: 'BTC',
      balanceMinorUnits: 150_000,
      metadata: null,
    },
  ];
};

const loanPaymentsAt = (today: number) =>
  [90, 60, 30, 3].map((daysAgo) => ({
    loanHoldingId: 'loan-1',
    time: today - daysAgo * DAY_MS + 9 * 3_600_000,
    amountMinorUnits: -11_000,
    currency: 'UAH' as const,
  }));

const plain = (breakdown: ReturnType<typeof holdingValueBreakdown>): string[] =>
  Object.values(breakdown).map((money) => `${money.currency}:${money.minorUnits}`);

describe.each(SCENARIOS)('current price book on %s', (_label, now) => {
  const today = dayKeyOf(now);
  const rateTable = buildRateTable([
    { base: 'USD', quote: 'UAH', rate: '41.25' },
    { base: 'BTC', quote: 'UAH', rate: '2500000' },
  ]);

  let wholeBook: ReturnType<typeof buildPriceBook>;
  let currentBook: ReturnType<typeof buildPriceBook>;
  let rowsRead: { whole: number; current: number };

  beforeEach(async () => {
    mockDatabase = new DatabaseSync(':memory:');
    applyAllMigrations(mockDatabase);
    seedPricePoints(today);

    const wholeRows = await pricePointsRepo.allQuery();
    const currentRows = await pricePointsRepo.currentQuery(today);

    rowsRead = { whole: wholeRows.length, current: currentRows.length };
    wholeBook = buildPriceBook(wholeRows, loanPaymentsAt(today));
    currentBook = buildPriceBook(currentRows, loanPaymentsAt(today));
  });

  it('reads a handful of rows where the whole table has over a thousand', () => {
    expect(rowsRead.whole).toBeGreaterThan(1_000);
    expect(rowsRead.current).toBeLessThan(40);
  });

  it('gives every holding the same value breakdown at now and at the start of today', () => {
    for (const instant of [now, localMidnightOfDayKey(today)]) {
      for (const holding of holdingsAt(today)) {
        expect(plain(holdingValueBreakdown(holding, instant, currentBook))).toEqual(
          plain(holdingValueBreakdown(holding, instant, wholeBook)),
        );
      }
    }
  });

  it('gives every holding the same value on the days after today', () => {
    for (const offset of [1, 2, 3, 4, 10, 30]) {
      for (const holding of holdingsAt(today)) {
        const instant = now + offset * DAY_MS;

        expect(plain(holdingValueBreakdown(holding, instant, currentBook))).toEqual(
          plain(holdingValueBreakdown(holding, instant, wholeBook)),
        );
      }
    }
  });

  it('gives every loan and manual series the same value on days before today, which the loan ledger reads', () => {
    const directlyPriced = holdingsAt(today).filter(
      (holding) => holding.type === 'loan' || holding.type === 'property_item',
    );

    for (const offset of [-1, -2, -50, -119, -121, -200, -299, -301]) {
      for (const holding of directlyPriced) {
        const instant = now + offset * DAY_MS;

        expect(plain(holdingValueBreakdown(holding, instant, currentBook))).toEqual(
          plain(holdingValueBreakdown(holding, instant, wholeBook)),
        );
      }
    }
  });

  it('gives the same net worth and the same per-currency breakdown', () => {
    const holdings = holdingsAt(today);

    expect(guardedNetWorth(holdings, 'UAH', rateTable, now, currentBook).minorUnits).toBe(
      guardedNetWorth(holdings, 'UAH', rateTable, now, wholeBook).minorUnits,
    );
    expect(sumByCurrency(holdings, now, currentBook)).toEqual(
      sumByCurrency(holdings, now, wholeBook),
    );
  });

  // Guards the fixture itself: a book that kept only each instrument's last
  // point would change the number of a series with a point dated after today,
  // and a loan's number at a past day, so the cases above prove the current
  // book keeps what each of those reads.
  it('is exercised by a fixture on which a latest-point-only book would differ', async () => {
    const naiveBook = buildPriceBook(
      (await pricePointsRepo.allQuery()).filter(
        (row, _index, rows) =>
          row.day ===
          Math.max(
            ...rows
              .filter((other) => other.instrument === row.instrument)
              .map((other) => other.day),
          ),
      ),
      loanPaymentsAt(today),
    );
    const differingAt = (instant: number): string[] =>
      holdingsAt(today)
        .filter(
          (holding) =>
            plain(holdingValueBreakdown(holding, instant, naiveBook)).join() !==
            plain(holdingValueBreakdown(holding, instant, wholeBook)).join(),
        )
        .map((holding) => holding.id);

    expect(differingAt(now)).toEqual(expect.arrayContaining(['later', 'gold-1', 'prop-1']));
    expect(differingAt(now - 50 * DAY_MS)).toEqual(expect.arrayContaining(['loan-1', 'loan-3']));
  });

  it('gives the loan detail the same breakdown for every loan', () => {
    for (const holding of holdingsAt(today).filter((candidate) => candidate.type === 'loan')) {
      const meta = asLoanMeta(holding.metadata);

      if (meta === null) {
        throw new Error('fixture loan metadata must parse');
      }

      expect(loanLedgerSummary(meta, holding, currentBook, now)).toEqual(
        loanLedgerSummary(meta, holding, wholeBook, now),
      );
    }
  });
});
