import type { Currency } from '../currency/currency';
import { Money } from '../currency/money';
import type { CurrencyRateRow, HoldingRow } from '../db/schema';
import { netWorth, type RateTable } from './conversion';

type ConvertibleHolding = Pick<HoldingRow, 'accountId' | 'currency' | 'balanceMinorUnits'>;

/** The `rate` column is stored as a string; parse it into the numeric RateTable. */
export const buildRateTable = (
  rows: Pick<CurrencyRateRow, 'base' | 'quote' | 'rate'>[],
): RateTable => {
  const table: RateTable = {};
  for (const row of rows) {
    const rate = Number(row.rate);
    if (Number.isFinite(rate)) {
      table[`${row.base}:${row.quote}`] = rate;
    }
  }
  return table;
};

/**
 * `convert`/`netWorth` throw on a missing rate pair (RULING R2). A holding is
 * convertible only when it is already in the base currency or a base rate
 * exists — otherwise it is excluded from any sum so a first-run (no rates yet)
 * render never crashes.
 */
export const canConvert = (currency: Currency, base: Currency, rates: RateTable): boolean =>
  currency === base || rates[`${currency}:${base}`] !== undefined;

/** Sum the given holdings in the base currency, excluding any that cannot convert. */
export const guardedNetWorth = (
  holdings: ConvertibleHolding[],
  base: Currency,
  rates: RateTable,
): Money => {
  const convertible = holdings.filter(holding => canConvert(holding.currency, base, rates));
  return netWorth(convertible, base, rates);
};
