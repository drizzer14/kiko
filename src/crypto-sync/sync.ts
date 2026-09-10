import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { type ExchangeHolding, holdingsRepo } from '@kiko/holdings/holdings.repo';

import type { AccountRow, HoldingRow } from '../db/schema';
import { i18n } from '../i18n';
import {
  beginProgressSession,
  commitHolding,
  commitWork,
  endProgressSession,
  registerWork,
} from '../monobank/sync-status';

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
 * Resolve the account this sync writes into, mirroring
 * `resolveMonobankAccountId` (`src/monobank/sync.ts`) but scoped per
 * institution: one connection per provider id, so a wallet and
 * a Binance connection coexist as two accounts while two wallet connections
 * cannot silently double-count. Re-connecting the SAME account is an
 * idempotent re-sync. This only reads — marking happens after a successful
 * fetch, so a failed fetch never leaves a half-connected account behind.
 */
// Unlike the Monobank/disconnect error paths (which the screen swallows behind
// a bare `catch` and a generic translated fallback — see
// `accountDetail.tryAgainMessage`), `useSyncAction` (src/screens/use-sync.ts)
// surfaces THIS thrown message's `.message` verbatim as the sync screen's
// error `<Text>`, so it genuinely needs `providerDisplayName`'s translated
// name, not the raw `providerId`. This module has no React context of its
// own, so it reads the i18next instance directly (the same pattern as
// `src/screens/grid-interaction.ts`) rather than threading a `t` prop through
// every sync call site.
const resolveTargetAccount = async (
  deps: BalanceSyncDeps,
  providerId: BalanceProviderId,
): Promise<string> => {
  const accounts = await deps.listAccounts();
  const name = providerDisplayName(providerId, i18n.t);

  if (deps.targetAccountId !== undefined) {
    const target = accounts.find((account) => account.id === deps.targetAccountId);

    if (!target) {
      throw new Error(i18n.t('accountDetail.noConnectionFound', { name }));
    }

    const otherConnected = accounts.find((account) => {
      return account.institution === providerId && account.id !== deps.targetAccountId;
    });

    if (otherConnected) {
      throw new Error(i18n.t('accountDetail.sourceConnectedElsewhere', { source: name }));
    }

    return deps.targetAccountId;
  }

  const existing = accounts.find((account) => account.institution === providerId);

  if (!existing) {
    throw new Error(i18n.t('accountDetail.noConnectionFound', { name }));
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
  // Enter the shared progress session (see `src/monobank/sync-status.ts`) so this
  // crypto sync feeds the same determinate bar as a concurrent Monobank run. The
  // `finally` leaves it on EVERY path — a failed fetch never strands the bar.
  beginProgressSession();
  try {
    const accountId = await resolveTargetAccount(deps, provider.id);
    const holdings = await deps.listHoldingsByAccount(accountId);
    const balances = await provider.fetchBalances(providerDeps, { accountId, holdings });

    await deps.updateAccount(accountId, { institution: provider.id });
    const syncedAt = deps.now();

    // Every returned holding does real work: a crypto sync has no balance-diff
    // skip — it always reads live balances — so each holding is ONE work unit and
    // one holding on the weighted bar (a light balance fetch, versus a Monobank
    // card weighted by its statement-window count). Registered BEFORE the first
    // upsert so the denominator is known up front; a run that returns no balance
    // registers nothing, so the bar never appears for it (the no-op guard).
    if (balances.length > 0) {
      registerWork(balances.length, balances.length);
    }

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
        renameFromDefault: balance.renameFromDefault,
      });
      // One crypto holding's balance has committed: advance the bar one work unit
      // and complete the holding for the label.
      commitWork();
      commitHolding();
    }

    return { syncedHoldings: balances.length };
  } finally {
    endProgressSession();
  }
};
