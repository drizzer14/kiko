import type { Currency } from '../currency';

// The SF Symbol currency-sign glyph shown for each currency, keyed by its code.
// Mirrors src/holdings/entity-symbols.ts (the account Kind / holding Type
// symbol maps): a fixed UI glyph the currency ChipRow selects render before
// each option's label via ChipRow's `icons` prop. Distinct from currency.ts's
// `currencySymbol`, which is the plain Unicode sign (₴, $, €, ₿) used in
// formatted money text — this map is the SF Symbol *name* (hryvniasign,
// dollarsign, …) the native icon component renders.
//
// An exhaustive `Record`, not `Partial`: every `Currency` must supply a real
// SF Symbol currency-sign glyph, so adding a currency with no matching sign
// symbol is a COMPILE error at this map, not a silent `undefined` that only
// surfaces at render time as a missing icon.
export const currencySignSymbol: Record<Currency, string> = {
  UAH: 'hryvniasign',
  USD: 'dollarsign',
  EUR: 'eurosign',
  BTC: 'bitcoinsign',
};
