import { type Currency, currencyOptions, isCurrency, isFiat } from '@kiko/currency/currency';

import { codeFromCurrency } from '../monobank/currency-code';

import type { RateTable } from './conversion';
import { fetchFiatRates } from './monobank-rates';
import { buildRateTable } from './net-worth-view';
import { type RefreshDeps, refreshRates } from './rates-refresh';

/**
 * Test helper: a synthetic Monobank fiat feed row, shaped exactly like the
 * real API's `currencyCodeA`/`currencyCodeB`/`rateBuy`/`rateSell` fields.
 * Shared by the fiat-coverage and crypto-coverage suites, whose setup is
 * otherwise identical (see `buildMonobankFeed`/`composeRateTable` below).
 */
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
// currencyCodeB is UAH — so `buildUahPrice` can anchor it and `buildUahRows` can
// compose each currency's own `X:UAH` row from it.
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

/**
 * Runs `refreshRates` against the deterministic synthetic fiat feed above
 * (plus whatever `fetchCryptoPrices` supplies) and composes the one captured
 * `upsertMany` call into a `RateTable` — the shared setup both the
 * fiat-coverage and crypto-coverage suites need before asserting on
 * `canConvert`/`guardedNetWorth`/`guardedBreakdown`.
 */
export const composeRateTable = async (
  fetchCryptoPrices: RefreshDeps['fetchCryptoPrices'],
): Promise<RateTable> => {
  const feed = buildMonobankFeed();
  const captured: { base: string; quote: string; rate: string }[][] = [];
  const deps: RefreshDeps = {
    fetchFiatRates: () => fetchFiatRates(makeFetch(feed)),
    fetchCryptoPrices,
    upsertMany: async (rates) => {
      captured.push(rates);
    },
    now: () => 1000,
    // Both suites assert on FULL coverage across every fiat/crypto pair, so
    // the data-presence gate (kiko-architecture) must never skip a leg here —
    // this is not a real held-holding set, just a fixture forcing both legs
    // to run regardless of the gate.
    openCurrencies: async () => ({ needsFiat: true, cryptoCurrencies: ['BTC', 'ETH', 'USDT'] }),
  };

  await refreshRates(deps);

  if (captured.length !== 1) {
    throw new Error(`expected exactly one upsertMany call, got ${captured.length}`);
  }

  return buildRateTable(
    captured[0].map((row) => {
      if (!isCurrency(row.base) || !isCurrency(row.quote)) {
        throw new Error(`unexpected pair ${row.base}:${row.quote}`);
      }

      return { base: row.base, quote: row.quote, rate: row.rate };
    }),
  );
};

/** Every added fiat/crypto reaches every one of these by a live cross-rate. */
export const BASE_LEGS: Currency[] = ['UAH', 'USD', 'EUR'];
