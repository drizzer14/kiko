import { NOW } from './binance.pay-test-fixtures';
import type { BinanceP2pOrder } from './binance.history-client';

/** When the fixture order was made: ten minutes before `NOW`. */
export const P2P_CREATED_AT = NOW - 600_000;

export const P2P_ORDER_NUMBER = '22225541213133';

/**
 * A completed taker buy of 100 USDT for 4150 UAH, 0.1 USDT of it the taker commission; a test
 * overrides what it varies, and passes `undefined` for a field Binance leaves out.
 */
export const p2pOrderOf = (over: Partial<BinanceP2pOrder> = {}): BinanceP2pOrder => ({
  orderNumber: P2P_ORDER_NUMBER,
  createTime: P2P_CREATED_AT,
  orderStatus: 'COMPLETED',
  tradeType: 'BUY',
  advertisementRole: 'TAKER',
  asset: 'USDT',
  fiat: 'UAH',
  amount: '100',
  totalPrice: '4150',
  takerCommission: '0.1',
  takerAmount: '99.9',
  ...over,
});
