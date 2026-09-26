import { startOfLocalDay } from '@kiko/dates';

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

const transaction = (time: number, amountMinorUnits: number): SeriesTransaction => ({
  time,
  amountMinorUnits,
});

describe('reconcileBondFunding', () => {
  it('recognizes cost from the funding debit’s day and amount, not the typed values', () => {
    const meta = bondMeta();
    const debitDay = startOfLocalDay(meta.purchaseDate) - 2 * DAY; // funded two days earlier
    const holdings = [cardHolding('card', 'USD')];
    // The synced debit (110_000) differs from the typed price (107_868): a ~2% gap.
    const transactionsByHolding = new Map([['card', [transaction(debitDay + 7 * HOUR, -110_000)]]]);

    expect(reconcileBondFunding(meta, 'USD', holdings, transactionsByHolding)).toEqual({
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
    const transactionsByHolding = new Map([
      ['card', [transaction(far + 7 * HOUR, -108_000), transaction(near + 7 * HOUR, -110_000)]],
    ]);

    // The nearer day wins on the day axis even though its amount is FARTHER from
    // the typed price — day proximity is the primary key, amount only the tie-break.
    expect(reconcileBondFunding(meta, 'USD', holdings, transactionsByHolding)).toEqual({
      recognitionDay: near,
      recognitionCostMinorUnits: 110_000,
    });
  });

  it('breaks a same-day tie by the amount closest to the typed price', () => {
    const meta = bondMeta();
    const typedDay = startOfLocalDay(meta.purchaseDate);
    const holdings = [cardHolding('card', 'USD')];
    // Two debits on the SAME day: the one closest to the typed 107_868 wins.
    const transactionsByHolding = new Map([
      [
        'card',
        [transaction(typedDay + 3 * HOUR, -110_000), transaction(typedDay + 9 * HOUR, -108_000)],
      ],
    ]);

    expect(reconcileBondFunding(meta, 'USD', holdings, transactionsByHolding)).toEqual({
      recognitionDay: typedDay,
      recognitionCostMinorUnits: 108_000,
    });
  });

  it('accepts an exact-price debit (Q == P) and returns the typed price', () => {
    const meta = bondMeta();
    const debitDay = startOfLocalDay(meta.purchaseDate) - DAY;
    const holdings = [cardHolding('card', 'USD')];
    const transactionsByHolding = new Map([
      ['card', [transaction(debitDay + 7 * HOUR, -meta.purchasePriceMinorUnits)]],
    ]);

    expect(reconcileBondFunding(meta, 'USD', holdings, transactionsByHolding)).toEqual({
      recognitionDay: debitDay,
      recognitionCostMinorUnits: meta.purchasePriceMinorUnits,
    });
  });

  it('falls back to the typed day and price when a debit is outside the tolerance band', () => {
    const meta = bondMeta();
    const holdings = [cardHolding('card', 'USD')];
    // A debit far from the price (here ~7% off, beyond the 5% band) is not the
    // bond's funding outflow.
    const transactionsByHolding = new Map([
      ['card', [transaction(meta.purchaseDate - 2 * DAY, -100_000)]],
    ]);

    expect(reconcileBondFunding(meta, 'USD', holdings, transactionsByHolding)).toEqual({
      recognitionDay: startOfLocalDay(meta.purchaseDate),
      recognitionCostMinorUnits: meta.purchasePriceMinorUnits,
    });
  });

  it('ignores a CREDIT (positive amount) even when its magnitude is near the price', () => {
    const meta = bondMeta();
    const holdings = [cardHolding('card', 'USD')];
    // A same-magnitude CREDIT is not an outflow — it must never fund a bond.
    const transactionsByHolding = new Map([
      ['card', [transaction(meta.purchaseDate - 2 * DAY, 108_000)]],
    ]);

    expect(reconcileBondFunding(meta, 'USD', holdings, transactionsByHolding)).toEqual({
      recognitionDay: startOfLocalDay(meta.purchaseDate),
      recognitionCostMinorUnits: meta.purchasePriceMinorUnits,
    });
  });

  it('ignores a matching debit that is in a different currency than the bond', () => {
    const meta = bondMeta();
    const holdings = [cardHolding('uah-card', 'UAH')];
    const transactionsByHolding = new Map([
      ['uah-card', [transaction(meta.purchaseDate - 2 * DAY, -108_000)]],
    ]);

    expect(reconcileBondFunding(meta, 'USD', holdings, transactionsByHolding)).toEqual({
      recognitionDay: startOfLocalDay(meta.purchaseDate),
      recognitionCostMinorUnits: meta.purchasePriceMinorUnits,
    });
  });

  it('matches a debit exactly at the 7-day funding window boundary', () => {
    const meta = bondMeta();
    const typedDay = startOfLocalDay(meta.purchaseDate);
    const boundaryDay = typedDay - 7 * DAY;
    const holdings = [cardHolding('card', 'USD')];
    const transactionsByHolding = new Map([
      ['card', [transaction(boundaryDay + 7 * HOUR, -meta.purchasePriceMinorUnits)]],
    ]);

    expect(reconcileBondFunding(meta, 'USD', holdings, transactionsByHolding)).toEqual({
      recognitionDay: boundaryDay,
      recognitionCostMinorUnits: meta.purchasePriceMinorUnits,
    });
  });

  // Node re-reads `TZ` per `Date` operation, so it is safe to flip it around a
  // single assertion rather than for the whole file (matches
  // `src/dates/local-day.test.ts`'s own pattern) — restore it afterwards so
  // later tests in the same run are unaffected.
  const withTimeZone = (zone: string, run: () => void): void => {
    const previous = process.env.TZ;
    process.env.TZ = zone;
    run();
    process.env.TZ = previous;
  };

  it('matches a debit exactly 7 local days away across a fall-back DST change', () => {
    withTimeZone('Europe/Kyiv', () => {
      // Europe/Kyiv falls back on 2026-10-25 (that local day is 25 hours), so
      // the raw ms between Oct 20 and Oct 27 local midnight is 169h, one hour
      // OVER the 7*24h window — a purely ms-based comparison would wrongly
      // reject a debit that is exactly 7 CALENDAR days away.
      const typedDay = new Date(2026, 9, 20).getTime();
      const boundaryDay = new Date(2026, 9, 27).getTime();
      const meta = bondMeta({ purchaseDate: typedDay });
      const holdings = [cardHolding('card', 'USD')];
      const transactionsByHolding = new Map([
        ['card', [transaction(boundaryDay + 7 * HOUR, -meta.purchasePriceMinorUnits)]],
      ]);

      expect(reconcileBondFunding(meta, 'USD', holdings, transactionsByHolding)).toEqual({
        recognitionDay: boundaryDay,
        recognitionCostMinorUnits: meta.purchasePriceMinorUnits,
      });
    });
  });

  it('never matches a debit more than 7 days from the typed purchase day', () => {
    const meta = bondMeta();
    const typedDay = startOfLocalDay(meta.purchaseDate);
    const farDay = typedDay - 8 * DAY;
    const holdings = [cardHolding('card', 'USD')];
    // Same amount as the typed price (Q == P), so only the day window can be
    // the reason this is rejected.
    const transactionsByHolding = new Map([
      ['card', [transaction(farDay + 7 * HOUR, -meta.purchasePriceMinorUnits)]],
    ]);

    expect(reconcileBondFunding(meta, 'USD', holdings, transactionsByHolding)).toEqual({
      recognitionDay: typedDay,
      recognitionCostMinorUnits: meta.purchasePriceMinorUnits,
    });
  });

  it('claims the matched debit so a second bond cannot also match it', () => {
    const meta = bondMeta();
    const holdings = [cardHolding('card', 'USD')];
    // A day distinct from the typed purchase day, so a claimed-vs-fallback
    // second call resolves to a visibly DIFFERENT day/price than the first.
    const debitDay = startOfLocalDay(meta.purchaseDate) - 2 * DAY;
    const transactionsByHolding = new Map([
      ['card', [transaction(debitDay + 7 * HOUR, -meta.purchasePriceMinorUnits)]],
    ]);
    const claimed = new Set<string>();

    const first = reconcileBondFunding(meta, 'USD', holdings, transactionsByHolding, claimed);
    expect(first).toEqual({
      recognitionDay: debitDay,
      recognitionCostMinorUnits: meta.purchasePriceMinorUnits,
    });

    // The one debit is already claimed: a second bond with the SAME candidate
    // pool falls back to its own typed day/price instead of double-claiming it.
    const second = reconcileBondFunding(meta, 'USD', holdings, transactionsByHolding, claimed);
    expect(second).toEqual({
      recognitionDay: startOfLocalDay(meta.purchaseDate),
      recognitionCostMinorUnits: meta.purchasePriceMinorUnits,
    });
  });
});
