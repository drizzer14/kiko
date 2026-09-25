import type { TFunction } from 'i18next';

import { makeEntry } from '../entry-parts';
import { taxOnInterestMinor } from '../../tax';
import { Money, toMajor } from '../../../currency/money';
import type { DerivedEntry } from '../../derived-entries';
import { startOfLocalDay } from '../../../dates/local-day';
import type { ValuableHolding } from '../../holding-value';
import { entityColorsDark } from '../../../design-system/palette';
import { bondCouponDates, bondCouponMajor } from '../../interest';
import { asBondMeta, type BondMeta } from '../../holding-metadata';
import { flat, type HoldingValueBreakdown } from '../breakdown-parts';
import type { HoldingDescriptor, IdentifiedHolding } from '../holding-descriptor.d';

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
  // dip from the purchase day onward. The premium/discount is
  // realized only AT maturity, through the redemption ledger entry that returns
  // the nominal (see `bondEntries` below); the maturity guard above hands the
  // bond off to that entry. The bank pays each coupon out to a cash account on
  // its discrete coupon date (see the ledger entries); it does NOT accrue a
  // continuous dirty price into the held value between coupons, so there is no
  // per-day accrual and no unwind on a coupon date. Interest/tax on the coupon
  // stream are ledger events, not part of the held value.
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

const bondEntries = (holding: IdentifiedHolding, now: number, t: TFunction): DerivedEntry[] => {
  const meta = asBondMeta(holding.metadata);
  if (meta === null) {
    return [];
  }
  const { currency } = holding;
  const nominalMinorUnits = meta.quantity * meta.faceValueMinorUnits;
  const nominalMajor = toMajor(nominalMinorUnits, currency);
  const grossCouponMinor = Money.fromMajor(
    currency,
    bondCouponMajor(nominalMajor, meta.couponPct, meta.couponFrequency),
  ).minorUnits;
  // Each coupon pays out net of the corporate 23% withholding (government bonds
  // are untaxed). The bank credits the net amount, so that is the ledger entry.
  const netCouponMinor =
    grossCouponMinor - (meta.bondKind === 'corporate' ? taxOnInterestMinor(grossCouponMinor) : 0);
  const couponDates = bondCouponDates(meta.purchaseDate, meta.maturityDate, meta.couponFrequency);

  // Purchase (money out), each coupon (money in, net), and redemption of the
  // nominal at maturity (money in). Past entries render as real ledger rows;
  // entries dated after `now` render dimmed as projected.
  return [
    makeEntry(
      holding.id,
      'purchase',
      0,
      meta.purchaseDate,
      -meta.purchasePriceMinorUnits,
      t('holdingDetail.purchase'),
      now,
    ),
    ...couponDates.map((couponDate, index) =>
      makeEntry(
        holding.id,
        'coupon',
        index,
        couponDate,
        netCouponMinor,
        t('holdingDetail.coupon'),
        now,
      ),
    ),
    makeEntry(
      holding.id,
      'redemption',
      0,
      meta.maturityDate,
      nominalMinorUnits,
      t('holdingDetail.redemption'),
      now,
    ),
  ];
};

export const bondDescriptor: HoldingDescriptor = {
  symbol: 'receipt',
  defaultColor: entityColorsDark.green,
  side: 'asset',
  ledgerless: true,
  timeExempt: true,
  fixedCurrency: null,
  exchange: {
    receivePath: 'excluded',
    source: false,
    createSource: false,
    createDestination: false,
  },
  priced: null,
  breakdown: (holding, now) => bondBreakdown(holding, now),
  entries: bondEntries,
};
