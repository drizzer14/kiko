import {
  asBondMeta,
  type BondMeta,
  hasStoredBondPurchasePrice,
} from '@kiko/holdings/holding-metadata';
import { startOfLocalDay } from '@kiko/dates';
import { Money, toMajor } from '@kiko/currency/money';
import type { Currency } from '@kiko/currency/currency';
import { bondCouponMajor } from '@kiko/holdings/interest';
import { decimalFromJsonNumber, multiplyToMinorUnits } from '@kiko/currency/decimal';

import { couponPeriodDays, type BondTerms } from '../nbu-register';

import { portfolioYieldToMaturity, type CashFlow } from './yield-to-maturity';

const MAX_GENERATED_COUPONS = 2000;

/**
 * The register lists each payment for ONE bond of its own nominal, so the
 * payments describe this holding only when it carries that same nominal and
 * currency; null otherwise, or when the cache has no payments for the bond.
 */
const registerCashFlows = (
  meta: BondMeta,
  currency: Currency,
  terms: BondTerms | null,
): CashFlow[] | null => {
  const quantity = decimalFromJsonNumber(meta.quantity);
  const payments = terms?.payments ?? [];

  if (
    terms === null ||
    quantity === null ||
    payments.length === 0 ||
    terms.currency !== currency ||
    terms.faceValueMinorUnits !== meta.faceValueMinorUnits
  ) {
    return null;
  }

  return payments.map((payment) => ({
    date: payment.date,
    amountMinorUnits: multiplyToMinorUnits([quantity, payment.amount], currency),
  }));
};

/**
 * The schedule of a bond with no register payments: the coupon the ledger
 * books (face x coupon% / payments per year) on each date stepped back from
 * maturity by the register's own period in DAYS (182 for semiannual) while it
 * is after the purchase day, plus the nominal at maturity. Day steps, not
 * calendar months: an NBU bond pays exactly that many days apart, so a bond
 * entered by hand lands on the register's own dates and yield.
 */
const generatedCashFlows = (meta: BondMeta, currency: Currency): CashFlow[] => {
  const nominalMinorUnits = meta.quantity * meta.faceValueMinorUnits;
  const couponMinorUnits = Money.fromMajor(
    currency,
    bondCouponMajor(toMajor(nominalMinorUnits, currency), meta.couponPct, meta.couponFrequency),
  ).minorUnits;
  const periodDays = couponPeriodDays(meta.couponFrequency);
  const maturity = new Date(meta.maturityDate);
  const purchaseDay = startOfLocalDay(meta.purchaseDate);
  const coupons: CashFlow[] = [];

  for (let index = 0; index < MAX_GENERATED_COUPONS; index += 1) {
    const date = new Date(
      maturity.getFullYear(),
      maturity.getMonth(),
      maturity.getDate() - index * periodDays,
    ).getTime();

    if (date <= purchaseDay) {
      break;
    }

    coupons.push({ date, amountMinorUnits: couponMinorUnits });
  }

  return [
    ...coupons,
    { date: startOfLocalDay(meta.maturityDate), amountMinorUnits: nominalMinorUnits },
  ];
};

/**
 * A bond holding's yield to maturity from its stored metadata: the register's
 * own payments for its ISIN when the cache has them (`registerTerms`), else
 * the generated schedule. Null for unparsable metadata or a bond with no
 * price paid.
 */
export const bondYieldToMaturity = (
  metadata: unknown,
  currency: Currency,
  registerTerms: BondTerms | null,
): number | null => {
  const meta = asBondMeta(metadata);

  if (meta === null || !hasStoredBondPurchasePrice(metadata)) {
    return null;
  }

  return portfolioYieldToMaturity([
    {
      date: meta.purchaseDate,
      paidMinorUnits: meta.purchasePriceMinorUnits,
      cashFlows:
        registerCashFlows(meta, currency, registerTerms) ?? generatedCashFlows(meta, currency),
    },
  ]);
};
