import { type Currency, currencyOptions, isCurrency, isFiat } from '../../currency/currency';
import { codeFromCurrency } from '../../monobank/currency-code';
import { buildRateTable, canConvert, guardedNetWorth } from '../net-worth-view';
import { type RefreshDeps, refreshRates } from '../rates-refresh';

import { fetchFiatRates } from './monobank-rates';

// The base legs the app converts through. Every added fiat must reach EVERY one
// of these by a live cross-rate, or a holding in it silently drops from the
// net-worth total everywhere except the chart — the build-6 regression class.
const BASE_LEGS: Currency[] = ['UAH', 'USD', 'EUR'];

type MonoRate = {
  currencyCodeA: number;
  currencyCodeB: number;
  date: number;
  rateBuy?: number;
  rateSell?: number;
  rateCross?: number;
};

// A deterministic, distinct UAH price per fiat so no cross-rate collapses to 1
// (which would hide a broken pivot). Every fiat is quoted against UAH (980) the
// same way Monobank's real feed shapes it — currencyCodeA is the foreign leg,
// currencyCodeB is UAH — so `buildUahPrice` can anchor it and `buildPairs` can
// compose every cross pair from it.
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

    const price = 1 + index * 0.5; // 1.5, 2.0, 2.5, … — all distinct, none 1

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

const composeTable = async () => {
  const feed = buildMonobankFeed();
  const captured: { base: string; quote: string; rate: string }[][] = [];
  const deps: RefreshDeps = {
    fetchFiatRates: () => fetchFiatRates(makeFetch(feed)),
    fetchBTCPrice: async () => [],
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

const NOW = Date.UTC(2026, 0, 1);

describe('Monobank fiat coverage — every added fiat reaches every base leg', () => {
  it('composes a convertible path from every fiat to every base leg (no silent drop)', async () => {
    const table = await composeTable();

    for (const currency of currencyOptions) {
      if (!isFiat(currency)) {
        continue;
      }

      for (const base of BASE_LEGS) {
        expect(canConvert(currency, base, table)).toBe(true);
      }
    }
  });

  it('includes a holding of every fiat in the net-worth total for every base leg', async () => {
    const table = await composeTable();

    for (const currency of currencyOptions) {
      if (!isFiat(currency)) {
        continue;
      }

      for (const base of BASE_LEGS) {
        const total = guardedNetWorth(
          [{ currency, balanceMinorUnits: 100_000, type: 'cash', metadata: null }],
          base,
          table,
          NOW,
        );

        // A dropped holding would leave the base-currency total at exactly zero.
        expect(total.currency).toBe(base);
        expect(total.minorUnits).toBeGreaterThan(0);
      }
    }
  });
});
