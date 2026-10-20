import type { HoldingRow } from '@kiko/db';
import type { Currency } from '@kiko/currency/currency';

/**
 * The currency a pre-existing account gets once, from its OPEN holdings: the one they all share,
 * or the base currency for several or none. Migration 0062 states the same rule in SQL
 * (`drizzle/migrations/0062_add_account_currency.sql`), and a restore of an older file, with the
 * demo builder, runs this function, so the closed-holding clause lives in this one line per path.
 * A holding with no `closedAt` counts as open.
 */
export const accountCurrencyOf = (
  holdings: readonly Pick<HoldingRow, 'currency' | 'closedAt'>[],
  baseCurrency: Currency,
): Currency => {
  const openCurrencies = new Set(
    holdings.filter((holding) => holding.closedAt == null).map((holding) => holding.currency),
  );
  const [onlyCurrency] = openCurrencies;

  return openCurrencies.size === 1 && onlyCurrency !== undefined ? onlyCurrency : baseCurrency;
};
