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

/** The wallet an order names when it names exactly one, else `undefined`. */
const soleWalletOf = (order: BinancePayOrder): number | undefined => {
  const declared = [...new Set(order.walletTypes ?? [])];

  if (declared.length === 0) {
    return order.walletType;
  }

  return declared.length === 1 ? declared[0] : undefined;
};

/**
 * A BTC C2C send from the user to a counterparty, 10 days before `NOW`, from Spot. An
 * order that names one wallet and gives no `fundsDetail` carries the whole amount as the
 * cost of that wallet, as Binance does for a send; pass `fundsDetail` to say otherwise.
 */
export const payOrder = (over: Partial<BinancePayOrder> = {}): BinancePayOrder => {
  const order: BinancePayOrder = {
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
  };
  const wallet = soleWalletOf(order);

  if (over.fundsDetail !== undefined || wallet === undefined) {
    return order;
  }

  const cost = order.amount.replace('-', '');

  return {
    ...order,
    fundsDetail: [
      { currency: 'BTC', amount: cost, walletAssetCost: [{ walletType: wallet, amount: cost }] },
    ],
  };
};
