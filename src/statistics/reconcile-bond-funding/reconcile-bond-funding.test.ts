import { startOfLocalDay } from '../../dates/local-day';
import type { BondMeta } from '../../holdings/holding-metadata';

import type { SeriesHolding, SeriesTransaction } from '../holding-value-at';
import { reconcileBondFunding } from './reconcile-bond-funding';

const DAY = 86_400_000;
const HOUR = 3_600_000;

const bondMeta = (over: Partial<BondMeta> = {}): BondMeta => ({
  quantity: 1,
  faceValueMinorUnits: 10_000,
  couponPct: 0,
  couponFrequency: 'annually',
  bondKind: 'government',
  purchaseDate: startOfLocalDay(Date.UTC(2026, 0, 10, 12)),
  purchasePriceMinorUnits: 107_868,
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

describe('reconcileBondFunding', () => {
  it('recognizes cost from the funding debit’s day and amount, not the typed values', () => {
    const meta = bondMeta();
    const debitDay = startOfLocalDay(meta.purchaseDate) - 2 * DAY; // funded two days earlier
    const holdings = [cardHolding('card', 'USD')];
    // The synced debit (110_000) differs from the typed price (107_868): a ~2% gap.
    const txByHolding = new Map([['card', [tx(debitDay + 7 * HOUR, -110_000)]]]);

    expect(reconcileBondFunding(meta, 'USD', holdings, txByHolding)).toEqual({
      recognitionDay: debitDay,
      recognitionCostMinorUnits: 110_000,
    });
  });

  it('picks the debit whose day is nearest the typed purchase day when several match', () => {
    const meta = bondMeta();
    const typedDay = startOfLocalDay(meta.purchaseDate);
    const near = typedDay - DAY;
    const far = typedDay - 5 * DAY;
    const holdings = [cardHolding('card', 'USD')];
    const txByHolding = new Map([
      ['card', [tx(far + 7 * HOUR, -108_000), tx(near + 7 * HOUR, -110_000)]],
    ]);

    // The nearer day wins on the day axis even though its amount is FARTHER from
    // the typed price — day proximity is the primary key, amount only the tie-break.
    expect(reconcileBondFunding(meta, 'USD', holdings, txByHolding)).toEqual({
      recognitionDay: near,
      recognitionCostMinorUnits: 110_000,
    });
  });

  it('breaks a same-day tie by the amount closest to the typed price', () => {
    const meta = bondMeta();
    const typedDay = startOfLocalDay(meta.purchaseDate);
    const holdings = [cardHolding('card', 'USD')];
    // Two debits on the SAME day: the one closest to the typed 107_868 wins.
    const txByHolding = new Map([
      ['card', [tx(typedDay + 3 * HOUR, -110_000), tx(typedDay + 9 * HOUR, -108_000)]],
    ]);

    expect(reconcileBondFunding(meta, 'USD', holdings, txByHolding)).toEqual({
      recognitionDay: typedDay,
      recognitionCostMinorUnits: 108_000,
    });
  });

  it('accepts an exact-price debit (Q == P) and returns the typed price', () => {
    const meta = bondMeta();
    const debitDay = startOfLocalDay(meta.purchaseDate) - DAY;
    const holdings = [cardHolding('card', 'USD')];
    const txByHolding = new Map([
      ['card', [tx(debitDay + 7 * HOUR, -meta.purchasePriceMinorUnits)]],
    ]);

    expect(reconcileBondFunding(meta, 'USD', holdings, txByHolding)).toEqual({
      recognitionDay: debitDay,
      recognitionCostMinorUnits: meta.purchasePriceMinorUnits,
    });
  });

  it('falls back to the typed day and price when a debit is outside the tolerance band', () => {
    const meta = bondMeta();
    const holdings = [cardHolding('card', 'USD')];
    // A debit far from the price (here ~7% off, beyond the 5% band) is not the
    // bond's funding outflow.
    const txByHolding = new Map([['card', [tx(meta.purchaseDate - 2 * DAY, -100_000)]]]);

    expect(reconcileBondFunding(meta, 'USD', holdings, txByHolding)).toEqual({
      recognitionDay: startOfLocalDay(meta.purchaseDate),
      recognitionCostMinorUnits: meta.purchasePriceMinorUnits,
    });
  });

  it('ignores a CREDIT (positive amount) even when its magnitude is near the price', () => {
    const meta = bondMeta();
    const holdings = [cardHolding('card', 'USD')];
    // A same-magnitude CREDIT is not an outflow — it must never fund a bond.
    const txByHolding = new Map([['card', [tx(meta.purchaseDate - 2 * DAY, 108_000)]]]);

    expect(reconcileBondFunding(meta, 'USD', holdings, txByHolding)).toEqual({
      recognitionDay: startOfLocalDay(meta.purchaseDate),
      recognitionCostMinorUnits: meta.purchasePriceMinorUnits,
    });
  });

  it('ignores a matching debit that is in a different currency than the bond', () => {
    const meta = bondMeta();
    const holdings = [cardHolding('uah-card', 'UAH')];
    const txByHolding = new Map([['uah-card', [tx(meta.purchaseDate - 2 * DAY, -108_000)]]]);

    expect(reconcileBondFunding(meta, 'USD', holdings, txByHolding)).toEqual({
      recognitionDay: startOfLocalDay(meta.purchaseDate),
      recognitionCostMinorUnits: meta.purchasePriceMinorUnits,
    });
  });
});
