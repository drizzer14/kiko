import { DAY_MS } from '@kiko/dates';

import type {
  BinanceFiatOrder,
  BinanceFiatPayment,
  FiatTransactionType,
  TotalPage,
} from './binance.history-client';
import { NOW } from './binance.pay-test-fixtures';
import { FIAT_WINDOW_MS } from './binance.fiat-history';

/** The halvings from a window of `FIAT_WINDOW_MS` down to the day a failed span halves to. */
export const HALVINGS_OVER_A_WINDOW = Math.ceil(Math.log2(FIAT_WINDOW_MS / DAY_MS));

/**
 * The reads of an owed pass over one window with one failing day, when no halving is kept between
 * a read that commits and the next one (a run of the orders lane ends after its one read, and the
 * window then starts again from the whole rest of it). Restart `k` halves `j(k)` times until its
 * first half lies before the day, and one read commits that half. The day is `d(k)` from the
 * window start and `j(k) <= log2(w(k) / d(k)) + 1`, `w(k)` being the width left. The half that
 * commits is `x` wide with `x < d <= 2x`, so `d(k + 1) <= d(k) / 2`: the restarts still to come
 * after restart `k` are at most `log2(d(k) / day)`, and with the halvings they add to at most
 * `H + 1`, `H` being `HALVINGS_OVER_A_WINDOW`. With `K <= H + 1` restarts the reads are at most
 * the sum of `j(k) + 1`, which is `(H + 1)(H + 4) / 2` at `K = H + 1`, the last restart ending in
 * the owed day instead of a commit. The ground after the day is one read more.
 */
export const READS_OVER_A_WINDOW =
  ((HALVINGS_OVER_A_WINDOW + 1) * (HALVINGS_OVER_A_WINDOW + 4)) / 2 + 1;

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
