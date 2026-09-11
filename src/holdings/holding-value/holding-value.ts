import { Money, toMajor } from '../../currency/money';
import { startOfLocalDay } from '../../dates/local-day';
import type { HoldingRow } from '../../db/schema';

import { asBondMeta, asTermDepositMeta, type BondMeta } from '../holding-metadata';
import { bondCouponDates, bondCouponMajor, depositAccruedMajor, depositLedger } from '../interest';
import { taxOnInterestMinor } from '../tax';

export type ValuableHolding = Pick<
  HoldingRow,
  'type' | 'currency' | 'balanceMinorUnits' | 'metadata'
>;

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
): HoldingValueBreakdown => {
  switch (holding.type) {
    case 'term_deposit':
      return depositBreakdown(holding, now);
    case 'bond':
      return bondBreakdown(holding, now);
    default:
      return flat(holding.currency, holding.balanceMinorUnits);
  }
};

export const holdingValue = (holding: ValuableHolding, now: number): Money =>
  holdingValueBreakdown(holding, now).net;
