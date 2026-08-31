import type { Currency } from '../currency/currency';
import { ratesRepo } from '../repositories/rates.repo';
import { fetchBTCPrice } from './coingecko';
import type { RateEntry } from './conversion';
import { fetchFiatRates } from './monobank-rates';

// Monobank's `/bank/currency` is cached upstream ~5 minutes, so refreshing more
// often than that only re-fetches identical data.
const FIVE_MINUTES_MS = 5 * 60 * 1000;

const allCurrencies: Currency[] = ['BTC', 'USD', 'EUR', 'UAH'];

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
  fetchBTCPrice?: () => Promise<RateEntry[]>;
  upsertMany?: (rates: StoredRate[]) => Promise<void>;
  now?: () => number;
  lastRefreshAt?: number | null;
};

/**
 * Express each currency in UAH. Fiat entries anchor USD/EUR to UAH directly;
 * BTC is anchored through its USD price so BTC pairs stay consistent with fiat.
 */
const buildUahPrice = (fiat: RateEntry[], btc: RateEntry[]): UahPrice => {
  const price: UahPrice = { UAH: 1 };
  for (const entry of fiat) {
    if (entry.quote === 'UAH') {
      price[entry.base] = entry.rate;
    } else if (entry.base === 'UAH') {
      price[entry.quote] = 1 / entry.rate;
    }
  }
  const usdPrice = price.USD;
  for (const entry of btc) {
    if (entry.base === 'BTC' && entry.quote === 'USD' && usdPrice !== undefined) {
      price.BTC = entry.rate * usdPrice;
    }
  }
  return price;
};

const pairSource = (base: Currency, quote: Currency): 'monobank' | 'coingecko' =>
  base === 'BTC' || quote === 'BTC' ? 'coingecko' : 'monobank';

/**
 * Compose every ordered distinct pair from the UAH-anchored prices. A rate is
 * stored as a string, never a float, to match the CurrencyRate column contract.
 */
const buildPairs = (price: UahPrice, fetchedAt: number): StoredRate[] => {
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
  const loadBTC = deps.fetchBTCPrice ?? (() => fetchBTCPrice());
  const upsertMany = deps.upsertMany ?? ratesRepo.upsertMany;

  const [fiat, btc] = await Promise.all([loadFiat(), loadBTC()]);
  const pairs = buildPairs(buildUahPrice(fiat, btc), at);
  if (pairs.length > 0) {
    await upsertMany(pairs);
  }
};
