import {
  refreshRates,
  type FiatRatesOfRun,
  type RatesRefreshOutcome,
  type RefreshDeps,
} from '@kiko/rates/rates-refresh';
import { ratesRepo } from '@kiko/rates/repo';
import { logFailure } from '@kiko/diagnostics';
import { refreshMetalPrices } from '@kiko/prices/metal-refresh';
import either, { bifold, isLeft, left, right, type Either } from 'fnts/either';

/**
 * Which step a failed refresh belongs to. `'auto-sync'` is not one of this
 * module's OWN steps — `useAutoSync` reuses this same logging function for
 * its own outer catch-all (reading accounts/sync-state/credentials), so a
 * background failure there is logged too, tagged distinctly from a
 * `'rates'`/`'metals'` failure this module already logged.
 */
type RefreshStep = 'rates' | 'metals' | 'auto-sync';

/** One step's failure — the raw rejection reason, or a `failed`/`partial`
 * `RatesRefreshOutcome` when the rates step itself never rejected but
 * reported that not every leg wrote. Not exported: a caller reads only
 * whether `refreshMarketData` resolved a `Left`, never this shape directly. */
type RefreshFailure = { step: RefreshStep; reason: unknown };

type RefreshMarketDataOptions = {
  /** Read `ratesRepo.latestFetchedAt()` and pass it through as `refreshRates`'s
   * own throttle cursor. `false` runs unthrottled (fire-and-forget call
   * sites). */
  throttled: boolean;
  /** Also run `refreshMetalPrices` alongside `refreshRates`, under the same
   * `Promise.allSettled`. `false` never calls it at all. */
  metals: boolean;
  /** Shared by every pass of one sync run, so no fiat source is asked twice. */
  fiatOfRun?: FiatRatesOfRun;
};

export type RefreshMarketDataDeps = {
  refreshRates?: (deps: RefreshDeps) => Promise<RatesRefreshOutcome>;
  refreshMetalPrices?: () => Promise<void>;
  latestFetchedAt?: () => Promise<number | null>;
};

/**
 * The one log call site for a rejected rate or metal refresh — the narrowest
 * default: log and return a Left only, no UI and no new string; a
 * banner/toast would add translation keys and need key review. The next
 * refresh tries again.
 */
export const warnRefreshFailure = (step: RefreshStep, reason: unknown): void => {
  logFailure(`[refresh-market-data] ${step} refresh failed`, reason);
};

const rateFailures = (settled: PromiseSettledResult<RatesRefreshOutcome>): RefreshFailure[] => {
  if (settled.status === 'rejected') {
    warnRefreshFailure('rates', settled.reason);

    return [{ step: 'rates', reason: settled.reason }];
  }

  const { state, failedLegs } = settled.value;

  if (state !== 'failed' && state !== 'partial') {
    return [];
  }

  // An outcome is a plain object with no name or code, so the sink alone
  // would log only `object`; its state and legs are closed enums with no
  // user data, so they are safe in the tag.
  logFailure(`[refresh-market-data] rates ${state}: ${failedLegs.join(',')}`, settled.value);

  return [{ step: 'rates', reason: settled.value }];
};

/**
 * The single entry point every sync surface (`useSync`, `useSyncAll`,
 * `useAutoSync`) and every fire-and-forget "first add" trigger
 * (`holding-form.screen.tsx`, `import-data.ts`) calls to refresh rates and
 * metal prices. Never rejects — every step runs under
 * `Promise.allSettled`, so a rejected promise (or `refreshRates`'s own
 * `'failed'`/`'partial'` outcome) is collected as a `RefreshFailure`, logged
 * (a rejection through `warnRefreshFailure`, an outcome with its state and
 * failed legs in the tag), and returned as a `Left`; a fully successful run
 * (or a `'skipped'`/`'refreshed'` rates outcome with no metals failure)
 * returns a `Right`.
 *
 * `throttled` reads `ratesRepo.latestFetchedAt()` FIRST, before any step
 * runs — a failed read is itself collected and logged as a `'rates'`
 * failure, and the refresh then proceeds UNTHROTTLED (`lastRefreshAt: null`)
 * rather than let a broken cursor read silently suppress a refresh the user
 * needs. `throttled: false` never reads the cursor at all (today's
 * fire-and-forget call sites stay unthrottled).
 */
export const refreshMarketData = async (
  options: RefreshMarketDataOptions,
  deps: RefreshMarketDataDeps = {},
): Promise<Either<RefreshFailure[], void>> => {
  const runRefreshRates = deps.refreshRates ?? refreshRates;
  const runRefreshMetalPrices = deps.refreshMetalPrices ?? refreshMetalPrices;
  const loadLatestFetchedAt = deps.latestFetchedAt ?? ratesRepo.latestFetchedAt;

  const failures: RefreshFailure[] = [];
  let lastRefreshAt: number | null = null;

  const collectFailure = (failure: RefreshFailure): void => {
    failures.push(failure);
    warnRefreshFailure(failure.step, failure.reason);
  };

  if (options.throttled) {
    const cursor = await either<unknown, number | null>(loadLatestFetchedAt);

    if (isLeft(cursor)) {
      collectFailure({ step: 'rates', reason: bifold(cursor) });
    } else {
      lastRefreshAt = bifold(cursor);
    }
  }

  const [ratesSettled, metalsSettled] = await Promise.allSettled([
    runRefreshRates({ lastRefreshAt, fiatOfRun: options.fiatOfRun }),
    options.metals ? runRefreshMetalPrices() : Promise.resolve(),
  ]);

  failures.push(...rateFailures(ratesSettled));

  if (options.metals && metalsSettled.status === 'rejected') {
    collectFailure({ step: 'metals', reason: metalsSettled.reason });
  }

  return failures.length > 0 ? left(failures) : right(undefined);
};
