import { ratesRepo } from '@kiko/rates/repo';

import type { RateEntry } from '../conversion';
import { fetchCryptoPrices } from '../coingecko';
import { fetchFiatRates } from '../monobank-rates';
import type { Currency } from '../../currency/currency';
import { currencyOptions, isCrypto } from '../../currency/currency';

// Monobank's `/bank/currency` is cached upstream ~5 minutes, so refreshing more
// often than that only re-fetches identical data.
const FIVE_MINUTES_MS = 5 * 60 * 1000;

// Derived from currency.ts so the composed pair set always matches the app's
// supported currencies. A currency with no fetched UAH price is skipped by
// buildPairs (its price is undefined), so listing all of them here is safe.
const allCurrencies: readonly Currency[] = currencyOptions;

/** Each currency's value expressed in UAH — the pivot for composing pairs. */
type UahPrice = Partial<Record<Currency, number>>;

type StoredRate = {
  base: Currency;
  quote: Currency;
  rate: string;
  source: 'monobank' | 'coingecko';
  fetchedAt: number;
};

export type RefreshDeps = {
  fetchFiatRates?: () => Promise<RateEntry[]>;
  fetchCryptoPrices?: () => Promise<RateEntry[]>;
  upsertMany?: (rates: StoredRate[]) => Promise<void>;
  now?: () => number;
  lastRefreshAt?: number | null;
  sleep?: (ms: number) => Promise<void>;
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
 * left unpriced, so `buildPairs` skips it rather than composing a false rate.
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

const pairSource = (base: Currency, quote: Currency): 'monobank' | 'coingecko' =>
  isCrypto(base) || isCrypto(quote) ? 'coingecko' : 'monobank';

/**
 * Compose every ordered distinct pair from the UAH-anchored prices. A rate is
 * stored as a string, never a float, to match the CurrencyRate column contract.
 *
 * Exported so `fiat-rate-seed.ts` composes the bundled offline fiat fallback
 * table through this SAME logic, from a static UAH-price snapshot instead of
 * a live fetch — the seed's shape is then guaranteed identical to what a live
 * refresh would have produced, rather than a second, drift-prone reimplementation.
 */
export const buildPairs = (price: UahPrice, fetchedAt: number): StoredRate[] => {
  const pairs: StoredRate[] = [];
  for (const base of allCurrencies) {
    for (const quote of allCurrencies) {
      const from = price[base];
      const to = price[quote];
      if (base === quote || from === undefined || to === undefined) {
        continue;
      }
      pairs.push({
        base,
        quote,
        rate: String(from / to),
        source: pairSource(base, quote),
        fetchedAt,
      });
    }
  }
  return pairs;
};

/**
 * Fetch fiat and BTC rates, compose all cross pairs the app can convert
 * between, and upsert them. Skips work while the last refresh is still inside
 * Monobank's cache window. Providers and the repo write are injectable for tests.
 */
export const refreshRates = async (deps: RefreshDeps = {}): Promise<void> => {
  const now = deps.now ?? Date.now;
  const at = now();
  const lastRefreshAt = deps.lastRefreshAt ?? null;
  if (lastRefreshAt !== null && at - lastRefreshAt < FIVE_MINUTES_MS) {
    return;
  }
  const loadFiat = deps.fetchFiatRates ?? (() => fetchFiatRates());
  const loadCrypto = deps.fetchCryptoPrices ?? (() => fetchCryptoPrices());
  const upsertMany = deps.upsertMany ?? ratesRepo.upsertMany;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  // Settle the two providers independently, exactly as `runBackfill` does
  // (rates/history-backfill.ts). `Promise.all` discarded a successful Monobank
  // fiat fetch whenever CoinGecko 429'd or returned a malformed body, left the
  // stale rate table in place, and propagated the rejection through
  // `useSyncAction` — so a Monobank import that fully succeeded was reported
  // to the user as a failed sync. Whichever provider survives still
  // contributes its anchors. Each fetch RETRIES on failure first (Part B,
  // `withRetry`) — only a fetch that is STILL failing after every retry
  // reaches `allSettled` as a rejection.
  const [fiatResult, cryptoResult] = await Promise.allSettled([
    withRetry(loadFiat, sleep),
    withRetry(loadCrypto, sleep),
  ]);
  const fiat = fiatResult.status === 'fulfilled' ? fiatResult.value : [];
  const crypto = cryptoResult.status === 'fulfilled' ? cryptoResult.value : [];
  const pairs = buildPairs(buildUahPrice(fiat, crypto), at);

  if (pairs.length > 0) {
    await upsertMany(pairs);
  }
};
