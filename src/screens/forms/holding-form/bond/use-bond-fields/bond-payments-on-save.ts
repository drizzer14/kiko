import type { Currency } from '@kiko/currency/currency';
import type { BondMeta, BondPayment } from '@kiko/holdings/holding-metadata';
import { type BondTerms, cachedRegisterPayments } from '@kiko/bonds/nbu-register';

import type { BondEntryMode } from '../bond-isin-section/bond-isin-section.props';

/** The fields of a bond about to be saved that decide which schedule it keeps. */
export type BondToSave = Pick<
  BondMeta,
  'isin' | 'faceValueMinorUnits' | 'couponPct' | 'couponFrequency'
> & { currency: Currency };

type SavedBond = { meta: BondMeta; currency: Currency };

type BondPaymentsOnSaveParams = {
  bondMode: BondEntryMode;
  registerTerms: BondTerms | null;
  // The bond as stored before this edit; null on create.
  saved: SavedBond | null;
  next: BondToSave;
};

const identityChanged = (saved: SavedBond, next: BondToSave): boolean =>
  saved.meta.isin !== next.isin ||
  saved.meta.faceValueMinorUnits !== next.faceValueMinorUnits ||
  saved.currency !== next.currency;

const couponChanged = (saved: SavedBond, next: BondToSave): boolean =>
  saved.meta.couponPct !== next.couponPct || saved.meta.couponFrequency !== next.couponFrequency;

/**
 * The schedule a bond keeps in its metadata on Save. ISIN mode takes the
 * matched register's. Manual mode keeps the saved one, or captures the
 * matched register's for a bond saved without one, since a register refresh
 * can land while the form is open. An edited ISIN, face value or currency is
 * another bond, so it keeps none and reads the cache. An edited coupon or
 * frequency on an ISIN bond is the user's own coupon: an empty schedule, so
 * the cache cannot override it either.
 */
export const bondPaymentsOnSave = ({
  bondMode,
  registerTerms,
  saved,
  next,
}: BondPaymentsOnSaveParams): BondPayment[] | undefined => {
  const registerPayments = cachedRegisterPayments(next, next.currency, registerTerms) ?? undefined;

  if (bondMode === 'isin' && registerPayments !== undefined) {
    return registerPayments;
  }

  if (saved === null || identityChanged(saved, next)) {
    return undefined;
  }

  if (bondMode === 'manual' && next.isin !== undefined && couponChanged(saved, next)) {
    return [];
  }

  return saved.meta.payments ?? registerPayments;
};
