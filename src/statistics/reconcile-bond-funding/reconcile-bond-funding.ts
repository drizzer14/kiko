import { startOfLocalDay } from '@kiko/dates';

import { dayKeyOf } from '../../prices/price-book';
import type { Currency } from '../../currency/currency';
import type { BondMeta } from '../../holdings/holding-metadata';
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

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** How a bond's held cost should be recognized in the net-worth series. */
type BondRecognition = {
  /** The local day the bond's held cost should START counting. */
  recognitionDay: number;
  /** The minor-units cost to value the bond at (the money that actually left). */
  recognitionCostMinorUnits: number;
};

/**
 * Reconcile a bond's held-cost recognition against the funding money that
 * actually left a card/cash holding, on BOTH axes: the DAY it left and the
 * AMOUNT that left.
 *
 * A card->bond purchase is modeled as TWO independently-dated, independently-
 * valued facts: a real funding DEBIT on the card (a Monobank "Купівля облігацій"
 * row, at its own instant, for the amount Q that truly left) and a bond whose
 * cost turns on at the user-typed `purchaseDate` for the user-typed price P. No
 * link is stored between them (a bond is `'excluded'` from the exchange path), so
 * two mismatches dip (or bump) net worth:
 * - DAY: when the debit's local day differs from `purchaseDate`'s local day, the
 *   card drops while the bond is still 0 (a dip) — or the bond turns on while the
 *   card is still full (a bump).
 * - AMOUNT: when Q ≠ P (a fee, НКД, or a rounded typed price), the card's −Q and
 *   the bond's +P do not cancel, leaving a permanent (Q − P) step from the
 *   purchase day onward.
 *
 * Recognizing the bond's cost from the day the money ACTUALLY LEFT, valued at the
 * amount that ACTUALLY LEFT, nets the move to zero on both axes.
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
 * - The matched debit's local day is the recognition day AND its magnitude (Q) is
 *   the recognition cost.
 * - None match (legacy, FX-funded, or a genuinely manual bond with no recorded
 *   outflow) -> fall back to the typed `purchaseDate`'s local day and the typed
 *   price (today's behavior, no regression). The exact-match Q == P case is a
 *   subset (distance 0 ≤ tolerance): recognition cost = P, day = the debit's day.
 *
 * This is consumed ONLY inside `buildNetWorthSeries`, on a throwaway holdings copy
 * (see the doc there): it shifts when the held cost starts and what it is worth in
 * the SERIES. Coupons, maturity, and the redemption ledger stay keyed off the real
 * `purchaseDate` / `purchasePriceMinorUnits` on the real holding (unchanged) — the
 * series does not compute them from this copy.
 *
 * `claimed` is a set of candidate keys (`holdingId:index`, one per transaction
 * array slot) shared across every bond `buildNetWorthSeries` reconciles in one
 * run: a candidate already claimed by an earlier bond is filtered out here, and
 * the winning candidate's own key is added to `claimed` before returning, so
 * two bonds priced the same week never both claim the SAME debit (the second
 * one falls back to its own typed day/price instead). Defaults to a fresh,
 * unshared set for a standalone call (e.g. every test above).
 */
export const reconcileBondFunding = (
  meta: BondMeta,
  bondCurrency: Currency,
  holdings: SeriesHolding[],
  transactionsByHolding: Map<string, SeriesTransaction[]>,
  claimed: Set<string> = new Set(),
): BondRecognition => {
  const typedDay = startOfLocalDay(meta.purchaseDate);
  const typedDayKey = dayKeyOf(meta.purchaseDate);
  const typedPrice = meta.purchasePriceMinorUnits;
  const tolerance = typedPrice * AMOUNT_TOLERANCE_FRACTION;
  const windowMs = FUNDING_WINDOW_DAYS * DAY_MS;

  const candidates = holdings.flatMap((holding) =>
    holding.currency === bondCurrency
      ? (transactionsByHolding.get(holding.id) ?? [])
          .map((transaction, index) => ({ transaction, key: `${holding.id}:${index}` }))
          .filter(
            ({ transaction, key }) =>
              transaction.amountMinorUnits < 0 &&
              Math.abs(Math.abs(transaction.amountMinorUnits) - typedPrice) <= tolerance &&
              Math.abs(dayKeyOf(transaction.time) - typedDayKey) <= windowMs &&
              !claimed.has(key),
          )
          .map(({ transaction, key }) => ({
            day: startOfLocalDay(transaction.time),
            dayKey: dayKeyOf(transaction.time),
            costMinorUnits: Math.abs(transaction.amountMinorUnits),
            key,
          }))
      : [],
  );

  // No matching outflow: recognize from the typed day at the typed price (today's
  // behavior — a legacy, FX-funded, or genuinely manual bond).
  if (candidates.length === 0) {
    return { recognitionDay: typedDay, recognitionCostMinorUnits: typedPrice };
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

  return { recognitionDay: best.day, recognitionCostMinorUnits: best.costMinorUnits };
};
