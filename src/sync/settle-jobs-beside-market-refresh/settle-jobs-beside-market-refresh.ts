import { holdingsRepo } from '@kiko/holdings/repo';
import type { FiatRatesOfRun } from '@kiko/rates/rates-refresh';
import { refreshMarketData } from '@kiko/sync/refresh-market-data';

import type { SyncJob } from '../sync-jobs';
import { SYNC_CONCURRENCY_LIMIT, settleAllLimited } from '../settle-limited';

// A read that fails reads as `null`, so the top-up check below simply skips.
const heldCurrencies = (): Promise<Set<string> | null> => {
  return holdingsRepo.openCurrenciesQuery().then(
    (rows) => new Set(rows.map((row) => row.currency)),
    () => null,
  );
};

const gainedCurrency = (before: Set<string> | null, after: Set<string> | null): boolean => {
  if (before === null || after === null) {
    return false;
  }

  return [...after].some((currency) => !before.has(currency));
};

/**
 * One sync fan-out (`useAutoSync` on open, `useSyncAll` on a pull) with the
 * market data refresh (rates, metals) running BESIDE it. The refresh
 * needs none of the fan-out's output, and the provider requests are gated at
 * one per minute per token, so starting it after the fan-out would leave rates
 * and prices stale for as many minutes as there are cards. Both never reject,
 * so this settles only once both have, and returns every job's settled result
 * in job order.
 *
 * The refresh's data-presence gate reads the held currencies when it starts,
 * so a currency the jobs bring in for the first time (a new exchange asset, a
 * new bank jar) has no rate in that refresh. When the held set gained one, a
 * rates-only refresh runs after the jobs: the rates throttle skips it unless
 * that currency really has no rate yet. It is conditional because running it
 * every time would be a second pass over the rates for nothing. Both passes
 * share one `fiatOfRun`, so the top-up reads the fiat answer (or failure) the
 * first pass got rather than asking Monobank again, which allows about one
 * call per client per five minutes and would answer 429 within a run.
 */
export const settleJobsBesideMarketRefresh = async (
  jobs: SyncJob[],
): Promise<PromiseSettledResult<unknown>[]> => {
  if (jobs.length === 0) {
    await refreshMarketData({ throttled: true, metals: true });

    return [];
  }

  // Not awaited: the single database worker runs a read in the order it was
  // queued, so queueing it before the jobs start puts it ahead of their
  // writes without delaying their start.
  const before = heldCurrencies();
  const fiatOfRun: FiatRatesOfRun = { storedFiat: new Set() };
  const [results] = await Promise.all([
    settleAllLimited(
      jobs.map((job) => job.run),
      SYNC_CONCURRENCY_LIMIT,
    ),
    refreshMarketData({ throttled: true, metals: true, fiatOfRun }),
  ]);

  if (gainedCurrency(await before, await heldCurrencies())) {
    await refreshMarketData({ throttled: true, metals: false, fiatOfRun });
  }

  return results;
};
