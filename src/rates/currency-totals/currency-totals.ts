import { Money } from '../../currency/money';
import type { Currency } from '../../currency/currency';
import { holdingValue, type ValuableHolding } from '../../holdings/holding-value';
import { EMPTY_PRICE_BOOK, type PriceBook } from '../../prices/price-book';

/**
 * Sums a list of holdings into one {@link Money} per distinct currency, valuing
 * each holding via {@link holdingValue} (net of tax, grown to `now`) rather than
 * its raw cached balance, so the per-currency breakdown agrees with the
 * net-of-tax headline. Ordered by descending absolute minor-unit value. Empty
 * input yields `[]`.
 *
 * `now` defaults to the current time so call sites that only need present-day
 * valuation need not thread a clock through.
 */
export const sumByCurrency = (
  holdings: ValuableHolding[],
  now: number = Date.now(),
  book: PriceBook = EMPTY_PRICE_BOOK,
): Money[] => {
  const totals = new Map<Currency, number>();

  for (const holding of holdings) {
    const value = holdingValue(holding, now, book).minorUnits;
    totals.set(holding.currency, (totals.get(holding.currency) ?? 0) + value);
  }

  return Array.from(totals, ([currency, minorUnits]) => Money.of(currency, minorUnits)).sort(
    (a, b) => Math.abs(b.minorUnits) - Math.abs(a.minorUnits),
  );
};
