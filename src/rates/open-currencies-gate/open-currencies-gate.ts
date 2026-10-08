import { settingsRepo } from '@kiko/settings';
import { holdingsRepo } from '@kiko/holdings/repo';
import { isFiat, isCrypto, type Currency, type CryptoCurrency } from '@kiko/currency/currency';

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
   * that only cares about `needsFiat`/`cryptoCurrencies` does not need to
   * supply it too.
   */
  nonBaseCurrencies?: Currency[];
};

/**
 * kiko-architecture: app-open and refresh work is gated on data presence —
 * one `settings` read plus ONE cheap `SELECT DISTINCT currency` over active
 * holdings (`holdingsRepo.openCurrenciesQuery`), never a per-holding loop.
 * Read directly by `refreshRates` (`rates-refresh.ts`); `historyCurrencies`
 * below is the SAME gate pattern, scoped to what `runBackfill` needs instead.
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

/**
 * The history-backfill gate result: exactly the fiat/crypto currencies whose own NBU/CoinGecko
 * range history is worth fetching.
 */
export type HistoryCurrencies = { fiatCurrencies: Currency[]; cryptoCurrencies: CryptoCurrency[] };

/**
 * The history backfill's own data-presence gate (kiko-architecture) — a
 * sibling of `openCurrencies` above, scoped to what NBU history is worth
 * fetching rather than what a live rate refresh needs. Reads EVERY holding,
 * open and closed (`holdingsRepo.historyCurrenciesQuery`), because the
 * net-worth line's past buckets still need a closed holding's own currency
 * converted.
 *
 * `fiatCurrencies` is every held fiat currency plus the base, minus `UAH`
 * (the implicit pivot, never a stored `X:UAH` row's own `base`), whenever any
 * held currency — fiat OR crypto — differs from the base; otherwise there is
 * nothing to convert and it stays empty. `USD` is added afterward,
 * unconditionally, whenever any crypto is held — crypto's own `X:UAH` row
 * composes through a `USD` anchor (kiko-pricing's "History backfill").
 */
export const historyCurrencies = async (): Promise<HistoryCurrencies> => {
  const [settingsRows, currencyRows] = await Promise.all([
    settingsRepo.getQuery(),
    holdingsRepo.historyCurrenciesQuery(),
  ]);
  const base = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  const currencies = currencyRows.map((row) => row.currency);
  const heldFiat = currencies.filter(isFiat);
  const cryptoCurrencies = currencies.filter(isCrypto);
  const needsFiatConversion = currencies.some((currency) => currency !== base);
  const fiatCurrencies = needsFiatConversion
    ? [...new Set([...heldFiat, base])].filter((currency) => currency !== 'UAH')
    : [];

  if (cryptoCurrencies.length > 0 && !fiatCurrencies.includes('USD')) {
    fiatCurrencies.push('USD');
  }

  return { fiatCurrencies, cryptoCurrencies };
};
