import { accountsRepo } from '@kiko/accounts/accounts.repo';

import { clearToken } from './token';

/**
 * Disconnect a Monobank-connected account, the required first step before it
 * can be deleted. The DB mutation (`accountsRepo.disconnect`) runs as
 * one transaction: it clears the account's `institution` — which alone turns
 * the account and its card/jar holdings into plain manual ones — while KEEPING
 * each holding's `monobankId` so a later reconnect re-adopts those very rows
 * instead of duplicating them. All balances, holdings and transactions are kept
 * as a historical snapshot. Only after that commits do we clear this account's
 * OWN Keychain token (`clearToken(accountId)` — the per-account item, never a
 * shared global one), so disconnecting one connection never drops another's
 * token. The Keychain is not transactional, so if the DB write throws the token
 * is left untouched and the account stays connected (nothing half-disconnected).
 *
 * After this resolves the account is manual, so `accountsRepo.remove` accepts
 * it (its synced guard sees `institution: null`) and the existing swipe-delete
 * cascade applies.
 */
export const disconnectMonobank = async (accountId: string): Promise<void> => {
  await accountsRepo.disconnect(accountId);
  await clearToken(accountId);
};
