import { startOfLocalDay } from '../dates/local-day';
import type { BondMeta } from '../holdings/holding-metadata';

import { effectiveBondPurchaseDay } from './effective-bond-purchase-day';
import type { SeriesHolding, SeriesTransaction } from './holding-value-at';

const DAY = 86_400_000;
const HOUR = 3_600_000;

const bondMeta = (over: Partial<BondMeta> = {}): BondMeta => ({
  quantity: 1,
  faceValueMinorUnits: 10_000,
  couponPct: 0,
  couponFrequency: 'annually',
  bondKind: 'government',
  purchaseDate: startOfLocalDay(Date.UTC(2026, 0, 10, 12)),
  purchasePriceMinorUnits: 10_787,
  maturityDate: Date.UTC(2027, 0, 1),
  ...over,
});

const cardHolding = (id: string, currency: SeriesHolding['currency']): SeriesHolding => ({
  id,
  currency,
  type: 'card',
  balanceMinorUnits: 0,
  metadata: null,
});

const tx = (time: number, amountMinorUnits: number): SeriesTransaction => ({
  time,
  amountMinorUnits,
});

describe('effectiveBondPurchaseDay', () => {
  it('recognizes cost from the funding debit’s day, not the typed purchase day', () => {
    const meta = bondMeta();
    const debitDay = startOfLocalDay(meta.purchaseDate) - 2 * DAY; // funded two days earlier
    const holdings = [cardHolding('card', 'USD')];
    const txByHolding = new Map([
      ['card', [tx(debitDay + 7 * HOUR, -meta.purchasePriceMinorUnits)]],
    ]);

    expect(effectiveBondPurchaseDay(meta, 'USD', holdings, txByHolding)).toBe(debitDay);
  });

  it('picks the debit whose day is nearest the typed purchase day when several match', () => {
    const meta = bondMeta();
    const typedDay = startOfLocalDay(meta.purchaseDate);
    const near = typedDay - DAY;
    const far = typedDay - 5 * DAY;
    const holdings = [cardHolding('card', 'USD')];
    const txByHolding = new Map([
      [
        'card',
        [
          tx(far + 7 * HOUR, -meta.purchasePriceMinorUnits),
          tx(near + 7 * HOUR, -meta.purchasePriceMinorUnits),
        ],
      ],
    ]);

    expect(effectiveBondPurchaseDay(meta, 'USD', holdings, txByHolding)).toBe(near);
  });

  it('falls back to the typed purchase day when no debit matches the price paid', () => {
    const meta = bondMeta();
    const holdings = [cardHolding('card', 'USD')];
    // A debit of a DIFFERENT amount is not the bond's funding outflow.
    const txByHolding = new Map([['card', [tx(meta.purchaseDate - 2 * DAY, -9_999)]]]);

    expect(effectiveBondPurchaseDay(meta, 'USD', holdings, txByHolding)).toBe(
      startOfLocalDay(meta.purchaseDate),
    );
  });

  it('ignores a matching debit that is in a different currency than the bond', () => {
    const meta = bondMeta();
    const holdings = [cardHolding('uah-card', 'UAH')];
    const txByHolding = new Map([
      ['uah-card', [tx(meta.purchaseDate - 2 * DAY, -meta.purchasePriceMinorUnits)]],
    ]);

    expect(effectiveBondPurchaseDay(meta, 'USD', holdings, txByHolding)).toBe(
      startOfLocalDay(meta.purchaseDate),
    );
  });
});
