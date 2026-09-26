import maybe, { foldMap } from 'fnts/maybe';
import type { Currency } from '@kiko/currency/currency';
import { asBondMeta, type BondMeta } from '@kiko/holdings/holding-metadata';

import type { BondPayment, BondTerms } from './nbu-register';

/**
 * The register lists each payment for ONE bond of its own nominal, so its
 * payments describe a holding only when the holding was added under that
 * ISIN and carries the same nominal and currency. A Manual bond (no ISIN)
 * keeps its own constant coupon. Null otherwise, or when the cache has no
 * payments for the bond.
 */
export const holdingRegisterPayments = (
  meta: BondMeta,
  currency: Currency,
  terms: BondTerms | null,
): readonly BondPayment[] | null => {
  const payments = terms?.payments ?? [];

  if (
    terms === null ||
    payments.length === 0 ||
    terms.isin !== meta.isin ||
    terms.currency !== currency ||
    terms.faceValueMinorUnits !== meta.faceValueMinorUnits
  ) {
    return null;
  }

  return payments;
};

/**
 * The register coupons a stored bond is paid on, each at its own rate; empty
 * when the register does not describe the holding, so every coupon falls back
 * to the saved `couponPct`.
 */
export const holdingRegisterCoupons = (
  metadata: unknown,
  currency: Currency,
  terms: BondTerms | null,
): readonly BondPayment[] =>
  foldMap(maybe(asBondMeta(metadata)), (meta) =>
    holdingRegisterPayments(meta, currency, terms)?.filter((payment) => payment.kind === 'coupon'),
  ) ?? [];
