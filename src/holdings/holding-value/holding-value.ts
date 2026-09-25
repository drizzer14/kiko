import { match } from 'ts-pattern';

import {
  asBondMeta,
  asLoanMeta,
  asMetalMeta,
  asPropertyMeta,
  asTermDepositMeta,
  type BondMeta,
} from '../holding-metadata';
import { costBasisMinorAt } from '../lots';
import { taxOnInterestMinor } from '../tax';
import type { HoldingRow } from '../../db/schema';
import { pricedValueMinor } from '../priced-value';
import { Money, toMajor } from '../../currency/money';
import { startOfLocalDay } from '../../dates/local-day';
import { loanOutstandingMinorAt } from '../loan-schedule';
import { EMPTY_PRICE_BOOK, type PriceBook } from '../../prices/price-book';
import { bondCouponDates, bondCouponMajor, depositAccruedMajor, depositLedger } from '../interest';

/**
 * `id` is optional — mirroring `PricedHolding` (`src/holdings/priced-value/`)
 * — so every existing test fixture across the app's holding-value suites
 * (a synthetic cash/deposit/bond literal with no real row) keeps compiling
 * unchanged. A PRICED holding (`isPricedHoldingType`) needs its own `id` to
 * resolve its `holding:<id>` instrument key; one with no `id` simply reads as
 * having no stored price point (falls back to its lots' cost basis).
 */
export type ValuableHolding = Pick<
  HoldingRow,
  'type' | 'currency' | 'balanceMinorUnits' | 'metadata'
> & { id?: HoldingRow['id'] };

export type HoldingValueBreakdown = {
  gross: Money;
  principalOrCost: Money;
  interest: Money;
  tax: Money;
  net: Money;
};

const flat = (currency: ValuableHolding['currency'], minorUnits: number): HoldingValueBreakdown => {
  const money = Money.of(currency, minorUnits);
  const zero = Money.of(currency, 0);
  return { gross: money, principalOrCost: money, interest: zero, tax: zero, net: money };
};

// Assembles a value breakdown from its minor-unit parts: gross = principal +
// interest, net = gross - tax. Shared by all three deposit branches so the
// gross/net arithmetic lives in exactly one place.
const makeBreakdown = (
  currency: ValuableHolding['currency'],
  principalMinor: number,
  interestMinor: number,
  taxMinor: number,
): HoldingValueBreakdown => {
  const grossMinor = principalMinor + interestMinor;
  return {
    gross: Money.of(currency, grossMinor),
    principalOrCost: Money.of(currency, principalMinor),
    interest: Money.of(currency, interestMinor),
    tax: Money.of(currency, taxMinor),
    net: Money.of(currency, grossMinor - taxMinor),
  };
};

const depositBreakdown = (holding: ValuableHolding, now: number): HoldingValueBreakdown => {
  const meta = asTermDepositMeta(holding.metadata);
  if (meta === null) {
    return flat(holding.currency, holding.balanceMinorUnits);
  }
  const { currency } = holding;
  // A contribution dated after `now` is not yet credited: exclude it from both
  // the principal and the compounded/accrued value so a future top-up never
  // shows in the present balance.
  const active = meta.contributions.filter((c) => c.date <= now);
  if (active.length === 0) {
    return flat(currency, 0);
  }

  if (!meta.recapitalization) {
    // Interest is paid out each period rather than compounded. We surface the
    // CUMULATIVE simple interest accrued to date, net of tax, and count it in
    // the deposit's value/net worth (principal + net interest).
    const contributionsMajor = active.map((c) => ({
      amountMajor: toMajor(c.amountMinorUnits, currency),
      date: c.date,
    }));
    const principalMinor = active.reduce((sum, c) => sum + c.amountMinorUnits, 0);
    const accruedMajorValue = depositAccruedMajor(
      contributionsMajor,
      meta.annualRatePct,
      meta.termMonths,
      now,
    );
    const interestMinor = Money.fromMajor(currency, accruedMajorValue).minorUnits;
    const taxMinor = taxOnInterestMinor(interestMinor);
    return makeBreakdown(currency, principalMinor, interestMinor, taxMinor);
  }

  // Recapitalizing deposits iterate the step-by-step engine (no closed form):
  // per-period interest on the last capitalized balance, withheld net of the
  // 18%+5% tax and capitalized on each anniversary (bi-weekly capitalizes once a
  // month). The value is the last capitalized balance plus landed contributions
  // — the in-progress accrual is excluded, which is the fix for the old
  // overvaluation. `capitalizedGross`/`capitalizedTax` are the realized totals,
  // so principal + gross - tax reconciles exactly to the net current value.
  const ledger = depositLedger(
    meta.contributions.map((c) => ({ amountMinor: c.amountMinorUnits, date: c.date })),
    meta.annualRatePct,
    meta.compounding,
    meta.termMonths,
    now,
  );
  return makeBreakdown(
    currency,
    ledger.principalMinor,
    ledger.capitalizedGrossMinor,
    ledger.capitalizedTaxMinor,
  );
};

const bondBreakdown = (holding: ValuableHolding, now: number): HoldingValueBreakdown => {
  const meta = asBondMeta(holding.metadata);
  if (meta === null) {
    return flat(holding.currency, holding.balanceMinorUnits);
  }
  const { currency } = holding;
  const costMoney = Money.of(currency, meta.purchasePriceMinorUnits);
  const zero = Money.of(currency, 0);
  // Value the bond by LOCAL DAY, not by raw instant. `purchaseDate` is often a
  // mid-day timestamp (the holding-form default `purchaseDate ?? Date.now()`),
  // while the card debit that funds a same-day card->bond move lands at its own
  // clock time and each net-worth bucket is a day key. Comparing raw ms turns
  // the bond on at a different instant than the debit lands, so a same-day move
  // shows a one-bucket dip. The bond instead carries value for any instant whose
  // local day is at or after the purchase day (local-day is the unit —
  // kiko-domain "Dates").
  const valuationDay = startOfLocalDay(now);
  // A bond whose purchase day is in the future has not been bought yet, so it
  // reports no value — not its nominal.
  if (valuationDay < startOfLocalDay(meta.purchaseDate)) {
    return { gross: zero, principalOrCost: zero, interest: zero, tax: zero, net: zero };
  }
  // On or after the maturity day the nominal is redeemed (returned as the
  // redemption ledger entry), so the bond holding itself no longer carries value.
  if (valuationDay >= startOfLocalDay(meta.maturityDate)) {
    return { gross: zero, principalOrCost: costMoney, interest: zero, tax: zero, net: zero };
  }
  // A live bond is worth its COST (the price paid), flat, until maturity — NOT
  // its nominal. A card->bond move debits the card the price PAID and credits
  // the bond the SAME price, so net worth is unchanged on the purchase day.
  // Valuing a premium bond at nominal instead left a permanent (price - nominal)
  // dip from the purchase day onward (the R4 bug). The premium/discount is
  // realized only AT maturity, through the redemption ledger entry that returns
  // the nominal (see `bondEntries` in `derived-entries.ts`); the maturity guard
  // above hands the bond off to that entry. The bank pays each coupon out to a
  // cash account on its discrete coupon date (see the ledger entries); it does
  // NOT accrue a continuous dirty price into the held value between coupons, so
  // there is no per-day accrual and no unwind on a coupon date. Interest/tax on
  // the coupon stream are ledger events, not part of the held value.
  return {
    gross: costMoney,
    principalOrCost: costMoney,
    interest: zero,
    tax: zero,
    net: costMoney,
  };
};

// A priced holding's (`property_item`, `metal` — `isPricedHoldingType`) own
// `lots` array, whichever metadata shape its type carries (kiko-domain:
// `PropertyMeta`/`MetalMeta` differ in every OTHER field, but both carry
// `lots`). `undefined` for invalid/absent metadata, so `pricedBreakdown`
// below falls back to the flat stored balance the same way an unparsed
// property always has.
const pricedLotsOf = (holding: ValuableHolding) =>
  holding.type === 'metal'
    ? asMetalMeta(holding.metadata)?.lots
    : asPropertyMeta(holding.metadata)?.lots;

// A loan's held value is NEGATIVE (spec 5, T27): it is debt, not an asset, so
// `holdingValue`/net-worth subtract it by simply summing every holding's own
// signed value. `gross`/`net` are minus the outstanding balance at `now`
// (`loanOutstandingMinorAt` — M4 already returns 0 before the loan's own
// `startDate`, so a not-yet-taken loan contributes nothing, mirroring a
// priced holding before its first lot). `principalOrCost` is minus the
// ORIGINAL principal, flat, regardless of how much has been paid down —
// mirroring `principalOrCost`'s role elsewhere as the reference point a
// gain/loss (here, a payoff progress) is measured against, not the current
// balance. A loan never accrues interest/tax at valuation time (interest is
// a ledger event on payment, `loanInterestForPaymentMinor` — not a held
// value), so both stay zero.
const loanBreakdown = (
  holding: ValuableHolding,
  now: number,
  book: PriceBook,
): HoldingValueBreakdown => {
  const meta = asLoanMeta(holding.metadata);
  if (meta === null) {
    // M1 (T27 round 1, carried from the T26 review finding (c)): a debt must
    // never read as a positive asset — missing/malformed metadata values the
    // loan at 0, NOT `holding.balanceMinorUnits` (the flat fallback every
    // other type uses), which would otherwise surface as a positive balance.
    return flat(holding.currency, 0);
  }
  const { currency } = holding;
  const outstandingMinor = loanOutstandingMinorAt(meta, holding.id ?? '', book, now);
  // `outstandingMinor` is always clamped >= 0 (`loanOutstandingMinorAt`);
  // negating it directly would produce `-0` for a paid-off loan (`Object.is`
  // distinguishes `-0` from `0`, which a `toBe(0)` assertion catches), so the
  // `|| 0` normalizes the zero case back to a plain `0`.
  const negatedOutstandingMinor = -outstandingMinor || 0;
  const zero = Money.of(currency, 0);

  return {
    gross: Money.of(currency, negatedOutstandingMinor),
    principalOrCost: Money.of(currency, -meta.principalMinorUnits),
    interest: zero,
    tax: zero,
    net: Money.of(currency, negatedOutstandingMinor),
  };
};

// A priced holding's gross/net are its `pricedValueMinor` (a `PriceBook`
// lookup), falling back to its lots' cost basis when there is no stored price
// point yet — Review Focus 5: never 0. `principalOrCost` is ALWAYS the cost
// basis (not the priced value), so the holding-detail breakdown can show a
// live gain/loss against it. It never accrues interest or withholds tax, so
// both stay zero.
const pricedBreakdown = (
  holding: ValuableHolding,
  now: number,
  book: PriceBook,
): HoldingValueBreakdown => {
  const lots = pricedLotsOf(holding);
  if (lots === undefined) {
    return flat(holding.currency, holding.balanceMinorUnits);
  }
  const { currency } = holding;
  const costBasisMinor = costBasisMinorAt(lots, now);
  const valueMinor = pricedValueMinor(holding, book, now) ?? costBasisMinor;
  const zero = Money.of(currency, 0);

  return {
    gross: Money.of(currency, valueMinor),
    principalOrCost: Money.of(currency, costBasisMinor),
    interest: zero,
    tax: zero,
    net: Money.of(currency, valueMinor),
  };
};

// The bond's expected lifetime profit (minor units): the sum of every net
// coupon plus the redeemed nominal, less the price actually paid. Reproduces the
// figure the user's bank shows (e.g. 3 * 8,175 + 100,000 - 107,868 = 16,657).
export const bondExpectedProfitMinor = (
  meta: BondMeta,
  currency: ValuableHolding['currency'],
): number => {
  const nominalMinor = meta.quantity * meta.faceValueMinorUnits;
  const couponMinor = Money.fromMajor(
    currency,
    bondCouponMajor(toMajor(nominalMinor, currency), meta.couponPct, meta.couponFrequency),
  ).minorUnits;
  const netCouponMinor =
    couponMinor - (meta.bondKind === 'corporate' ? taxOnInterestMinor(couponMinor) : 0);
  const couponCount = bondCouponDates(
    meta.purchaseDate,
    meta.maturityDate,
    meta.couponFrequency,
  ).length;
  return netCouponMinor * couponCount + nominalMinor - meta.purchasePriceMinorUnits;
};

export const holdingValueBreakdown = (
  holding: ValuableHolding,
  now: number,
  book: PriceBook = EMPTY_PRICE_BOOK,
): HoldingValueBreakdown =>
  match(holding.type)
    .with('property_item', 'metal', () => pricedBreakdown(holding, now, book))
    .with('term_deposit', () => depositBreakdown(holding, now))
    .with('bond', () => bondBreakdown(holding, now))
    .with('loan', () => loanBreakdown(holding, now, book))
    // Not `.exhaustive()`: the original `switch`'s `default` branch tolerated
    // ANY unmatched value, not only the 4 remaining literal types — a
    // malformed/absent `type` at runtime (a partial test fixture, or stale
    // data pre-dating a schema change) falls back to the flat stored balance
    // the same way it always has, rather than throwing.
    .otherwise(() => flat(holding.currency, holding.balanceMinorUnits));

export const holdingValue = (
  holding: ValuableHolding,
  now: number,
  book: PriceBook = EMPTY_PRICE_BOOK,
): Money => holdingValueBreakdown(holding, now, book).net;
