import type { Currency } from '../currency/currency';
import { startOfLocalDay } from '../dates/local-day';
import type { BondMeta } from '../holdings/holding-metadata';

import type { SeriesHolding, SeriesTransaction } from './holding-value-at';

/**
 * The local day a bond's held cost should START counting in the net-worth series.
 *
 * A card->bond purchase is modeled as TWO independently-dated facts: a real
 * funding DEBIT on the card (a Monobank "Купівля облігацій" row, at its own
 * instant) and a bond whose cost turns on at the user-typed `purchaseDate`. No
 * link is stored between them (a bond is `'excluded'` from the exchange path), so
 * when the debit's local day differs from `purchaseDate`'s local day the card
 * drops while the bond is still 0 (a dip) — or the bond turns on while the card
 * is still full (a bump). Recognizing the bond's cost from the day the money
 * ACTUALLY LEFT nets the move to zero across that gap.
 *
 * The rule, using cross-holding transactions the series builder already holds:
 * - Find the bond's funding outflow: a transaction on ANY holding, in the SAME
 *   currency as the bond, whose amount is an exact debit of the price paid
 *   (`amountMinorUnits === -purchasePriceMinorUnits`).
 * - Exactly one such debit -> its local day is the effective purchase day.
 * - Several match -> the one whose day is NEAREST the typed `purchaseDate` day.
 * - None match (legacy, FX-funded, or a genuinely manual bond with no recorded
 *   outflow) -> fall back to the typed `purchaseDate`'s local day (today's
 *   behavior, no regression).
 *
 * This changes ONLY when the held cost starts. Coupons, maturity, and the
 * redemption ledger stay keyed off the real `purchaseDate` (unchanged).
 */
export const effectiveBondPurchaseDay = (
  meta: BondMeta,
  bondCurrency: Currency,
  holdings: SeriesHolding[],
  txByHolding: Map<string, SeriesTransaction[]>,
): number => {
  const typedDay = startOfLocalDay(meta.purchaseDate);

  const fundingDays = holdings.flatMap((holding) =>
    holding.currency === bondCurrency
      ? (txByHolding.get(holding.id) ?? [])
          .filter((transaction) => transaction.amountMinorUnits === -meta.purchasePriceMinorUnits)
          .map((transaction) => startOfLocalDay(transaction.time))
      : [],
  );

  // No recorded outflow: keep today's behavior (recognize from the typed day).
  if (fundingDays.length === 0) {
    return typedDay;
  }

  // Reducing over the matches (seeded with the first, never the typed day) yields
  // the single match directly, and otherwise the day nearest the typed purchase
  // day.
  return fundingDays.reduce((nearest, day) =>
    Math.abs(day - typedDay) < Math.abs(nearest - typedDay) ? day : nearest,
  );
};
