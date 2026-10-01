import { validateIsin } from '@kiko/bonds/isin';
import { parseAmount } from '@kiko/currency/parse';
import type { Currency } from '@kiko/currency/currency';
import { unitHoldingCurrency } from '@kiko/prices/share-search';
import type { ShareQuoteSource } from '@kiko/holdings/holding-metadata';
import { compareDecimal, normalizeDecimal } from '@kiko/currency/decimal';

// One type for both functions below, so they can never drift apart on what
// they read. `quoteUnit` is the unit EODHD prices the ticker's listing in,
// once a pick or a lookup at Save has told it.
type ShareValidationParams = {
  isEdit: boolean;
  quoteSource: ShareQuoteSource;
  ticker: string;
  quoteUnit: string | undefined;
  currency: Currency;
  isin: string;
  quantity: string;
  cost: string;
};

// The quantity and total-cost keys are the metal form's own, reused rather
// than minted again for a share.
export type ShareFieldErrors = {
  currencyError: 'forms.holding.shareCurrencyMismatchError' | null;
  tickerError: 'forms.holding.shareTickerError' | null;
  isinError: 'forms.holding.isinFormatError' | 'forms.holding.isinCheckDigitError' | null;
  quantityError: 'forms.holding.quantityError' | null;
  costError: 'forms.lot.totalCostError' | null;
};

export type ShareReasonKey = NonNullable<ShareFieldErrors[keyof ShareFieldErrors]>;

// EODHD prices a symbol only with its exchange suffix (AAPL.US), so a ticker
// without one could never get a price.
const EODHD_SYMBOL_PATTERN = /^[^.\s]+\.[^.\s]+$/;

// The price refresh stores a close only in the currency its unit fits, so a
// share held in any other currency would never be priced.
const currencyFieldReasonKey = (
  quoteUnit: string | undefined,
  currency: Currency,
): ShareFieldErrors['currencyError'] =>
  quoteUnit !== undefined && unitHoldingCurrency(quoteUnit) !== currency
    ? 'forms.holding.shareCurrencyMismatchError'
    : null;

// Only EODHD needs a ticker: it is the symbol the price refresh asks for.
const tickerFieldReasonKey = (
  quoteSource: ShareQuoteSource,
  ticker: string,
): ShareFieldErrors['tickerError'] =>
  quoteSource === 'eodhd' && !EODHD_SYMBOL_PATTERN.test(ticker.trim())
    ? 'forms.holding.shareTickerError'
    : null;

// The ISIN is optional, but a typed one must be valid, so a stored ISIN
// always parses back.
const isinFieldReasonKey = (isin: string): ShareFieldErrors['isinError'] => {
  if (isin.trim() === '') {
    return null;
  }

  const validation = validateIsin(isin);

  if (validation.ok) {
    return null;
  }

  return validation.reason === 'format'
    ? 'forms.holding.isinFormatError'
    : 'forms.holding.isinCheckDigitError';
};

// The first lot is typed only on create; a later buy or sell goes through the
// Lot form.
const quantityFieldReasonKey = (
  isEdit: boolean,
  quantity: string,
): ShareFieldErrors['quantityError'] => {
  if (isEdit) {
    return null;
  }

  const normalizedQuantity = normalizeDecimal(quantity);

  return normalizedQuantity === null || compareDecimal(normalizedQuantity, '0') <= 0
    ? 'forms.holding.quantityError'
    : null;
};

const costFieldReasonKey = (isEdit: boolean, cost: string): ShareFieldErrors['costError'] =>
  isEdit || parseAmount(cost) > 0 ? null : 'forms.lot.totalCostError';

// Each field's reason reads only its own input, so fixing one field never
// changes the error another field shows.
export const shareFieldErrors = (params: ShareValidationParams): ShareFieldErrors => ({
  currencyError: currencyFieldReasonKey(params.quoteUnit, params.currency),
  tickerError: tickerFieldReasonKey(params.quoteSource, params.ticker),
  isinError: isinFieldReasonKey(params.isin),
  quantityError: quantityFieldReasonKey(params.isEdit, params.quantity),
  costError: costFieldReasonKey(params.isEdit, params.cost),
});

// The first reason in the form's top-to-bottom order: the Currency field sits
// above the share section.
export const shareReasonKey = (params: ShareValidationParams): ShareReasonKey | null => {
  const { currencyError, tickerError, isinError, quantityError, costError } =
    shareFieldErrors(params);

  return currencyError ?? tickerError ?? isinError ?? quantityError ?? costError;
};
