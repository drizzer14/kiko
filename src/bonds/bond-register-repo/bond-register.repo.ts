import { eq, max } from 'drizzle-orm';
import { type Repository, database, write, type BondRegisterRow, bondRegister } from '@kiko/db';

import { dayKeyOf } from '../../prices/price-book';
import { fetchNbuRegister, type BondTerms } from '../nbu-register';

type NewBondRegisterRow = Pick<BondRegisterRow, 'isin' | 'terms' | 'fetchedAt'>;

export const bondRegisterRepo = {
  findByIsinQuery: (isin: string) =>
    database.select().from(bondRegister).where(eq(bondRegister.isin, isin)),
  /**
   * The cache-wide `fetchedAt` high-water mark — every row shares one
   * write-time stamp (`replaceAll` writes them all in the same call), so a
   * `MAX` here reads the same value a `LIMIT 1` would. Awaited directly by
   * `refreshBondRegisterIfStale`'s default `fetchedAt` dependency.
   */
  fetchedAtQuery: () => database.select({ value: max(bondRegister.fetchedAt) }).from(bondRegister),
  /**
   * Replaces the whole cache in ONE transaction: every existing row is
   * deleted, then the fresh register rows are inserted — a REPLACE, not a
   * merge, since a matured/delisted ISIN must disappear from the cache the
   * same run it disappears from the live register, not linger as a stale
   * row an upsert would leave behind.
   */
  replaceAll: (rows: NewBondRegisterRow[]) =>
    write(async (databaseTransaction) => {
      await databaseTransaction.delete(bondRegister);

      if (rows.length === 0) {
        return;
      }

      await databaseTransaction.insert(bondRegister).values(rows);
    }),
} satisfies Repository;

export type RefreshBondRegisterDeps = {
  now?: () => number;
  fetchImpl?: typeof fetch;
  /** The cache's current `fetchedAt` high-water mark, or null when never refreshed. */
  fetchedAt?: () => Promise<number | null>;
  fetchRegister?: (fetchImpl: typeof fetch) => Promise<BondTerms[]>;
  replaceAll?: (rows: NewBondRegisterRow[]) => Promise<void>;
};

const defaultFetchedAt = async (): Promise<number | null> => {
  const rows = await bondRegisterRepo.fetchedAtQuery();

  return rows.at(0)?.value ?? null;
};

/**
 * Refreshes `bond_register` from the NBU securities register, at most once
 * per LOCAL day — the ISIN-mode form opens far more often than the register
 * actually changes, so re-fetching every open would just hammer a public
 * host for identical data. Compares the cache's `fetchedAt` high-water
 * mark's LOCAL calendar day against `now`'s, through the same `dayKeyOf`
 * convention `price_points` uses (`kiko-pricing`) — a device-local day, not
 * a UTC one, so a refresh just after local midnight is never mistaken for
 * "already run today" against a stamp from the previous evening. Every
 * fetched row is written through ONE `replaceAll` call. An empty fetch
 * result (0 rows — a malformed/empty response body, never observed from the
 * live register) is NOT written: it would wipe a good cache via
 * `replaceAll([])`, and an offline form open needs that cache. The stale
 * cache is left in place, and `fetchedAt` does not advance, so the next
 * open retries the fetch.
 */
export const refreshBondRegisterIfStale = async (
  deps: RefreshBondRegisterDeps = {},
): Promise<void> => {
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const fetchedAt = deps.fetchedAt ?? defaultFetchedAt;
  const fetchRegister = deps.fetchRegister ?? fetchNbuRegister;
  const replaceAll = deps.replaceAll ?? bondRegisterRepo.replaceAll;

  const at = now();
  const lastFetchedAt = await fetchedAt();

  if (lastFetchedAt !== null && dayKeyOf(lastFetchedAt) === dayKeyOf(at)) {
    return;
  }

  const terms = await fetchRegister(fetchImpl);

  if (terms.length === 0) {
    return;
  }

  await replaceAll(terms.map((bond) => ({ isin: bond.isin, terms: bond, fetchedAt: at })));
};
