import type {
  BinanceFiatOrder,
  BinanceFiatPayment,
  FiatTransactionType,
  TotalPage,
} from './binance.history-client';
import { NOW } from './binance.pay-test-fixtures';

/** When the fixture record was made: ten minutes before `NOW`. */
export const FIAT_CREATED_AT = NOW - 600_000;

export const FIAT_ORDER_NO = 'order-1';

export const FIAT_PAYMENT_NO = 'payment-1';

/**
 * A successful deposit of 100.00 EUR with no fee; a test overrides what it varies, and passes
 * `undefined` for a field Binance leaves out.
 */
export const fiatOrderOf = (over: Partial<BinanceFiatOrder> = {}): BinanceFiatOrder => ({
  orderNo: FIAT_ORDER_NO,
  createTime: FIAT_CREATED_AT,
  status: 'Successful',
  fiatCurrency: 'EUR',
  indicatedAmount: '100.00',
  amount: '100.00',
  totalFee: '0.00',
  ...over,
});

/** A completed card buy of 0.001 BTC for 2600 UAH, with the same rules as `fiatOrderOf`. */
export const fiatPaymentOf = (over: Partial<BinanceFiatPayment> = {}): BinanceFiatPayment => ({
  orderNo: FIAT_PAYMENT_NO,
  createTime: FIAT_CREATED_AT,
  status: 'Completed',
  fiatCurrency: 'UAH',
  sourceAmount: '2600',
  obtainAmount: '0.001',
  cryptoCurrency: 'BTC',
  ...over,
});

/** One fiat page of `rows`, as the total it holds, with no weight reading. */
export const fiatPageOf = <Item>(
  rows: Item[] = [],
  over: Partial<TotalPage<Item>> = {},
): TotalPage<Item> => ({
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
 * A fiat history as Binance serves it: the records of the type asked whose `createTime` is in the
 * window, `pageRows` to a page, the total counting them all.
 */
export const fiatServerOf = <Item extends { createTime: number }>(
  byType: Partial<Record<FiatTransactionType, Item[]>>,
  pageRows: number,
) =>
  jest.fn(
    async (
      _apiKey: string,
      _secret: string,
      type: FiatTransactionType,
      span: { start: number; end: number },
      page: number,
    ): Promise<TotalPage<Item>> => {
      const found = (byType[type] ?? []).filter(
        ({ createTime }) => createTime >= span.start && createTime <= span.end,
      );

      return fiatPageOf(found.slice((page - 1) * pageRows, page * pageRows), {
        total: found.length,
      });
    },
  );
