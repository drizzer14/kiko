import type { RateEntry } from '../conversion';
import { fetchFiatRates } from '../monobank-rates';
import { codeFromCurrency } from '../../monobank/currency-code';
import { type RefreshDeps, refreshRates } from '../rates-refresh';
import { type Currency, currencyOptions, isCurrency, isFiat } from '../../currency/currency';
import { buildRateTable, canConvert, guardedBreakdown, guardedNetWorth } from '../net-worth-view';

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

  // Home (src/screens/home/home.screen.tsx) renders its per-currency breakdown
  // row via `guardedBreakdown`, a DIFFERENT function from `guardedNetWorth` —
  // it filters by the same `canConvert` gate but never converts the amount, it
  // sums each holding in its OWN currency (rates/net-worth-view.ts). A crypto
  // proven convertible above could still be silently dropped from this second,
  // separate call site if that call site filtered differently.
  it('includes every crypto in the per-currency breakdown Home renders (guardedBreakdown)', async () => {
    const table = await composeTable();
    for (const crypto of CRYPTO) {
      for (const base of ['UAH', 'USD', 'EUR'] as Currency[]) {
        const breakdown = guardedBreakdown(
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
        expect(breakdown).toHaveLength(1);
        expect(breakdown[0].currency).toBe(crypto);
        expect(breakdown[0].minorUnits).toBeGreaterThan(0);
      }
    }
  });

  // USDT is priced via CoinGecko at its real market rate (~1.0007), not hard-
  // pegged to 1. `buildUahPrice`/`buildPairs` (rates/rates-refresh.ts) compose
  // USDT:USD by dividing USDT's UAH-anchored price by USD's — algebraically
  // this cancels the (index-dependent, test-fixture) UAH/USD leg entirely and
  // must reproduce the raw CoinGecko USD price exactly. If a future change
  // special-cased a stablecoin to a literal 1:1 rate instead of composing it
  // like every other crypto, this is the assertion that would catch it.
  it('prices USDT with its real drift, not a hardcoded 1:1 peg', async () => {
    const table = await composeTable();
    const rate = table['USDT:USD'];

    expect(rate).toBeDefined();
    expect(rate).not.toBe(1);
    expect(rate).toBeCloseTo(CRYPTO_USD.USDT, 10);

    const holding = {
      currency: 'USDT' as Currency,
      balanceMinorUnits: 100_000_00, // 100,000.00 USDT
      type: 'crypto_asset' as const,
      metadata: null,
    };
    const pegged = guardedNetWorth([holding], 'USDT', table, NOW);
    const converted = guardedNetWorth([holding], 'USD', table, NOW);

    // A true 1:1 peg would leave the minor-unit amount unchanged across the
    // currency swap; the real ~1.0007 drift must not.
    expect(converted.minorUnits).not.toBe(pegged.minorUnits);
    expect(converted.minorUnits).toBe(Math.round(pegged.minorUnits * CRYPTO_USD.USDT));
  });
});
