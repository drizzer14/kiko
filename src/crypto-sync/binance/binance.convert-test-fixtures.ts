import { NOW } from './binance.pay-test-fixtures';
import type { BinanceConvertRecord } from './binance.history-client';

/** When the fixture conversion was made: ten minutes before `NOW`. */
export const CONVERT_CREATED_AT = NOW - 600_000;

/** A settled Funding conversion of 1000 UAH into 24.1 USDT; a test overrides what it varies. */
export const convertRecordOf = (
  over: Partial<BinanceConvertRecord> = {},
): BinanceConvertRecord => ({
  recordId: 'order-1',
  orderStatus: 'SUCCESS',
  walletType: 'FUNDING',
  fromAsset: 'UAH',
  fromAmount: '1000',
  toAsset: 'USDT',
  toAmount: '24.1',
  createTime: CONVERT_CREATED_AT,
  ...over,
});
