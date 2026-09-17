import { accountsRepo } from '@kiko/accounts/accounts.repo';

import { clearCredentials } from '../credentials';

/**
 * Disconnect a PrivatBank-connected account — mirrors
 * `src/monobank/disconnect/disconnect.ts` exactly. The DB mutation
 * (`accountsRepo.disconnect`) runs as one transaction: it clears the
 * account's `institution` — which alone turns the account and its holdings
 * into plain manual ones — while KEEPING each holding's `privatbankId` so a
 * later reconnect re-adopts those very rows instead of duplicating them. All
 * balances, holdings and transactions are kept as a historical snapshot.
 * Only after that commits do we clear this account's OWN Keychain credential
 * pair (`clearCredentials(accountId)` — the per-account item, never a shared
 * one), so disconnecting one connection never drops another's credentials.
 * The Keychain is not transactional, so if the DB write throws the pair is
 * left untouched and the account stays connected (nothing half-disconnected).
 */
export const disconnectPrivatbank = async (accountId: string): Promise<void> => {
  await accountsRepo.disconnect(accountId);
  await clearCredentials(accountId);
};
