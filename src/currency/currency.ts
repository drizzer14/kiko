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
