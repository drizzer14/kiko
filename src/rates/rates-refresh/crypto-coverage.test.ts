import { codeFromCurrency } from '../../monobank/currency-code';
import { fetchFiatRates } from '../monobank-rates';
import { type RefreshDeps, refreshRates } from '../rates-refresh';
import type { RateEntry } from '../conversion';
import { buildRateTable, canConvert, guardedNetWorth } from '../net-worth-view';
import { type Currency, currencyOptions, isCurrency, isFiat } from '../../currency/currency';

// Every crypto MUST reach every base leg by a live cross-rate, or a holding in it
// silently drops from the net-worth total everywhere except the chart — the
// build-6 regression class. USDT is priced uniformly via CoinGecko (no 1:1 peg).
const CRYPTO: Currency[] = ['BTC', 'ETH', 'USDT'];
const CRYPTO_USD: Record<string, number> = { BTC: 65_000, ETH: 3_200, USDT: 1.0007 };
const NOW = Date.UTC(2026, 0, 1);

type MonoRate = {
  currencyCodeA: number;
  currencyCodeB: number;
  date: number;
  rateBuy?: number;
  rateSell?: number;
};

// A distinct UAH price per fiat so no cross-rate collapses to 1 (which would
// hide a broken pivot). currencyCodeA is the foreign leg, currencyCodeB is UAH
// (980) — the exact shape Monobank's real feed uses — so `buildUahPrice` anchors
// each fiat and `buildPairs` composes every cross pair from it.
const buildMonobankFeed = (): MonoRate[] => {
  const feed: MonoRate[] = [];
  let index = 1;
  for (const currency of currencyOptions) {
    if (!isFiat(currency) || currency === 'UAH') {
      continue;
    }
    const code = codeFromCurrency(currency);
    if (code === undefined) {
      throw new Error(`fiat ${currency} has no ISO numeric code`);
    }
    const price = 1 + index * 0.5;
    feed.push({
      currencyCodeA: code,
      currencyCodeB: 980,
      date: 1,
      rateBuy: price,
      rateSell: price + 0.1,
    });
    index += 1;
  }
  return feed;
};

const makeFetch = (body: unknown): typeof fetch =>
  (async () => ({ ok: true, json: async () => body, status: 200 })) as unknown as typeof fetch;

const cryptoRates = (): RateEntry[] =>
  CRYPTO.map((base) => ({
    base,
    quote: 'USD' as Currency,
    rate: CRYPTO_USD[base],
    source: 'coingecko' as const,
  }));

const composeTable = async () => {
  const feed = buildMonobankFeed();
  const captured: { base: string; quote: string; rate: string }[][] = [];
  const deps: RefreshDeps = {
    fetchFiatRates: () => fetchFiatRates(makeFetch(feed)),
    fetchCryptoPrices: async () => cryptoRates(),
    upsertMany: async (rates) => {
      captured.push(rates);
    },
    now: () => 1000,
  };

  await refreshRates(deps);
  expect(captured).toHaveLength(1);

  return buildRateTable(
    captured[0].map((row) => {
      if (!isCurrency(row.base) || !isCurrency(row.quote)) {
        throw new Error(`unexpected pair ${row.base}:${row.quote}`);
      }
      return { base: row.base, quote: row.quote, rate: row.rate };
    }),
  );
};

describe('Crypto coverage — every added crypto reaches every base (no silent net-worth drop)', () => {
  it('composes a convertible path from every crypto to every base currency', async () => {
    const table = await composeTable();
    for (const crypto of CRYPTO) {
      for (const base of currencyOptions) {
        if (base === crypto) {
          continue;
        }
        expect(canConvert(crypto, base, table)).toBe(true);
      }
    }
  });

  it('includes a holding of every crypto in the net-worth total for every base leg', async () => {
    const table = await composeTable();
    for (const crypto of CRYPTO) {
      for (const base of ['UAH', 'USD', 'EUR'] as Currency[]) {
        const total = guardedNetWorth(
          [
            {
              currency: crypto,
              balanceMinorUnits: 100_000_000,
              type: 'crypto_asset',
              metadata: null,
            },
          ],
          base,
          table,
          NOW,
        );
        expect(total.currency).toBe(base);
        expect(total.minorUnits).toBeGreaterThan(0);
      }
    }
  });
});
