import { Money, toMajor } from '../currency/money';
import type { HoldingRow } from '../db/schema';
import { asBondMeta, asTermDepositMeta, type BondMeta } from './holding-metadata';
import {
  bondAccruedGrossMajor,
  bondCouponDates,
  bondCouponMajor,
  depositAccruedMajor,
  depositBiweeklyMajor,
  depositCompoundedMajor,
  depositMaturity,
} from './interest';
import { INTEREST_TAX_RATE_PCT, taxOnInterestMinor } from './tax';

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
  const contributionsMajor = active.map((c) => ({
    amountMajor: toMajor(c.amountMinorUnits, currency),
    date: c.date,
  }));
  const principalMinor = active.reduce((s, c) => s + c.amountMinorUnits, 0);

  // Opening-day-anchored semi-monthly ("bi-weekly") deposits compound their own
  // way: interest is capitalized NET of the 23% withholding on each credit date,
  // so the engine returns the gross interest, the cumulative tax, and the net
  // value directly rather than the gross-compound / tax-at-end path the calendar
  // frequencies use.
  if (meta.recapitalization && meta.compounding === 'bi-weekly') {
    const start = Math.min(...active.map((c) => c.date));
    const end = Math.min(now, depositMaturity(active, meta.termMonths));
    const result = depositBiweeklyMajor(
      contributionsMajor,
      meta.annualRatePct,
      INTEREST_TAX_RATE_PCT,
      start,
      end,
    );
    const interestMinor = Money.fromMajor(currency, result.grossInterestMajor).minorUnits;
    const taxMinor = Money.fromMajor(currency, result.taxMajor).minorUnits;
    return makeBreakdown(currency, principalMinor, interestMinor, taxMinor);
  }

  if (!meta.recapitalization) {
    // Interest is paid out each period rather than compounded. We surface the
    // CUMULATIVE interest accrued to date, net of tax, and count it in the
    // deposit's value/net worth (principal + net interest).
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

  const grossMajor = depositCompoundedMajor(
    contributionsMajor,
    meta.annualRatePct,
    meta.compounding,
    meta.termMonths,
    now,
  );
  const grossMinor = Money.fromMajor(currency, grossMajor).minorUnits;
  const interestMinor = Math.max(0, grossMinor - principalMinor);
  const taxMinor = taxOnInterestMinor(interestMinor);
  return makeBreakdown(currency, principalMinor, interestMinor, taxMinor);
};

const bondBreakdown = (holding: ValuableHolding, now: number): HoldingValueBreakdown => {
  const meta = asBondMeta(holding.metadata);
  if (meta === null) {
    return flat(holding.currency, holding.balanceMinorUnits);
  }
  const { currency } = holding;
  const nominalMinor = meta.quantity * meta.faceValueMinorUnits;
  const costMoney = Money.of(currency, meta.purchasePriceMinorUnits);
  const zero = Money.of(currency, 0);
  // A bond whose purchase date is in the future has not been bought yet, so it
  // reports no value — not its nominal.
  if (meta.purchaseDate > now) {
    return { gross: zero, principalOrCost: zero, interest: zero, tax: zero, net: zero };
  }
  // At/after maturity the nominal is redeemed (returned as the redemption ledger
  // entry), so the bond holding itself no longer carries value.
  if (now >= meta.maturityDate) {
    return { gross: zero, principalOrCost: costMoney, interest: zero, tax: zero, net: zero };
  }
  // Dirty-price value: nominal plus the coupon accrued so far in the current
  // coupon period (net of the corporate 23% tax). It resets to nominal on each
  // coupon date, so the value drops by one coupon whenever a coupon is paid.
  const grossAccruedMajor = bondAccruedGrossMajor(
    toMajor(nominalMinor, currency),
    meta.couponPct,
    meta.couponFrequency,
    meta.purchaseDate,
    meta.maturityDate,
    now,
  );
  const accruedMinor = Money.fromMajor(currency, grossAccruedMajor).minorUnits;
  const grossMinor = nominalMinor + accruedMinor;
  const taxMinor = meta.bondKind === 'corporate' ? taxOnInterestMinor(accruedMinor) : 0;
  return {
    gross: Money.of(currency, grossMinor),
    principalOrCost: costMoney,
    interest: Money.of(currency, accruedMinor),
    tax: Money.of(currency, taxMinor),
    net: Money.of(currency, grossMinor - taxMinor),
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
