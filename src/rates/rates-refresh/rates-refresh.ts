import { ratesRepo } from '@kiko/rates/repo';
import either, { bifold, isLeft } from 'fnts/either';

import {
  openCurrencies as defaultOpenCurrencies,
  type OpenCurrencies,
} from '../open-currencies-gate';
import {
  isCrypto,
  currencyOptions,
  type Currency,
  type CryptoCurrency,
} from '../../currency/currency';
import type { RateEntry } from '../conversion';
import { fetchCryptoPrices } from '../coingecko';
import { fetchNbuFiatRates } from '../nbu-rates';
import { fetchFiatRates } from '../monobank-rates';

// Monobank's `/bank/currency` is cached upstream ~5 minutes, so refreshing more
// often than that only re-fetches identical data.
const FIVE_MINUTES_MS = 5 * 60 * 1000;

// Derived from currency.ts so the written row set always matches the app's
// supported currencies. A currency with no fetched UAH price is skipped by
// buildUahRows (its price is undefined), so listing all of them here — UAH
// included, filtered out inside the loop — is safe.
const allCurrencies: readonly Currency[] = currencyOptions;

/** Each currency's value expressed in UAH — the pivot for composing pairs. */
type UahPrice = Partial<Record<Currency, number>>;

type StoredRate = {
  base: Currency;
  quote: Currency;
  rate: string;
  source: 'monobank' | 'coingecko' | 'nbu';
  fetchedAt: number;
};

export type RefreshDeps = {
  fetchFiatRates?: () => Promise<RateEntry[]>;
  /**
   * NBU's unpinned current-rate fallback (`nbu-rates.ts`), tried only once
   * `fetchFiatRates` has failed every retry — see `refreshRates` below.
   */
  fetchNbuRates?: () => Promise<RateEntry[]>;
  fetchCryptoPrices?: (currencies: CryptoCurrency[]) => Promise<RateEntry[]>;
  upsertMany?: (rates: StoredRate[]) => Promise<void>;
  now?: () => number;
  lastRefreshAt?: number | null;
  sleep?: (ms: number) => Promise<void>;
  /**
   * The data-presence gate (kiko-architecture: app-open/refresh work is
   * gated on data presence — no request or query for data the user does not
   * have), shared with `runBackfill` (`history-backfill.ts`) — see
   * `open-currencies-gate.ts`. Defaults to a real read of `settingsRepo` +
   * `holdingsRepo`'s one cheap `openCurrenciesQuery`.
   */
  openCurrencies?: () => Promise<OpenCurrencies>;
  /**
   * Distinct currencies with at least one stored row in `currency_rates` —
   * the cheap presence check the throttle below reads before honoring the
   * cache window, so a currently-held currency (crypto or fiat) with NO rate
   * at all is never left stuck behind another connection's throttle window.
   * Defaults to a real read of `ratesRepo.presentCurrenciesQuery()`.
   */
  presentCurrencies?: () => Promise<Currency[]>;
};

// Part B: a small, bounded backoff for a FAILED live fetch — two retries, so a
// transient network blip or a single 429 doesn't leave live rates stuck
// behind the (approximate) fiat seed fallback for the whole 5-minute
// throttle window above. Bounded on purpose: this never hammers the
// endpoint — it is capped at 3 total attempts per `refreshRates` call, and
// the throttle above still gates how often a call happens at all.
const RETRY_DELAYS_MS = [1_000, 3_000] as const;

/**
 * Retries a failing live-rate fetch with `RETRY_DELAYS_MS`'s backoff. Gives
 * up after the last delay and lets the final rejection propagate, exactly
 * like an unretried failure would — `refreshRates`'s `Promise.allSettled`
 * still treats it as "this provider did not survive this run" and falls
 * back to whatever the OTHER provider (or the fiat seed) contributes.
 */
const withRetry = async <T>(
  fetchFn: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
): Promise<T> => {
  try {
    return await fetchFn();
  } catch (firstError) {
    let lastError = firstError;

    for (const delay of RETRY_DELAYS_MS) {
      await sleep(delay);
      try {
        return await fetchFn();
      } catch (retryError) {
        lastError = retryError;
      }
    }
    throw lastError;
  }
};

/**
 * Express each currency in UAH. Fiat entries anchor USD/EUR to UAH directly;
 * every crypto is anchored through its USD price so crypto pairs stay consistent
 * with fiat. A crypto with no USD anchor (no fiat USD price this run) is simply
 * left unpriced, so `buildUahRows` skips it rather than composing a false rate.
 */
const buildUahPrice = (fiat: RateEntry[], crypto: RateEntry[]): UahPrice => {
  const price: UahPrice = { UAH: 1 };

  for (const entry of fiat) {
    if (entry.quote === 'UAH') {
      price[entry.base] = entry.rate;
    } else if (entry.base === 'UAH') {
      price[entry.quote] = 1 / entry.rate;
    }
  }
  const usdPrice = price.USD;

  if (usdPrice !== undefined) {
    for (const entry of crypto) {
      if (entry.quote === 'USD' && isCrypto(entry.base)) {
        price[entry.base] = entry.rate * usdPrice;
      }
    }
  }

  return price;
};

/**
 * Compose one `X:UAH` row per priced currency (`X !== 'UAH'`) from the
 * UAH-anchored prices — never a cross row between two non-UAH currencies; a
 * cross rate resolves at READ TIME through the UAH pivot (`rateBetween`,
 * `conversion.ts`), so it does not need its own stored row. A rate is stored
 * as a string, never a float, to match the CurrencyRate column contract.
 *
 * `fiatSource` labels every composed fiat row with whichever provider's
 * UAH-anchored prices actually fed `price` — `refreshRates` below passes
 * `'nbu'` when the Monobank fetch failed and NBU's fallback rows supplied the
 * pivot instead, so a stored row's provenance stays accurate. Defaults to
 * `'monobank'` for every other caller (a live Monobank-sourced run). Every
 * crypto row is tagged `'coingecko'` regardless of `fiatSource`, since its
 * rate is CoinGecko's own USD price times the same-run fiat anchor.
 */
const buildUahRows = (
  price: UahPrice,
  fetchedAt: number,
  fiatSource: 'monobank' | 'nbu' = 'monobank',
): StoredRate[] => {
  const rows: StoredRate[] = [];

  for (const base of allCurrencies) {
    const rate = price[base];

    if (base === 'UAH' || rate === undefined) {
      continue;
    }
    rows.push({
      base,
      quote: 'UAH',
      rate: String(rate),
      source: isCrypto(base) ? 'coingecko' : fiatSource,
      fetchedAt,
    });
  }

  return rows;
};

/** The fiat leg, gated on `needsFiat` — `[]` without ever calling `loadFiatWithFallback`. */
const runFiatLeg = (
  needsFiat: boolean,
  loadFiatWithFallback: () => Promise<RateEntry[]>,
): Promise<RateEntry[]> => (needsFiat ? loadFiatWithFallback() : Promise.resolve([]));

/** The crypto leg, gated on a non-empty held set — `[]` without ever calling `loadCrypto`. */
const runCryptoLeg = (
  cryptoCurrencies: CryptoCurrency[],
  loadCrypto: (currencies: CryptoCurrency[]) => Promise<RateEntry[]>,
  sleep: (ms: number) => Promise<void>,
): Promise<RateEntry[]> =>
  cryptoCurrencies.length > 0
    ? withRetry(() => loadCrypto(cryptoCurrencies), sleep)
    : Promise.resolve([]);

/** Every currency with at least one stored row in `currency_rates`, base or quote. */
const defaultPresentCurrencies = async (): Promise<Currency[]> => {
  const rows = await ratesRepo.presentCurrenciesQuery();

  return rows.map((row) => row.currency);
};

/**
 * The throttle exists to respect Monobank's own ~5-minute cache window, not
 * to leave a currently-held currency permanently unrated — a Monobank
 * connect at t0 writes fiat only, and a Binance connect inside that window
 * must not have BTC's rate suppressed until the window elapses. Resolves
 * `true` only when the cache window is active AND every held currency
 * (crypto or fiat) already has a `currency_rates` row — a real gap (a held
 * currency with none at all) always skips the throttle.
 *
 * `UAH` is excluded from the presence check: a star row's `quote` is always
 * `UAH` and its `base` never is, so `presentCurrencies` (a distinct `base`
 * read) can never list `UAH` — without this exclusion, a base-USD user who
 * holds UAH would read as permanently "unrated" and bypass the throttle on
 * every sync instead of only a genuine gap.
 */
const shouldThrottle = async (
  at: number,
  deps: RefreshDeps,
  nonBaseCurrencies: Currency[] | undefined,
): Promise<boolean> => {
  const lastRefreshAt = deps.lastRefreshAt ?? null;
  const withinWindow = lastRefreshAt !== null && at - lastRefreshAt < FIVE_MINUTES_MS;

  if (!withinWindow) {
    return false;
  }
  const loadPresentCurrencies = deps.presentCurrencies ?? defaultPresentCurrencies;
  const present = new Set(await loadPresentCurrencies());

  return (nonBaseCurrencies ?? [])
    .filter((currency) => currency !== 'UAH')
    .every((currency) => present.has(currency));
};

/**
 * The outcome of one `refreshRates` call, mirroring `BackfillStatus`
 * (`history-backfill.ts`) so a caller can log and surface a failed run
 * without the promise ever rejecting. `'skipped'`: the data-presence gate or
 * the throttle window meant neither leg ran. `'refreshed'`: every attempted
 * leg (an unattempted leg, per the data-presence gate, never counts against
 * this) settled. `'partial'`: one attempted leg rejected, the other
 * succeeded. `'failed'`: every attempted leg rejected — nothing is written
 * (this still never happens for a leg the gate skipped entirely).
 */
export type RatesRefreshOutcome = {
  state: 'skipped' | 'refreshed' | 'partial' | 'failed';
  failedLegs: ('fiat' | 'crypto')[];
};

/**
 * Resolves the terminal `RatesRefreshOutcome` from each leg's settled
 * result — `fiatAttempted`/`cryptoAttempted` come from the SAME data-presence
 * gate verdict the run itself used, so a leg the gate never attempted can
 * never count as failed.
 */
const resolveOutcome = (
  fiatAttempted: boolean,
  cryptoAttempted: boolean,
  fiatResult: PromiseSettledResult<RateEntry[]>,
  cryptoResult: PromiseSettledResult<RateEntry[]>,
): RatesRefreshOutcome => {
  const failedLegs: RatesRefreshOutcome['failedLegs'] = [];

  if (fiatAttempted && fiatResult.status === 'rejected') {
    failedLegs.push('fiat');
  }

  if (cryptoAttempted && cryptoResult.status === 'rejected') {
    failedLegs.push('crypto');
  }
  const attemptedLegs = (fiatAttempted ? 1 : 0) + (cryptoAttempted ? 1 : 0);

  if (failedLegs.length === 0) {
    return { state: 'refreshed', failedLegs };
  }

  return { state: failedLegs.length === attemptedLegs ? 'failed' : 'partial', failedLegs };
};

/**
 * Fetch fiat and BTC rates, compose one `X:UAH` row per priced currency, and
 * upsert them. Skips work while the last refresh is still inside Monobank's
 * cache window. Providers and the repo write are injectable for tests.
 */
export const refreshRates = async (deps: RefreshDeps = {}): Promise<RatesRefreshOutcome> => {
  const now = deps.now ?? Date.now;
  const at = now();

  const openCurrencies = deps.openCurrencies ?? defaultOpenCurrencies;
  const { needsFiat, cryptoCurrencies, nonBaseCurrencies } = await openCurrencies();

  // kiko-architecture: no request or query for data the user does not have —
  // nothing open that differs from the base currency, and no crypto held,
  // means neither leg has anything to fetch this run.
  if (!needsFiat && cryptoCurrencies.length === 0) {
    return { state: 'skipped', failedLegs: [] };
  }

  if (await shouldThrottle(at, deps, nonBaseCurrencies)) {
    return { state: 'skipped', failedLegs: [] };
  }

  const loadFiat = deps.fetchFiatRates ?? (() => fetchFiatRates());
  const loadNbuFiat = deps.fetchNbuRates ?? (() => fetchNbuFiatRates());
  const loadCrypto =
    deps.fetchCryptoPrices ??
    ((currencies: CryptoCurrency[]) => fetchCryptoPrices(fetch, currencies));
  const upsertMany = deps.upsertMany ?? ratesRepo.upsertMany;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  // Monobank's `/bank/currency` host is certificate-pinned
  // (`ios/Kiko/Info.plist`'s `NSPinnedDomains`) and stays the PREFERRED fiat
  // source (its bank-BUY-rate choice, `monobank-rates.ts`). NBU (`bank.gov.ua`,
  // deliberately UNPINNED) is the live fallback, reached for only once
  // Monobank's own bounded retry (Part B, `withRetry`) is exhausted — a
  // SEQUENTIAL fallback, not a second concurrent provider: only ONE source's
  // rows are ever composed and stored per run. `fiatSource` tracks which one
  // answered so the composed rows are labeled with accurate provenance
  // (`buildUahRows` above).
  let fiatSource: 'monobank' | 'nbu' = 'monobank';
  const loadFiatWithFallback = async (): Promise<RateEntry[]> => {
    const attempt = await either<unknown, RateEntry[]>(() => withRetry(loadFiat, sleep));

    if (isLeft(attempt)) {
      fiatSource = 'nbu';

      return loadNbuFiat();
    }

    return bifold(attempt);
  };

  // Settle the fiat (with its NBU fallback) and crypto pipelines
  // independently, exactly as `runBackfill` does (rates/history-backfill.ts).
  // `Promise.all` discarded a successful fiat fetch whenever CoinGecko 429'd
  // or returned a malformed body, left the stale rate table in place, and
  // propagated the rejection through `useSyncAction` — so a fiat import that
  // fully succeeded was reported to the user as a failed sync. Whichever
  // pipeline survives still contributes its anchors. Each leg is ALSO gated
  // individually on `openCurrencies`'s own verdict: a leg with nothing to
  // convert/hold resolves to `[]` without ever calling its fetch function.
  const [fiatResult, cryptoResult] = await Promise.allSettled([
    runFiatLeg(needsFiat, loadFiatWithFallback),
    runCryptoLeg(cryptoCurrencies, loadCrypto, sleep),
  ]);
  const fiat = fiatResult.status === 'fulfilled' ? fiatResult.value : [];
  const crypto = cryptoResult.status === 'fulfilled' ? cryptoResult.value : [];
  const rows = buildUahRows(buildUahPrice(fiat, crypto), at, fiatSource);

  if (rows.length > 0) {
    await upsertMany(rows);
  }

  return resolveOutcome(needsFiat, cryptoCurrencies.length > 0, fiatResult, cryptoResult);
};
