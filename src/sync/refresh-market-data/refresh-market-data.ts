import {
  refreshRates,
  type RatesRefreshOutcome,
  type RefreshDeps,
} from '@kiko/rates/rates-refresh';
import { ratesRepo } from '@kiko/rates/repo';
import { refreshMetalPrices } from '@kiko/prices/metal-refresh';
import either, { bifold, isLeft, left, right, type Either } from 'fnts/either';

/**
 * Which step a failed refresh belongs to. `'auto-sync'` is not one of this
 * module's OWN steps — `useAutoSync` reuses this same logging function for
 * its own outer catch-all (reading accounts/sync-state/credentials), so a
 * background failure it used to silently drop is logged too, tagged
 * distinctly from a `'rates'`/`'metals'` failure this module already logged.
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
   * sites, unchanged from before this refactor). */
  throttled: boolean;
  /** Also run `refreshMetalPrices` alongside `refreshRates`, under the same
   * `Promise.allSettled`. `false` never calls it at all. */
  metals: boolean;
};

export type RefreshMarketDataDeps = {
  refreshRates?: (deps: RefreshDeps) => Promise<RatesRefreshOutcome>;
  refreshMetalPrices?: () => Promise<void>;
  latestFetchedAt?: () => Promise<number | null>;
};

/**
 * The one `console.warn` call site for a failed rate or metal refresh — the
 * narrowest default: log and return a Left only, no UI and no new string; a
 * banner/toast would add translation keys and need key review. Exported so
 * a test can spy on `console.warn` directly rather than parse output.
 */
export const warnRefreshFailure = (step: RefreshStep, reason: unknown): void => {
  // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) a failed rate/metal refresh has no UI surface — log it so a device log shows what silently failed; the next refresh tries again (precedent: run-crypto-sync.ts's identical OVERRIDE for a swallowed Binance transaction-import failure).
  console.warn(`[refresh-market-data] ${step} refresh failed`, reason);
};

/**
 * The single entry point every sync surface (`useSync`, `useSyncAll`,
 * `useAutoSync`) and every fire-and-forget "first add" trigger
 * (`holding-form.screen.tsx`, `import-data.ts`) now calls instead of a raw
 * `Promise.allSettled([refreshRates(...), refreshMetalPrices()])`. Never
 * rejects — every step runs under `Promise.allSettled`, so a rejected
 * promise (or `refreshRates`'s own `'failed'`/`'partial'` outcome) is
 * collected as a `RefreshFailure`, logged through `warnRefreshFailure`, and
 * returned as a `Left`; a fully successful run (or a `'skipped'`/`'refreshed'`
 * rates outcome with no metals failure) returns a `Right`.
 *
 * `throttled` reads `ratesRepo.latestFetchedAt()` FIRST, before either step
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

  if (options.throttled) {
    const cursor = await either<unknown, number | null>(loadLatestFetchedAt);
    if (isLeft(cursor)) {
      failures.push({ step: 'rates', reason: bifold(cursor) });
    } else {
      lastRefreshAt = bifold(cursor);
    }
  }

  const [ratesSettled, metalsSettled] = await Promise.allSettled([
    runRefreshRates({ lastRefreshAt }),
    options.metals ? runRefreshMetalPrices() : Promise.resolve(),
  ]);

  if (ratesSettled.status === 'rejected') {
    failures.push({ step: 'rates', reason: ratesSettled.reason });
  } else if (ratesSettled.value.state === 'failed' || ratesSettled.value.state === 'partial') {
    failures.push({ step: 'rates', reason: ratesSettled.value });
  }

  if (options.metals && metalsSettled.status === 'rejected') {
    failures.push({ step: 'metals', reason: metalsSettled.reason });
  }

  for (const failure of failures) {
    warnRefreshFailure(failure.step, failure.reason);
  }

  return failures.length > 0 ? left(failures) : right(undefined);
};
