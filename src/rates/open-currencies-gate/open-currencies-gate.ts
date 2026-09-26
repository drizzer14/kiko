import { holdingsRepo } from '@kiko/holdings/repo';
import { settingsRepo } from '@kiko/settings/settings.repo';

import { isCrypto, type Currency, type CryptoCurrency } from '../../currency/currency';

/** The data-presence gate result a rate/price refresh reads before running. */
export type OpenCurrencies = {
  /** Some ACTIVE holding's currency differs from the base (display) currency. */
  needsFiat: boolean;
  /** The distinct crypto currencies (BTC/ETH/USDT) an ACTIVE holding holds. */
  cryptoCurrencies: CryptoCurrency[];
  /**
   * Every distinct ACTIVE-holding currency (fiat or crypto) that differs from
   * the base — the raw set `needsFiat` is derived from
   * (`needsFiat === nonBaseCurrencies.length > 0`). `refreshRates` reads this
   * directly to check whether a currently-held currency still has no
   * `currency_rates` row at all, a case its own throttle must never suppress.
   * Optional (defaulting to `[]` at the one real call site) so a test double
   * that only cares about `needsFiat`/`cryptoCurrencies` — `runBackfill`'s own
   * gate use, which never reads this field — does not need to supply it too.
   */
  nonBaseCurrencies?: Currency[];
};

/**
 * kiko-architecture: app-open and refresh work is gated on data presence —
 * one `settings` read plus ONE cheap `SELECT DISTINCT currency` over active
 * holdings (`holdingsRepo.openCurrenciesQuery`), never a per-holding loop.
 * Shared by `refreshRates` (`rates-refresh.ts`) and `runBackfill`
 * (`history-backfill.ts`) — the SAME gate pattern for every refresh.
 *
 * `needsFiat` covers BOTH a fiat holding in a different currency from the
 * base AND a held crypto currency (BTC/ETH/USDT is, in practice, never the
 * base currency), which is exactly the fiat leg's own USD:UAH anchor a
 * crypto leg's composed pairs depend on (`buildUahPrice`/`uahPriceAt`) — so
 * a crypto-only holder still gets the fiat leg it needs, without either
 * gate hardcoding a dependency on the other.
 */
export const openCurrencies = async (): Promise<OpenCurrencies> => {
  const [settingsRows, currencyRows] = await Promise.all([
    settingsRepo.getQuery(),
    holdingsRepo.openCurrenciesQuery(),
  ]);
  const base = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  const currencies = currencyRows.map((row) => row.currency);
  const nonBaseCurrencies = currencies.filter((currency) => currency !== base);

  return {
    needsFiat: nonBaseCurrencies.length > 0,
    cryptoCurrencies: currencies.filter(isCrypto),
    nonBaseCurrencies,
  };
};
