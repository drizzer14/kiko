import {
  type Currency,
  currencyOptions,
  fiatCurrencyOptions,
  isFiat,
} from '@kiko/currency/currency';

import type { HoldingType } from '../holding-type';

// The holding types a holding may be CREATED in with a fiat currency only.
// Physical cash is never a cryptocurrency; every other type keeps the full
// set (a crypto asset needs crypto). The create form's picker and every create
// path's rejection read this one list, so the two cannot drift.
const fiatOnlyHoldingTypes: readonly HoldingType[] = ['cash'];

const isFiatOnlyHoldingType = (type: HoldingType): boolean => fiatOnlyHoldingTypes.includes(type);

export const holdingCurrencyOptions = (type: HoldingType): readonly Currency[] =>
  isFiatOnlyHoldingType(type) ? fiatCurrencyOptions : currencyOptions;

export const isCurrencyAllowedForHoldingType = (type: HoldingType, currency: Currency): boolean =>
  !isFiatOnlyHoldingType(type) || isFiat(currency);
