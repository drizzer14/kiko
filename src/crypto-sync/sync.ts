import type { AccountRow, HoldingRow } from '../db/schema';
import { accountsRepo } from '../repositories/accounts.repo';
import { type ExchangeHolding, holdingsRepo } from '../repositories/holdings.repo';

import { type BalanceProvider, type BalanceProviderId, providerDisplayName } from './provider';

/**
 * The injectable data-access seams of a balance sync. Mirrors `SyncDeps` in
 * `monobank/sync.ts` minus everything statement-shaped: a balance sync is one
 * snapshot per provider, so there is no pagination, throttling or transaction
 * import here. Provider-specific seams (network, credentials) live on the
 * provider's own `Deps`, passed through untouched.
 */
export interface BalanceSyncDeps {
  now: () => number;
  /**
   * The user-created account to (re)target this sync at. When set, the account
   * is marked `institution: provider.id` (the Connect action). When absent, the
   * sync targets the account already connected under that institution.
   */
  targetAccountId?: string;
  listAccounts: () => Promise<AccountRow[]>;
  updateAccount: (accountId: string, patch: Partial<AccountRow>) => Promise<unknown>;
  listHoldingsByAccount: (accountId: string) => Promise<HoldingRow[]>;
  upsertHolding: (holding: ExchangeHolding) => Promise<unknown>;
}

export type BalanceSyncResult = { syncedHoldings: number };

const defaultDeps: BalanceSyncDeps = {
  now: () => Date.now(),
  listAccounts: async () => accountsRepo.listQuery(),
  updateAccount: (accountId, patch) => accountsRepo.update(accountId, patch),
  listHoldingsByAccount: async (accountId) => holdingsRepo.listByAccountQuery(accountId),
  upsertHolding: (holding) => holdingsRepo.upsertExchange(holding),
};

/**
 * Resolve the account this sync writes into, mirroring `ensureMonobankAccount`
 * but scoped per institution: one connection per provider id, so a wallet and
 * a Binance connection coexist as two accounts while two wallet connections
 * cannot silently double-count. Re-connecting the SAME account is an
 * idempotent re-sync. This only reads — marking happens after a successful
 * fetch, so a failed fetch never leaves a half-connected account behind.
 */
const resolveTargetAccount = async (
  deps: BalanceSyncDeps,
  providerId: BalanceProviderId,
): Promise<string> => {
  const accounts = await deps.listAccounts();
  const name = providerDisplayName(providerId);

  if (deps.targetAccountId !== undefined) {
    const target = accounts.find((account) => account.id === deps.targetAccountId);

    if (!target) {
      throw new Error(`No ${name} connection found`);
    }

    const otherConnected = accounts.find((account) => {
      return account.institution === providerId && account.id !== deps.targetAccountId;
    });

    if (otherConnected) {
      throw new Error(`${name} is already connected to another account`);
    }

    return deps.targetAccountId;
  }

  const existing = accounts.find((account) => account.institution === providerId);

  if (!existing) {
    throw new Error(`No ${name} connection found`);
  }

  return existing.id;
};

/**
 * One balance sync: resolve the target account, fetch the provider's balance
 * snapshot, mark the account with the provider's institution, and upsert one
 * `crypto_asset` holding per returned balance, keyed on the provider's
 * metadata field and stamped `syncedAt`. No `transactions` rows are written —
 * a wallet or exchange gives a live number, not a ledger.
 */
export const runBalanceSync = async <Deps>(
  provider: BalanceProvider<Deps>,
  providerDeps: Deps,
  overrides: Partial<BalanceSyncDeps> = {},
): Promise<BalanceSyncResult> => {
  const deps: BalanceSyncDeps = { ...defaultDeps, ...overrides };
  const accountId = await resolveTargetAccount(deps, provider.id);
  const holdings = await deps.listHoldingsByAccount(accountId);
  const balances = await provider.fetchBalances(providerDeps, { accountId, holdings });

  await deps.updateAccount(accountId, { institution: provider.id });
  const syncedAt = deps.now();

  for (const balance of balances) {
    await deps.upsertHolding({
      accountId,
      name: balance.name,
      type: 'crypto_asset',
      currency: balance.currency,
      balanceMinorUnits: balance.balanceMinorUnits,
      metadata: { syncedAt },
      metadataField: provider.metadataField,
      metadataKey: balance.metadataKey,
    });
  }

  return { syncedHoldings: balances.length };
};
