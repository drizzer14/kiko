import { NOW } from './binance.pay-test-fixtures';
import { type BinanceP2pOrder, P2P_PAGE_ROWS, type TotalPage } from './binance.history-client';

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

/** One P2P page of `rows`, as the total it holds, with no weight reading. */
export const p2pPageOf = (
  rows: BinanceP2pOrder[] = [],
  over: Partial<TotalPage<BinanceP2pOrder>> = {},
): TotalPage<BinanceP2pOrder> => ({
  rows,
  unreadable: [],
  untracked: [],
  gathered: rows.length,
  total: rows.length,
  usedUidWeight1m: undefined,
  usedIpWeight1m: undefined,
  ...over,
});

/**
 * A P2P history as Binance serves it: the orders of the side asked whose `createTime` is in the
 * window, `P2P_PAGE_ROWS` to a page, the total counting them all.
 */
export const p2pServerOf = (orders: BinanceP2pOrder[]) =>
  jest.fn(
    async (
      _apiKey: string,
      _secret: string,
      side: 'BUY' | 'SELL',
      span: { start: number; end: number },
      page: number,
    ): Promise<TotalPage<BinanceP2pOrder>> => {
      const found = orders.filter(
        ({ tradeType, createTime }) =>
          tradeType === side && createTime >= span.start && createTime <= span.end,
      );

      return p2pPageOf(found.slice((page - 1) * P2P_PAGE_ROWS, page * P2P_PAGE_ROWS), {
        total: found.length,
      });
    },
  );
