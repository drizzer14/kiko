import { holdingValue } from '../holding-value';
import type { HoldingRow } from '../../db/schema';
import { buildPriceBook } from '../../prices/price-book';
import { holdingInstrument } from '../../prices/instrument';
import { buildNetWorthSeries } from '../../statistics/net-worth-series';

import {
  withoutOwnershipChange,
  withEditedOwnershipChange,
  type OwnershipChange,
} from './ownership';

const DAY = 86_400_000;
const D0 = Date.UTC(2026, 0, 1);
const D1 = D0 + DAY;
const D2 = D0 + 2 * DAY;

type PricedRow = Pick<HoldingRow, 'id' | 'type' | 'currency' | 'balanceMinorUnits' | 'metadata'>;

const propertyWith = (ownership: OwnershipChange[]): PricedRow => ({
  id: 'prop',
  type: 'property_item',
  currency: 'UAH',
  balanceMinorUnits: 0,
  metadata: {
    category: 'real_estate',
    lots: [{ day: D0, quantityDelta: '1', costMinorUnits: 20_000_00 }],
    ...(ownership.length === 0 ? {} : { ownership, ownershipInput: 'percent' }),
  },
});

const book = buildPriceBook([
  {
    instrument: holdingInstrument('prop'),
    day: D0,
    price: '20000',
    currency: 'UAH',
    source: 'manual',
  },
]);

const seriesOf = (holding: PricedRow): number[] =>
  buildNetWorthSeries({
    holdings: [holding],
    transactionsByHolding: new Map(),
    historyRows: [],
    baseCurrency: 'UAH',
    range: { from: D0, to: D2 },
    book,
  }).points.map((point) => point.amount);

const history: OwnershipChange[] = [
  { day: D0, numerator: 1, denominator: 1 },
  { day: D1, numerator: 1, denominator: 2 },
];

describe('an edited ownership history', () => {
  it('moves the net-worth step to the edited day and share', () => {
    const edited = withEditedOwnershipChange(history, D1, {
      day: D2,
      numerator: 1,
      denominator: 4,
    });

    expect(seriesOf(propertyWith(history))).toEqual([20000, 10000, 10000]);
    expect(seriesOf(propertyWith(edited))).toEqual([20000, 20000, 5000]);
    expect(holdingValue(propertyWith(edited), D2, book).minorUnits).toBe(5_000_00);
  });

  it('values the whole asset again once the last change is deleted', () => {
    const halved = [{ day: D0, numerator: 1, denominator: 2 }];
    const remaining = withoutOwnershipChange(halved, D0);

    expect(holdingValue(propertyWith(halved), D2, book).minorUnits).toBe(10_000_00);
    expect(holdingValue(propertyWith(remaining), D2, book).minorUnits).toBe(20_000_00);
    expect(seriesOf(propertyWith(remaining))).toEqual([20000, 20000, 20000]);
  });
});
