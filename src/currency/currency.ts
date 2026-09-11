/**
 * The single source of truth for the supported currency codes, in canonical
 * display order (UAH, USD, EUR, BTC). Every currency selector — the base-currency
 * switch in Settings and the account/holding form currency pickers — iterates
 * this one array, so the order is defined here once and stays consistent
 * everywhere.
 */
export const currencyOptions = ['UAH', 'USD', 'EUR', 'BTC'] as const;

export type Currency = (typeof currencyOptions)[number];

export const currencyScale: Record<Currency, number> = {
  BTC: 8,
  USD: 2,
  EUR: 2,
  UAH: 2,
};

export const currencySymbol: Record<Currency, string> = {
  UAH: '₴',
  USD: '$',
  EUR: '€',
  BTC: '₿',
};

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
