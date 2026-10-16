import { type Currency, isCrypto, isFiat } from '@kiko/currency/currency';

import type { HoldingType } from '../holding-type';

// Whether a write rejects a cryptocurrency for this type. Physical cash is never a
// cryptocurrency; every other type is tolerated in any currency (a legacy loan can
// be in a coin). Only the write paths read this: the create form's picker lists
// what `isCurrencyExpectedForHoldingType` expects, which is narrower.
const isFiatOnlyHoldingType = (type: HoldingType): boolean => type === 'cash';

export const isCurrencyAllowedForHoldingType = (type: HoldingType, currency: Currency): boolean =>
  !isFiatOnlyHoldingType(type) || isFiat(currency);

// Whether a holding of this type is created in a cryptocurrency, although a
// write also accepts a fiat one. The currency picker leads with the coins for it.
export const isCryptoHoldingType = (type: HoldingType): boolean => type === 'crypto_asset';

// The currency a holding of this type is created in, as opposed to what a write
// tolerates: a crypto asset in a cryptocurrency, every other type in a fiat one.
// The currency picker's first group and the "create payment holding" type filter
// both read this, so they cannot drift.
export const isCurrencyExpectedForHoldingType = (type: HoldingType, currency: Currency): boolean =>
  isCryptoHoldingType(type) ? isCrypto(currency) : isFiat(currency);
