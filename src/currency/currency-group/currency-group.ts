import type { Currency } from '../currency';

export type CurrencyGroup = {
  kind: 'target' | 'held' | 'fiat' | 'crypto';
  currencies: readonly Currency[];
};

export type CurrencyOrdering = {
  held: readonly Currency[];
  nameOf: (code: Currency) => string;
  language: string;
};

// Kiko's users are Ukrainian, so these three lead the currencies the user has not yet used.
const PINNED_CURRENCIES: readonly Currency[] = ['UAH', 'USD', 'EUR'];

// The ONE picker order: the user's own currencies, then UAH, USD, EUR, then the rest, each part
// by localized name (case- and accent-insensitive, so it reads alphabetical in any language).
// A code appears once, and only a code in `codes` comes out.
export const orderCurrencies = (
  codes: readonly Currency[],
  { held, nameOf, language }: CurrencyOrdering,
): Currency[] => {
  const compare = (left: Currency, right: Currency): number =>
    nameOf(left).localeCompare(nameOf(right), language, { sensitivity: 'base' });

  const unique = [...new Set(codes)];
  const heldCodes = unique.filter((code) => held.includes(code)).sort(compare);
  const unheld = unique.filter((code) => !held.includes(code));
  const pinned = PINNED_CURRENCIES.filter((code) => unheld.includes(code));
  const rest = unheld.filter((code) => !pinned.includes(code)).sort(compare);

  return [...heldCodes, ...pinned, ...rest];
};
