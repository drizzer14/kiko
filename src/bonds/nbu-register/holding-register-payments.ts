import {
  asBondMeta,
  type BondMeta,
  asBondPayments,
  type BondPayment,
} from '@kiko/holdings/holding-metadata';
import maybe, { foldMap } from 'fnts/maybe';
import type { Currency } from '@kiko/currency/currency';

import type { BondTerms } from './nbu-register';

/**
 * The register lists each payment for ONE bond of its own nominal, so its
 * cached payments describe a bond only when it was added under that ISIN and
 * carries the same nominal and currency. A Manual bond (no ISIN) keeps its
 * own constant coupon. Null otherwise, when the cache has no payments for the
 * bond, or when they would not parse back once kept in `BondMeta`.
 */
export const cachedRegisterPayments = (
  bond: Pick<BondMeta, 'isin' | 'faceValueMinorUnits'>,
  currency: Currency,
  terms: BondTerms | null,
): BondPayment[] | null => {
  const payments = terms?.payments ?? [];

  if (
    terms === null ||
    payments.length === 0 ||
    terms.isin !== bond.isin ||
    terms.currency !== currency ||
    terms.faceValueMinorUnits !== bond.faceValueMinorUnits
  ) {
    return null;
  }

  return asBondPayments(payments);
};

/**
 * The schedule a stored bond is paid on: the one kept in its metadata, so a
 * bond whose ISIN has left the cache keeps its coupons; else the cached
 * register's. An empty kept schedule is the user's own coupon replacing the
 * register's, so the cache is not read for it either.
 */
export const holdingRegisterPayments = (
  meta: BondMeta,
  currency: Currency,
  terms: BondTerms | null,
): readonly BondPayment[] | null => {
  if (meta.payments === undefined) {
    return cachedRegisterPayments(meta, currency, terms);
  }

  return meta.payments.length === 0 ? null : meta.payments;
};

/**
 * The scheduled coupons a stored bond is paid on, each at its own rate; empty
 * without a schedule, so every coupon falls back to the saved `couponPct`.
 */
export const holdingRegisterCoupons = (
  metadata: unknown,
  currency: Currency,
  terms: BondTerms | null,
): readonly BondPayment[] =>
  foldMap(maybe(asBondMeta(metadata)), (meta) =>
    holdingRegisterPayments(meta, currency, terms)?.filter((payment) => payment.kind === 'coupon'),
  ) ?? [];
