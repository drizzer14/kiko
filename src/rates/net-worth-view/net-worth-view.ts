import type { Money } from '../../currency/money';
import { sumByCurrency } from '../currency-totals';
import type { Currency } from '../../currency/currency';
import { FIAT_RATE_SEED_TABLE } from '../fiat-rate-seed';
import type { CurrencyRateRow, HoldingRow } from '../../db/schema';
import { EMPTY_PRICE_BOOK, type PriceBook } from '../../prices/price-book';
import { netWorth, type RateTable, rateTableFromRows } from '../conversion';

type ConvertibleHolding = Pick<HoldingRow, 'currency' | 'balanceMinorUnits' | 'type' | 'metadata'>;

/**
 * The `rate` column is stored as a string; parse it into the numeric
 * RateTable. The bundled `FIAT_RATE_SEED_TABLE` is a FALLBACK LAYER
 * underneath the live DB rows — spread first, then overwritten per pair by
 * whatever `rows` actually has, so a live rate always wins and the seed only
 * fills a gap. This is what makes a non-UAH fiat holding value correctly
 * right after creation, even fully offline, on a fresh install whose
 * `currency_rates` table is still empty (`refreshRates` writes nothing until
 * a live Monobank fetch succeeds — see `rates-refresh.ts`). Crypto has no
 * seed entry, so an unrated crypto holding is still excluded exactly as
 * before (Part C: this is the one remaining silent-drop case, and it's
 * intentional — crypto pricing stays a separate, live-only path).
 */
export const buildRateTable = (
  rows: Pick<CurrencyRateRow, 'base' | 'quote' | 'rate'>[],
): RateTable => ({
  ...FIAT_RATE_SEED_TABLE,
  ...rateTableFromRows(rows),
});

/**
 * `convert`/`netWorth` throw on a missing rate pair (RULING R2). A holding is
 * convertible only when it is already in the base currency or a POSITIVE,
 * finite base rate exists — otherwise it is excluded from any sum so a
 * first-run (no rates yet) render never crashes. A rate of 0 (a bad provider
 * tick) must be treated the same as a missing rate: `0 !== undefined` would
 * otherwise let `guardedNetWorth` convert the holding to 0 while
 * `guardedBreakdown` kept showing it at full own-currency value.
 *
 * Part C: since `buildRateTable`'s fiat seed fallback (above) now covers
 * every supported FIAT currency, this silent exclusion in practice fires
 * only for a currency with neither a live rate NOR a seed entry — today that
 * is exactly the crypto set (BTC/ETH/USDT), which has no seed by design and
 * is excluded here until a live CoinGecko price lands, exactly as before
 * this fix. This is the one remaining, intentional silent-drop case.
 */
export const canConvert = (currency: Currency, base: Currency, rates: RateTable): boolean => {
  if (currency === base) {
    return true;
  }
  const rate = rates[`${currency}:${base}`];

  return rate !== undefined && Number.isFinite(rate) && rate > 0;
};

/** Sum the given holdings in the base currency, excluding any that cannot convert. */
export const guardedNetWorth = (
  holdings: ConvertibleHolding[],
  base: Currency,
  rates: RateTable,
  now: number,
  book: PriceBook = EMPTY_PRICE_BOOK,
): Money => {
  const convertible = holdings.filter((holding) => canConvert(holding.currency, base, rates));
  return netWorth(convertible, base, rates, now, book);
};

/**
 * The per-currency breakdown restricted to exactly the holdings
 * `guardedNetWorth` could convert, so the rows ALWAYS sum to the headline
 * total.
 *
 * `sumByCurrency` alone keeps every currency, including one with no cached
 * rate — which `guardedNetWorth` had already dropped from the total. With a
 * BTC holding and no BTC:UAH rate yet (a first run, or a CoinGecko outage),
 * the Home card's headline excluded BTC while the breakdown beneath it still
 * listed BTC, so the rows visibly did not add up. This guard lives here,
 * shared with `guardedNetWorth`, rather than duplicated inline in
 * `home.screen.tsx` (its one current caller), so a future second consumer
 * of the headline total gets the identical divergence fix for free.
 */
export const guardedBreakdown = (
  holdings: ConvertibleHolding[],
  base: Currency,
  rates: RateTable,
  now: number,
  book: PriceBook = EMPTY_PRICE_BOOK,
): Money[] =>
  sumByCurrency(
    holdings.filter((holding) => canConvert(holding.currency, base, rates)),
    now,
    book,
  );
