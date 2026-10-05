import { type Currency, currencyOptions } from '@kiko/currency/currency';

import { rateBetween, type RateEntry } from '../conversion';
import { composeRateTable } from '../monobank-feed-test-helper';
import { canConvert, guardedBreakdown, guardedNetWorth } from '../net-worth-view';

// Every crypto MUST reach every base leg by a live cross-rate, or a holding in it
// silently drops from the net-worth total everywhere except the chart. USDT is
// priced uniformly via CoinGecko (no 1:1 peg).
const CRYPTO: Currency[] = ['BTC', 'ETH', 'USDT'];
const CRYPTO_USD: Record<string, number> = { BTC: 65_000, ETH: 3_200, USDT: 1.0007 };
const NOW = Date.UTC(2026, 0, 1);

const cryptoRates = (): RateEntry[] =>
  CRYPTO.map((base) => ({
    base,
    quote: 'USD' as Currency,
    rate: CRYPTO_USD[base],
    source: 'coingecko' as const,
  }));

const composeTable = () => composeRateTable(async () => cryptoRates());

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
              id: 'h1',
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
              id: 'h1',
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
  // pegged to 1. Only USDT:UAH is stored (`buildUahPrice`/`buildUahRows`,
  // rates/rates-refresh.ts); `rateBetween` resolves USDT:USD at READ TIME by
  // dividing USDT's UAH price by USD's — algebraically this cancels the
  // (index-dependent, test-fixture) UAH/USD leg entirely and must reproduce
  // the raw CoinGecko USD price exactly. If a future change special-cased a
  // stablecoin to a literal 1:1 rate instead of composing it like every
  // other crypto, this is the assertion that would catch it.
  it('prices USDT with its real drift, not a hardcoded 1:1 peg', async () => {
    const table = await composeTable();
    const rate = rateBetween(table, 'USDT', 'USD');

    expect(rate).toBeDefined();
    expect(rate).not.toBe(1);
    expect(rate).toBeCloseTo(CRYPTO_USD.USDT, 10);

    const holding = {
      id: 'h1',
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
