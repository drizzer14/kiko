export type Currency = 'BTC' | 'USD' | 'EUR' | 'UAH';

export const currencyScale: Record<Currency, number> = {
  BTC: 8,
  USD: 2,
  EUR: 2,
  UAH: 2,
};

const currencies = new Set<string>(['BTC', 'USD', 'EUR', 'UAH']);

export const isCurrency = (value: string): value is Currency => currencies.has(value);
