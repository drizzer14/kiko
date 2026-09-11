import { type CryptoSyncRequest, runCryptoSync } from '../../crypto-sync/run-crypto-sync';
import { type SyncAction, useSyncAction } from '../use-sync';

/** The wallet / Binance sync action used by the crypto account detail. */
export const useCryptoSync = (): SyncAction<CryptoSyncRequest> =>
  useSyncAction<CryptoSyncRequest>(runCryptoSync);
