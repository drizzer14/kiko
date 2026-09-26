import type { HoldingRow } from '@kiko/db';

import { holdingValue } from '../holding-value';
import { netWorth } from '../../rates/conversion';
import { buildPriceBook } from '../../prices/price-book';
import { holdingInstrument } from '../../prices/instrument';
import { sumByCurrency } from '../../rates/currency-totals';
import { buildTypeBreakdown } from '../../statistics/type-breakdown';
import { buildNetWorthSeries } from '../../statistics/net-worth-series';

// Every property saved before the ownership share existed carries no
// `ownership` key. These literals were read off the build before the share
// landed; a holding without the key must keep them on the card, the Home
// totals, the statistics bar, and the net-worth history.
const DAY = 86_400_000;
const D0 = Date.UTC(2026, 0, 1);
const D2 = D0 + 2 * DAY;

const existingProperty: Pick<
  HoldingRow,
  'id' | 'type' | 'currency' | 'balanceMinorUnits' | 'metadata'
> = {
  id: 'prop',
  type: 'property_item',
  currency: 'UAH',
  balanceMinorUnits: 0,
  metadata: {
    category: 'real_estate',
    lots: [{ day: D0, quantityDelta: '1', costMinorUnits: 1_800_000_01 }],
  },
};

const book = buildPriceBook([
  {
    instrument: holdingInstrument('prop'),
    day: D0 + DAY,
    price: '3000000.01',
    currency: 'UAH',
    source: 'manual',
  },
]);

describe('a property with no ownership key', () => {
  it('keeps its card value', () => {
    expect(holdingValue(existingProperty, D2, book).minorUnits).toBe(3_000_000_01);
  });

  it('keeps its Home totals', () => {
    expect(netWorth([existingProperty], 'UAH', {}, D2, book).minorUnits).toBe(3_000_000_01);
    expect(sumByCurrency([existingProperty], D2, book).map((money) => money.minorUnits)).toEqual([
      3_000_000_01,
    ]);
  });

  it('keeps its statistics bar', () => {
    expect(
      buildTypeBreakdown({
        holdings: [existingProperty],
        rateTable: {},
        baseCurrency: 'UAH',
        now: D2,
        book,
      }),
    ).toEqual([{ type: 'property_item', amount: 3_000_000_01 }]);
  });

  it('keeps its net-worth history', () => {
    const series = buildNetWorthSeries({
      holdings: [existingProperty],
      transactionsByHolding: new Map(),
      historyRows: [],
      baseCurrency: 'UAH',
      range: { from: D0, to: D2 },
      book,
    });

    expect(series.points.map((point) => point.amount)).toEqual([
      3_000_000.01, 3_000_000.01, 3_000_000.01,
    ]);
  });
});
