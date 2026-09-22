import type { Currency } from '../../currency/currency';
import type { Money } from '../../currency/money';
import type { CurrencyRateRow, HoldingRow } from '../../db/schema';
import { netWorth, type RateTable } from '../conversion';
import { sumByCurrency } from '../currency-totals';

type ConvertibleHolding = Pick<HoldingRow, 'currency' | 'balanceMinorUnits' | 'type' | 'metadata'>;

/** The `rate` column is stored as a string; parse it into the numeric RateTable. */
export const buildRateTable = (
  rows: Pick<CurrencyRateRow, 'base' | 'quote' | 'rate'>[],
): RateTable => {
  const table: RateTable = {};

  for (const row of rows) {
    const rate = Number(row.rate);
    if (Number.isFinite(rate) && rate > 0) {
      table[`${row.base}:${row.quote}`] = rate;
    }
  }
  return table;
};

/**
 * `convert`/`netWorth` throw on a missing rate pair (RULING R2). A holding is
 * convertible only when it is already in the base currency or a POSITIVE,
 * finite base rate exists — otherwise it is excluded from any sum so a
 * first-run (no rates yet) render never crashes. A rate of 0 (a bad provider
 * tick) must be treated the same as a missing rate: `0 !== undefined` would
 * otherwise let `guardedNetWorth` convert the holding to 0 while
 * `guardedBreakdown` kept showing it at full own-currency value.
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
): Money => {
  const convertible = holdings.filter((holding) => canConvert(holding.currency, base, rates));
  return netWorth(convertible, base, rates, now);
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
 * listed BTC, so the rows visibly did not add up. The widget's snapshot had
 * the identical divergence, which is why this lives here rather than in either
 * caller.
 */
export const guardedBreakdown = (
  holdings: ConvertibleHolding[],
  base: Currency,
  rates: RateTable,
  now: number,
): Money[] =>
  sumByCurrency(
    holdings.filter((holding) => canConvert(holding.currency, base, rates)),
    now,
  );
