import { useLiveQuery, type HoldingRow } from '@kiko/db';
import type { BondTerms } from '@kiko/bonds/nbu-register';
import { asBondMeta } from '@kiko/holdings/holding-metadata';
import { bondRegisterRepo } from '@kiko/bonds/bond-register-repo';

// The ISIN a bond holding was added under, or '' (which matches no row) for a
// bond without one and for every other holding type.
const bondIsinOf = (holding: HoldingRow | undefined): string =>
  holding?.type === 'bond' ? (asBondMeta(holding.metadata)?.isin ?? '') : '';

/**
 * The cached NBU register terms for a bond holding's ISIN — a display-only
 * read for its yield to maturity; the stored bond itself never changes from
 * the register. Disabled for a holding with no ISIN (kiko-architecture: never
 * read data the caller does not need).
 */
export const useBondRegisterTerms = (
  holding: HoldingRow | undefined,
): { terms: BondTerms | null; isLoading: boolean } => {
  const isin = bondIsinOf(holding);
  const { data, isLoading } = useLiveQuery(
    bondRegisterRepo.findByIsinQuery(isin),
    ['bond_register'],
    isin !== '',
    { cached: true },
  );
  // `useLiveQuery` keeps the previous query's rows until the new one settles,
  // so a row is trusted only while its own ISIN is the one asked for.
  const row = data.at(0);

  return { terms: row !== undefined && row.isin === isin ? row.terms : null, isLoading };
};
