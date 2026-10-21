import { NOW } from './binance.pay-test-fixtures';
import { BinanceHistoryTooOldError } from './binance.client';
import type { BinanceConvertRecord, ConvertHistoryPage } from './binance.history-client';

/** When the fixture conversion was made: ten minutes before `NOW`. */
export const CONVERT_CREATED_AT = NOW - 600_000;

/** A settled Funding conversion of 1000 UAH into 24.1 USDT; a test overrides what it varies. */
export const convertRecordOf = (
  over: Partial<BinanceConvertRecord> = {},
): BinanceConvertRecord => ({
  recordId: 'quote-1',
  orderStatus: 'SUCCESS',
  walletType: 'FUNDING',
  fromAsset: 'UAH',
  fromAmount: '1000',
  toAsset: 'USDT',
  toAmount: '24.1',
  createTime: CONVERT_CREATED_AT,
  ...over,
});

/** One Convert page of `rows`, not `moreData`, with no weight reading. */
export const convertPageOf = (
  rows: BinanceConvertRecord[] = [],
  over: Partial<ConvertHistoryPage> = {},
): ConvertHistoryPage => ({
  rows,
  unreadable: [],
  moreData: false,
  usedUidWeight1m: undefined,
  usedIpWeight1m: undefined,
  ...over,
});

/**
 * A Convert history as Binance serves it: the records whose `createTime` is in the window asked
 * for, and a refusal of a `startTime` older than `depthMs` (the history it keeps). A depth that
 * moves with the clock moves `depthMovesMs` forward with every request the server has answered.
 */
export const convertServerOf = (records: BinanceConvertRecord[], depthMs = 0, depthMovesMs = 0) => {
  let requests = 0;

  return jest.fn(
    async (
      _apiKey: string,
      _secret: string,
      query: { startTime: number; endTime: number },
    ): Promise<ConvertHistoryPage> => {
      const depthNowMs = depthMs + requests * depthMovesMs;
      requests += 1;

      if (query.startTime < depthNowMs) {
        throw new BinanceHistoryTooOldError('Binance request failed: 400');
      }

      return convertPageOf(
        records.filter(
          ({ createTime }) => createTime >= query.startTime && createTime <= query.endTime,
        ),
      );
    },
  );
};
