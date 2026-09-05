import { accountsRepo } from '../repositories/accounts.repo';

import { clearToken } from './token';

/**
 * Disconnect a Monobank-connected account, the required first step before it
 * can be deleted. The DB mutation (`accountsRepo.disconnect`) runs as
 * one transaction: it clears the account's `institution` and strips the
 * `monobankId` from every synced holding's metadata, turning the account and
 * its card/jar holdings into plain manual ones while keeping all balances,
 * holdings and transactions as a historical snapshot. Only after that commits
 * do we clear the stored Monobank token from the Keychain — the Keychain is not
 * transactional, so if the DB write throws the token is left untouched and the
 * account stays connected (nothing half-disconnected).
 *
 * After this resolves the account is manual, so `accountsRepo.remove` accepts
 * it (its synced guard sees `institution: null`) and the existing swipe-delete
 * cascade applies.
 */
export const disconnectMonobank = async (accountId: string): Promise<void> => {
  await accountsRepo.disconnect(accountId);
  await clearToken();
};
