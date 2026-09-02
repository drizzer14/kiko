/** The single source of truth for the supported currency codes. */
const currencies = ['BTC', 'USD', 'EUR', 'UAH'] as const;

export type Currency = (typeof currencies)[number];

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
  (currencies as readonly string[]).includes(value);
