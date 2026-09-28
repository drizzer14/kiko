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

/** The history-backfill gate result: exactly the fiat/crypto currencies whose own NBU/CoinGecko range history is worth fetching. */
export type HistoryCurrencies = { fiatCurrencies: Currency[]; cryptoCurrencies: CryptoCurrency[] };

/**
 * The history backfill's own data-presence gate (kiko-architecture) — a
 * sibling of `openCurrencies` above, scoped to what NBU history is worth
 * fetching rather than what a live rate refresh needs. Reads EVERY holding,
 * open and closed (`holdingsRepo.historyCurrenciesQuery`), because the
 * net-worth line's past buckets still need a closed holding's own currency
 * converted.
 *
 * `fiatCurrencies` is the union of every held fiat currency and the base
 * currency, minus `UAH` (the implicit pivot, never a stored `X:UAH` row's own
 * `base`) — the base's own history is needed to convert ANY foreign holding
 * into it — but ONLY when some held fiat currency genuinely differs from the
 * base; when every held fiat currency already equals the base (or none is
 * held at all), there is nothing to convert, so the set collapses to empty
 * even though the union would otherwise include the base. `USD` is added
 * afterward, unconditionally, whenever any crypto is held — crypto's own
 * `X:UAH` row composes through a `USD` anchor (kiko-pricing's "History
 * backfill"), regardless of whether any fiat conversion is otherwise needed.
 * A fiat currency that is the base but not itself the anchor for a live
 * holding still falls back to the bundled seed's flat rate rather than a
 * live fetch — an accepted flat-history trade-off for that case.
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
  const needsFiatConversion = heldFiat.some((currency) => currency !== base);
  const fiatCurrencies = needsFiatConversion
    ? [...new Set([...heldFiat, base])].filter((currency) => currency !== 'UAH')
    : [];

  if (cryptoCurrencies.length > 0 && !fiatCurrencies.includes('USD')) {
    fiatCurrencies.push('USD');
  }

  return { fiatCurrencies, cryptoCurrencies };
};
