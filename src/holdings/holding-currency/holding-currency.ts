import {
  type Currency,
  currencyOptions,
  fiatCurrencyOptions,
  isCrypto,
  isFiat,
} from '@kiko/currency/currency';

import type { HoldingType } from '../holding-type';

// Whether a holding of this type may be CREATED in a fiat currency only.
// Physical cash is never a cryptocurrency; every other type keeps the full
// set (a crypto asset needs crypto). The create form's picker and every create
// path's rejection read this one predicate, so the two cannot drift.
const isFiatOnlyHoldingType = (type: HoldingType): boolean => type === 'cash';

export const holdingCurrencyOptions = (type: HoldingType): readonly Currency[] =>
  isFiatOnlyHoldingType(type) ? fiatCurrencyOptions : currencyOptions;

export const isCurrencyAllowedForHoldingType = (type: HoldingType, currency: Currency): boolean =>
  !isFiatOnlyHoldingType(type) || isFiat(currency);

// The currency a holding of this type is created in, as opposed to what a write
// tolerates: a crypto asset is created in a cryptocurrency (the form lists
// those first) although a write also accepts a fiat one. A picker that needs a
// holding in a given currency uses this to decide whether creating a holding of
// the type can end up offering it.
export const isCurrencyExpectedForHoldingType = (type: HoldingType, currency: Currency): boolean =>
  isCurrencyAllowedForHoldingType(type, currency) &&
  (type !== 'crypto_asset' || isCrypto(currency));
