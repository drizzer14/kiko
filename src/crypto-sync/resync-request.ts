import { match } from 'ts-pattern';

import type { BalanceProviderId } from './provider';
import type { CryptoSyncRequest } from './run-crypto-sync';

/**
 * Build the re-sync request for an already-connected crypto account. A re-sync
 * carries NO address — the wallet provider reads the stored `walletAddress`
 * (and the exchange provider its Keychain credentials) back itself. The `match`
 * narrows the id so each arm builds the correct `CryptoSyncRequest` member.
 *
 * Shared by the account-detail "Sync now" button and the Home pull-to-refresh
 * fan-out (`use-sync-all`) so both speak one re-sync shape.
 */
export const resyncRequest = (
  providerId: BalanceProviderId,
  targetAccountId: string,
): CryptoSyncRequest =>
  match(providerId)
    .with('btc_wallet', (id) => ({ providerId: id, targetAccountId }))
    .with('binance', (id) => ({ providerId: id, targetAccountId }))
    .exhaustive();
