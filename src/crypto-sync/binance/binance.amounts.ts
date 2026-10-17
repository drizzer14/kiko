import { Money } from '@kiko/currency/money';

import { BINANCE_ASSET } from './binance.client';

const isDecimalInput = (amount: unknown): amount is string | number =>
  typeof amount === 'number' || (typeof amount === 'string' && amount.trim() !== '');

/**
 * A BTC decimal string (or number) to satoshis, or `null` when it is not a finite
 * number. A blank string is no amount: `Number('')` reads as 0 and would import a
 * zero-satoshi row.
 */
export const btcSatoshis = (amount: unknown): number | null => {
  if (!isDecimalInput(amount)) {
    return null;
  }

  const value = Number(amount);

  return Number.isFinite(value) ? Money.fromMajor(BINANCE_ASSET, value).minorUnits : null;
};
