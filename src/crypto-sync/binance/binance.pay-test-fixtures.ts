import { DAY_MS } from '@kiko/dates';

import type { BinancePayOrder } from './binance.history-client';

export const NOW = Date.UTC(2026, 9, 10);

/** The Binance ids the tests give the user and a counterparty. */
export const OWN = '1001';
export const OTHER = '2002';

export const party = (name: string | undefined, binanceId: string | undefined) => ({
  name,
  binanceId,
});

/** A BTC C2C send from the user to a counterparty, 10 days before `NOW`, from Spot. */
export const payOrder = (over: Partial<BinancePayOrder> = {}): BinancePayOrder => ({
  orderType: 'C2C',
  transactionId: 'tx-1',
  transactionTime: NOW - 10 * DAY_MS,
  amount: '-0.001',
  currency: 'BTC',
  walletType: 2,
  walletTypes: undefined,
  fundsDetail: [],
  payerInfo: party('Me', OWN),
  receiverInfo: party('Ann', OTHER),
  ...over,
});
