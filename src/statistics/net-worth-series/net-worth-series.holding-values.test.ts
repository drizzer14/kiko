import { DAY_MS } from '@kiko/dates';
import { toMajor } from '@kiko/currency/money';
import { buildPriceBook } from '@kiko/prices/price-book';
import { holdingInstrument } from '@kiko/prices/instrument';
import type { CurrencyRateHistoryRow, HoldingRow } from '@kiko/db';

import type { SeriesHolding } from '../holding-value-at';

import { buildHoldingValues, buildNetWorthSeries } from '.';

const HOUR = 3_600_000;
const D0 = Date.UTC(2026, 0, 1);
const D1 = D0 + DAY_MS;
const D2 = D0 + 2 * DAY_MS;
const D3 = D0 + 3 * DAY_MS;
const INSTANTS = [D0, D1, D2, D3];

type HistoryRow = Pick<CurrencyRateHistoryRow, 'base' | 'quote' | 'day' | 'rate'>;

const holding = (over: Partial<HoldingRow> & Pick<HoldingRow, 'id'>): SeriesHolding => ({
  currency: 'UAH',
  type: 'cash',
  balanceMinorUnits: 0,
  metadata: null,
  closedAt: null,
  ...over,
});

const usdRow = (day: number, rate: string): HistoryRow => ({
  base: 'USD',
  quote: 'UAH',
  day,
  rate,
});

const USD = holding({ id: 'usd', currency: 'USD', balanceMinorUnits: 10_000 });
const CARD = holding({ id: 'card', type: 'card', balanceMinorUnits: 400_000 });
const BOND = holding({
  id: 'bond',
  type: 'bond',
  metadata: {
    quantity: 1,
    faceValueMinorUnits: 100_000,
    couponPct: 0,
    couponFrequency: 'annually',
    bondKind: 'government',
    purchaseDate: D1,
    purchasePriceMinorUnits: 95_000,
    maturityDate: Date.UTC(2027, 0, 1),
  },
});
const CLOSED = holding({
  id: 'closed',
  currency: 'USD',
  balanceMinorUnits: 5_000,
  closedAt: D2 + HOUR,
});
const LOAN = holding({
  id: 'loan',
  type: 'loan',
  metadata: {
    kind: 'personal',
    principalMinorUnits: 100_000_00,
    startDate: D0,
    schedule: 'none',
  },
});
const UNRATED_CRYPTO = holding({ id: 'btc', currency: 'BTC', balanceMinorUnits: 100_000_000 });

const HOLDINGS = [USD, CARD, BOND, CLOSED, LOAN, UNRATED_CRYPTO];

const TRANSACTIONS = new Map([
  ['usd', [{ time: D1 + 2 * HOUR, amountMinorUnits: 2_000 }]],
  ['card', [{ time: D1 + HOUR, amountMinorUnits: -95_000 }]],
]);

const BOOK = buildPriceBook([
  {
    instrument: holdingInstrument('loan'),
    day: D0,
    price: '100000',
    currency: 'UAH',
    source: 'manual',
  },
]);

const HISTORY = [usdRow(D0, '30'), usdRow(D1, '31'), usdRow(D2, '32')];

const world = {
  holdings: HOLDINGS,
  transactionsByHolding: TRANSACTIONS,
  historyRows: HISTORY,
  baseCurrency: 'UAH',
  liveRateTable: { USD: 41 },
  today: D3,
  book: BOOK,
} as const;

const valuesOf = (): ReturnType<typeof buildHoldingValues> =>
  buildHoldingValues({ ...world, holdings: [...HOLDINGS], instants: INSTANTS });

const byHoldingAt = (
  values: ReturnType<typeof buildHoldingValues>,
  t: number,
): Map<string, number> => {
  const found = values.find((entry) => entry.t === t);

  if (found === undefined) {
    throw new Error(`no instant ${t}`);
  }

  return found.byHolding;
};

describe('buildHoldingValues', () => {
  it('returns one entry per instant, in the order given', () => {
    expect(valuesOf().map((entry) => entry.t)).toEqual(INSTANTS);
  });

  it.each(INSTANTS)(
    'sums to the net worth line of a one-instant range at %s, through toMajor',
    (t) => {
      const total = [...byHoldingAt(valuesOf(), t).values()].reduce((sum, value) => sum + value, 0);
      const line = buildNetWorthSeries({
        ...world,
        holdings: [...HOLDINGS],
        range: { from: t, to: t },
      });

      expect(line.points).toHaveLength(1);
      expect(toMajor(total, 'UAH')).toBe(line.points[0].amount);
    },
  );

  it('values each holding in base minor units at the rate of its own day', () => {
    const values = valuesOf();

    // An instant reads the end of its local day, so the +$20.00 row of day 1 counts from day 1.
    expect(byHoldingAt(values, D0).get('usd')).toBe(8_000 * 30);
    expect(byHoldingAt(values, D1).get('usd')).toBe(10_000 * 31);
    expect(byHoldingAt(values, D2).get('usd')).toBe(10_000 * 32);
  });

  it("values today's instant at the live table", () => {
    expect(byHoldingAt(valuesOf(), D3).get('usd')).toBe(10_000 * 41);
  });

  it('carries a loan as a negative value', () => {
    expect(byHoldingAt(valuesOf(), D0).get('loan')).toBe(-100_000_00);
  });

  it('leaves out a holding with no rate at the instant', () => {
    for (const entry of valuesOf()) {
      expect(entry.byHolding.has('btc')).toBe(false);
    }
  });

  it('is absent or zero for a closed holding at and after its closedAt, and valued before it', () => {
    const values = valuesOf();

    expect(byHoldingAt(values, D2).get('closed')).toBe(5_000 * 32);
    expect(byHoldingAt(values, D3).get('closed') ?? 0).toBe(0);
  });

  it('values a closed holding at the instant it closed as zero, never earlier', () => {
    const [atClose] = buildHoldingValues({
      ...world,
      holdings: [...HOLDINGS],
      instants: [D2 + HOUR],
    });

    expect(atClose.byHolding.get('closed') ?? 0).toBe(0);
  });

  it('gives an empty list when no history is stored and a holding is foreign', () => {
    expect(
      buildHoldingValues({ ...world, historyRows: [], holdings: [USD, CARD], instants: INSTANTS }),
    ).toEqual([]);
  });

  it('gives an empty list when there are no holdings', () => {
    expect(buildHoldingValues({ ...world, holdings: [], instants: INSTANTS })).toEqual([]);
  });

  it('still values a base-currency-only world that has no history', () => {
    const values = buildHoldingValues({
      ...world,
      historyRows: [],
      holdings: [CARD],
      instants: [D0],
    });

    expect(values).toHaveLength(1);
    expect(values[0].byHolding.get('card')).toBe(400_000 + 95_000);
  });
});
