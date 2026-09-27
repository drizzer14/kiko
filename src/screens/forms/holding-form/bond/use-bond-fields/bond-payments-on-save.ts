import type { Currency } from '@kiko/currency/currency';
import { type BondTerms, cachedRegisterPayments } from '@kiko/bonds/nbu-register';
import type { BondMeta, BondPayment, BondEntryMode } from '@kiko/holdings/holding-metadata';

/** The fields of a bond about to be saved that decide which schedule it keeps. */
export type BondToSave = Pick<
  BondMeta,
  'isin' | 'faceValueMinorUnits' | 'couponPct' | 'couponFrequency'
> & { currency: Currency };

export type SavedBond = { meta: BondMeta; currency: Currency };

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

// A register row with an unmapped frequency makes the user pick one, so only
// the coupon % can tell a typed coupon from the matched one.
const couponChanged = (
  from: Pick<BondTerms, 'couponPct' | 'couponFrequency'>,
  next: BondToSave,
): boolean =>
  from.couponPct !== next.couponPct ||
  (from.couponFrequency !== null && from.couponFrequency !== next.couponFrequency);

/**
 * The schedule a bond keeps in its metadata on Save. ISIN mode takes the
 * matched register's. Manual mode keeps the saved one, or captures the
 * matched register's for a bond saved without one, since a register refresh
 * can land while the form is open. An edited ISIN, face value or currency is
 * another bond, so it keeps none and reads the cache. A coupon or frequency
 * the user typed over the saved or matched one, on an ISIN bond, is the
 * user's own coupon: an empty schedule, so the cache cannot override it
 * either.
 *
 * A Manual create with an ISIN copies the matched register's schedule while
 * its coupon (and mapped frequency) still match; a typed coupon, or no matched
 * row (an unknown ISIN or an empty cache), gives `[]`. A create without an ISIN, or an ISIN
 * create with no cached payments, keeps none.
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

  if (saved === null) {
    if (bondMode === 'isin' || next.isin === undefined) {
      return undefined;
    }

    return registerTerms === null || couponChanged(registerTerms, next) ? [] : registerPayments;
  }

  if (identityChanged(saved, next)) {
    return undefined;
  }

  if (bondMode === 'manual' && next.isin !== undefined && couponChanged(saved.meta, next)) {
    return [];
  }

  return saved.meta.payments ?? registerPayments;
};
