import { NOW } from './binance.pay-test-fixtures';
import type { BinanceDustEntry, BinanceDustRecord } from './binance.history-client';

/** When the fixture dust conversion was made: ten minutes before `NOW`. */
export const DUST_OPERATED_AT = NOW - 600_000;

/** A parsed entry converting 0.0009 TRX into 0.000441 BNB; a test overrides what it varies. */
export const dustEntryOf = (over: Partial<BinanceDustEntry> = {}): BinanceDustEntry => ({
  fromAsset: 'TRX',
  amount: '0.0009',
  transferedAmount: '0.000441',
  ...over,
});

/** A parsed record of one TRX entry, keyed by the text `record-1`. */
export const dustRecordOf = (over: Partial<BinanceDustRecord> = {}): BinanceDustRecord => ({
  transId: 'record-1',
  operateTime: DUST_OPERATED_AT,
  entries: [dustEntryOf()],
  ...over,
});

/**
 * An entry as Binance sends it, with the fields the read ignores too (`serviceChargeAmount`,
 * `targetAsset`, and the entry's own `transId` and `operateTime`), so a test shows they never
 * reach a parsed entry.
 */
export const wireDustEntryOf = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  transId: 45_178_372_831,
  serviceChargeAmount: '0.00000984',
  amount: '0.0009',
  operateTime: DUST_OPERATED_AT,
  transferedAmount: '0.000441',
  fromAsset: 'TRX',
  targetAsset: 'BNB',
  ...over,
});

/** A record as Binance sends it, with the record totals the read ignores. */
export const wireDustRecordOf = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  operateTime: DUST_OPERATED_AT,
  totalTransferedAmount: '0.00132256',
  totalServiceChargeAmount: '0.00002643',
  transId: 'record-1',
  userAssetDribbletDetails: [wireDustEntryOf()],
  ...over,
});
