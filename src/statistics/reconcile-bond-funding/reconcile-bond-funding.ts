import { dayKeyOf } from '@kiko/prices/price-book';
import { DAY_MS, startOfLocalDay } from '@kiko/dates';
import type { Currency } from '@kiko/currency/currency';
import type { BondMeta } from '@kiko/holdings/holding-metadata';

import type { SeriesHolding, SeriesTransaction } from '../holding-value-at';

/**
 * How far a candidate funding debit's amount may sit from the typed bond price
 * and still be accepted as that bond's funding outflow: 5% of the typed price.
 *
 * The synced debit (Q) and the typed price (P) are drawn from unrelated paths and
 * routinely differ — a broker fee, accrued coupon interest (НКД) on a mid-period
 * purchase, or the user typing "roughly the price" (a rounded figure). A real gap
 * of this kind is a small fraction of a bond-sized purchase (the reported case was
 * $1100.00 debited against a $1078.68 typed price, ~2%), so 5% comfortably covers
 * fee + НКД + rounding together. It is also tight enough that an UNRELATED
 * same-currency debit is very unlikely to land within 5% of a large bond purchase
 * on (or near) the same day — and the nearest-day-then-closest-amount selection
 * below is the second line of defence when more than one candidate qualifies. The
 * band is relative (not a flat minor-units figure) so it scales with the purchase
 * size rather than being tuned to one datum.
 */
const AMOUNT_TOLERANCE_FRACTION = 0.05;

/**
 * How far (in CALENDAR days, either direction) a candidate funding debit may
 * sit from the typed `purchaseDate` and still be accepted as that bond's
 * funding outflow: 7 days. A debit further away than this is nearly always
 * an UNRELATED spend that happens to land within the amount-tolerance band
 * by coincidence, not the bond's own funding move — the bank statement's
 * "Купівля облігацій" row lands within days of the typed date in every
 * observed case, never weeks. Combined with the amount band above, this is
 * the second axis that keeps the match specific to the real funding debit.
 *
 * The distance itself is measured with `dayKeyOf` (a UTC-normalized calendar
 * date), never a raw ms difference of two `startOfLocalDay` instants: a local
 * day is not always 24 hours (`local-day.ts`'s own DST doc comment), so on a
 * window that crosses a fall-back change (a 25-hour local day), the raw ms
 * gap between two dates exactly 7 CALENDAR days apart is 1 hour OVER
 * `7 * DAY_MS`, which would wrongly exclude a genuinely-7-day-away debit.
 */
const FUNDING_WINDOW_DAYS = 7;

/**
 * Reconcile a bond's held-cost recognition DAY against the day the funding
 * money actually left a card/cash holding, and return the local day the
 * bond's held cost should START counting in the net-worth series.
 *
 * A card->bond purchase is modeled as TWO independently-dated facts: a real
 * funding DEBIT on the card (a Monobank "Купівля облігацій" row, at its own
 * instant, for the amount Q that truly left) and a bond whose cost turns on at
 * the user-typed `purchaseDate` for the user-typed price P. No link is stored
 * between them (a bond is `'excluded'` from the exchange path), so when the
 * debit's local day differs from `purchaseDate`'s local day, the card drops
 * while the bond is still 0 (a dip) — or the bond turns on while the card is
 * still full (a bump). Recognizing the bond's cost from the day the money
 * ACTUALLY LEFT removes that gap.
 *
 * The bond is still worth P, not Q: P is the value its holding card and Home
 * show, so the line's "now" point matches them. A (Q − P) gap (a fee, НКД, a
 * rounded typed price) stays as a step on the purchase day.
 *
 * The rule, using cross-holding transactions the series builder already holds:
 * - Find the bond's funding outflow: a DEBIT (negative amount) on ANY holding, in
 *   the SAME currency as the bond, whose magnitude is within `AMOUNT_TOLERANCE_FRACTION`
 *   of the typed price. Amount proximity (not exact equality) is the signal
 *   because Q ≠ P is the common case; the transaction stores no reliable
 *   structured bond marker (the Monobank `description`/`mcc`/`category` of such a
 *   row is free text / uncategorized, not a stable enum), so a currency + debit +
 *   near-price match is the robust, self-correcting signal for EXISTING data.
 * - Among candidates, prefer the one whose local day is NEAREST the typed
 *   `purchaseDate` day (a same-day debit wins), tie-broken by the amount closest
 *   to the typed price.
 * - The matched debit's local day is the recognition day.
 * - None match (legacy, FX-funded, or a genuinely manual bond with no recorded
 *   outflow) -> fall back to the typed `purchaseDate`'s local day.
 *
 * This is consumed ONLY inside `buildNetWorthSeries`, on a throwaway holdings copy
 * (see the doc there): it shifts only when the held cost starts in the SERIES.
 * Coupons, maturity, and the redemption ledger stay keyed off the real
 * `purchaseDate` / `purchasePriceMinorUnits` on the real holding (unchanged) — the
 * series does not compute them from this copy.
 *
 * `claimed` is a set of candidate keys (`holdingId:index`, one per transaction
 * array slot) shared across every bond `buildNetWorthSeries` reconciles in one
 * run: a candidate already claimed by an earlier bond is filtered out here, and
 * the winning candidate's own key is added to `claimed` before returning, so
 * two bonds priced the same week never both claim the SAME debit (the second
 * one falls back to its own typed day instead). Defaults to a fresh,
 * unshared set for a standalone call (e.g. every test above).
 */
export const reconcileBondFunding = (
  meta: BondMeta,
  bondCurrency: Currency,
  holdings: SeriesHolding[],
  transactionsByHolding: Map<string, SeriesTransaction[]>,
  claimed: Set<string> = new Set(),
): number => {
  const typedDay = startOfLocalDay(meta.purchaseDate);
  const typedDayKey = dayKeyOf(meta.purchaseDate);
  const typedPrice = meta.purchasePriceMinorUnits;
  const tolerance = typedPrice * AMOUNT_TOLERANCE_FRACTION;
  const windowMs = FUNDING_WINDOW_DAYS * DAY_MS;

  // A plain nested loop (not a `.flatMap`/`.map`/`.filter` chain) so each
  // candidate's local-day key is computed once, directly, rather than inside
  // an array-callback — see kiko-domain's statistics performance note. Order
  // is preserved exactly: holdings in their given order, then each holding's
  // own transactions by index, matching what the replaced `.flatMap` chain
  // produced.
  const candidates: { day: number; dayKey: number; costMinorUnits: number; key: string }[] = [];

  for (const holding of holdings) {
    if (holding.currency !== bondCurrency) {
      continue;
    }

    const transactions = transactionsByHolding.get(holding.id) ?? [];

    for (let index = 0; index < transactions.length; index += 1) {
      const transaction = transactions[index];
      const key = `${holding.id}:${index}`;
      const isCandidate =
        transaction.amountMinorUnits < 0 &&
        Math.abs(Math.abs(transaction.amountMinorUnits) - typedPrice) <= tolerance &&
        Math.abs(dayKeyOf(transaction.time) - typedDayKey) <= windowMs &&
        !claimed.has(key);

      if (isCandidate) {
        candidates.push({
          day: startOfLocalDay(transaction.time),
          dayKey: dayKeyOf(transaction.time),
          costMinorUnits: Math.abs(transaction.amountMinorUnits),
          key,
        });
      }
    }
  }

  // No matching outflow: recognize from the typed day (a legacy, FX-funded, or
  // genuinely manual bond).
  if (candidates.length === 0) {
    return typedDay;
  }

  // Prefer the candidate whose day is NEAREST the typed purchase day, tie-broken
  // by the amount closest to the typed price. Seeded with the first candidate
  // (never the typed day), so a lone match is returned directly.
  const best = candidates.reduce((chosen, candidate) => {
    const dayDelta =
      Math.abs(candidate.dayKey - typedDayKey) - Math.abs(chosen.dayKey - typedDayKey);

    if (dayDelta !== 0) {
      return dayDelta < 0 ? candidate : chosen;
    }

    const amountDelta =
      Math.abs(candidate.costMinorUnits - typedPrice) -
      Math.abs(chosen.costMinorUnits - typedPrice);

    return amountDelta < 0 ? candidate : chosen;
  });

  claimed.add(best.key);

  return best.day;
};
