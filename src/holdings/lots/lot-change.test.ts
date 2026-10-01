import { DAY_MS } from '@kiko/dates';

import type { Lot } from './lots';
import { hasNegativeHolding, withLotChange } from './lot-change';

const january = Date.UTC(2026, 0, 10);
const february = january + 31 * DAY_MS;
const march = february + 28 * DAY_MS;
const april = march + 31 * DAY_MS;

const buy = (day: number, quantity: string, costMinorUnits: number): Lot => ({
  day,
  quantityDelta: quantity,
  costMinorUnits,
});

// A sell's cost is always worked out from the lots before it, so a caller
// passes 0 and reads the stored value back.
const sell = (day: number, quantity: string, costMinorUnits = 0): Lot => ({
  day,
  quantityDelta: `-${quantity}`,
  costMinorUnits,
});

const base: Lot[] = [buy(january, '10', 100_000), sell(march, '4', -40_000)];

describe('withLotChange', () => {
  it('works out an added sell at the average cost of the quantity held that day', () => {
    expect(withLotChange(base, { kind: 'add', lot: sell(april, '2') }, 'USD')).toEqual([
      ...base,
      sell(april, '2', -20_000),
    ]);
  });

  it('re-costs a later sell when a buy is added before it', () => {
    expect(withLotChange(base, { kind: 'add', lot: buy(february, '10', 300_000) }, 'USD')).toEqual([
      buy(january, '10', 100_000),
      sell(march, '4', -80_000),
      buy(february, '10', 300_000),
    ]);
  });

  it('keeps every sell of a list recorded in day order unchanged', () => {
    const lots = [
      buy(january, '3', 1_000),
      sell(february, '1', -333),
      buy(march, '2', 5_000),
      sell(april, '2', -2_834),
    ];

    expect(withLotChange(lots, { kind: 'add', lot: buy(april, '1', 100) }, 'USD')).toEqual([
      ...lots,
      buy(april, '1', 100),
    ]);
  });

  it('orders lots of one day by when they were recorded', () => {
    const lots = [buy(january, '10', 100_000), sell(february, '5', -50_000)];

    expect(
      withLotChange(lots, { kind: 'add', lot: buy(february, '10', 400_000) }, 'USD').at(1),
    ).toEqual(sell(february, '5', -50_000));
  });

  it('re-costs the sells after an edited buy cost', () => {
    expect(
      withLotChange(base, { kind: 'edit', index: 0, lot: buy(january, '10', 200_000) }, 'USD'),
    ).toEqual([buy(january, '10', 200_000), sell(march, '4', -80_000)]);
  });

  it('re-costs an edited sell from its new quantity', () => {
    expect(withLotChange(base, { kind: 'edit', index: 1, lot: sell(march, '5') }, 'USD')).toEqual([
      buy(january, '10', 100_000),
      sell(march, '5', -50_000),
    ]);
  });

  it('turns an edited sell into a buy with the typed cost', () => {
    expect(
      withLotChange(base, { kind: 'edit', index: 1, lot: buy(march, '4', 10_000) }, 'USD'),
    ).toEqual([buy(january, '10', 100_000), buy(march, '4', 10_000)]);
  });

  it('removes a lot and re-costs the sells after it', () => {
    const lots = [...base, buy(february, '10', 300_000)];

    expect(withLotChange(lots, { kind: 'remove', index: 2 }, 'USD')).toEqual(base);
  });

  it('spreads a zero-cost split lot over the cost basis', () => {
    const lots = [buy(january, '10', 100_000), buy(february, '30', 0)];

    expect(withLotChange(lots, { kind: 'add', lot: sell(april, '20') }, 'USD').at(2)).toEqual(
      sell(april, '20', -50_000),
    );
  });

  it('rounds a sell cost half away from zero to the currency minor unit', () => {
    const lots = [buy(january, '3', 1_000)];

    expect(withLotChange(lots, { kind: 'add', lot: sell(february, '1') }, 'USD').at(1)).toEqual(
      sell(february, '1', -333),
    );
  });

  it('throws for an index that names no lot', () => {
    expect(() => withLotChange(base, { kind: 'remove', index: 2 }, 'USD')).toThrow(
      'withLotChange: no lot at index 2',
    );
    expect(() =>
      withLotChange(base, { kind: 'edit', index: -1, lot: buy(january, '1', 1) }, 'USD'),
    ).toThrow('withLotChange: no lot at index -1');
  });
});

describe('hasNegativeHolding', () => {
  it('is false while every day holds at least zero', () => {
    expect(hasNegativeHolding([...base, sell(april, '6')])).toBe(false);
  });

  it('is true when a sell takes more than is held on its day', () => {
    expect(hasNegativeHolding([...base, sell(april, '7')])).toBe(true);
  });

  it('is true when an earlier sell leaves too little for a later one', () => {
    expect(hasNegativeHolding([...base, sell(february, '7')])).toBe(true);
  });

  it('is true when a buy a later sell needs is gone', () => {
    expect(hasNegativeHolding([sell(march, '4')])).toBe(true);
  });

  it('nets the lots of one day before checking it', () => {
    expect(hasNegativeHolding([sell(january, '2'), buy(january, '2', 100)])).toBe(false);
  });
});
