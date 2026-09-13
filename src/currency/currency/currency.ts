/**
 * The single source of truth for the supported currency codes, in canonical
 * display order (UAH, USD, EUR, GBP, CHF, BTC — fiat grouped, crypto last).
 * Every currency selector — the base-currency switch in Settings and the
 * account/holding form currency pickers — iterates this one array, so the order
 * is defined here once and stays consistent everywhere.
 */
export const currencyOptions = ['UAH', 'USD', 'EUR', 'GBP', 'CHF', 'BTC'] as const;

export type Currency = (typeof currencyOptions)[number];

export const currencyScale: Record<Currency, number> = {
  UAH: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  CHF: 2,
  BTC: 8,
};

export const currencySymbol: Record<Currency, string> = {
  UAH: '₴',
  USD: '$',
  EUR: '€',
  GBP: '£',
  CHF: '₣',
  BTC: '₿',
};

// The canonical human-readable name per currency, shown alongside the code in
// the searchable CurrencyField and matched against the search query. English is
// the canonical label; the codes themselves are locale-independent and search
// always matches on the code too, so this stays out of i18n (a localized name
// map is a documented follow-up, not a blocker). Exhaustive `Record`, not
// `Partial`: adding a currency with no name is a COMPILE error here.
export const currencyName: Record<Currency, string> = {
  UAH: 'Ukrainian Hryvnia',
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  CHF: 'Swiss Franc',
  BTC: 'Bitcoin',
};

// The crypto codes. Everything else in `currencyOptions` is fiat. `isCrypto`
// (and, through it, `isFiat`/`fiatCurrencyOptions`) reads this ONE set rather
// than re-enumerating which codes are crypto. Not exported: consumers classify
// through the predicates, so exposing the raw Set would be dead surface.
const cryptoCurrencies: ReadonlySet<Currency> = new Set<Currency>(['BTC']);

export const isCrypto = (currency: Currency): boolean => cryptoCurrencies.has(currency);

export const isFiat = (currency: Currency): boolean => !isCrypto(currency);

// The fiat subset of `currencyOptions`, order-preserving. Filtered through the
// `Currency`-typed predicate so it stays `readonly Currency[]`.
export const fiatCurrencyOptions: readonly Currency[] = currencyOptions.filter(isFiat);

export const isCurrency = (value: string): value is Currency =>
  (currencyOptions as readonly string[]).includes(value);

// Places the currency symbol relative to a formatted amount body: the UAH code
// suffixes its symbol (Ukrainian convention, "2,500.00 ₴"), every other currency
// prefixes it ("$1,234.50"). Any sign sits outside the symbol on both paths
// ("-$1,234.50", "-2,500.00 ₴"). Shared by `formatMoney` and `formatCompactMoney`
// so the placement rule lives in exactly one place.
export const applySymbolPlacement = (currency: Currency, sign: string, body: string): string => {
  const symbol = currencySymbol[currency];

  return currency === 'UAH' ? `${sign}${body} ${symbol}` : `${sign}${symbol}${body}`;
};
