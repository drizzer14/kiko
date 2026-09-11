import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { type ExchangeHolding, holdingsRepo } from '@kiko/holdings/holdings.repo';

import type { AccountRow, HoldingRow } from '../../db/schema';
import { i18n } from '../../i18n';
import {
  beginProgressSession,
  commitHolding,
  commitWork,
  endProgressSession,
  registerWork,
} from '../../monobank/sync-status';
import { type BalanceProvider, type BalanceProviderId, providerDisplayName } from '../provider';

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
 * `resolveMonobankAccountId` (`src/monobank/sync.ts`). A `targetAccountId` sync
 * validates only that the target exists — MULTIPLE `binance` and multiple
 * `btc_wallet` connections are allowed (Task 5.2), each an independent account
 * with its own per-account secret/address and its own single-flight key.
 * Re-connecting the SAME account is an idempotent re-sync. This only reads —
 * marking happens after a successful fetch, so a failed fetch never leaves a
 * half-connected account behind.
 */
// Unlike the Monobank/disconnect error paths (which the screen swallows behind
// a bare `catch` and a generic translated fallback — see
// `accountDetail.tryAgainMessage`), `useSyncAction` (src/sync/use-sync.ts)
// surfaces THIS thrown message's `.message` verbatim as the sync screen's
// error `<Text>`, so it genuinely needs `providerDisplayName`'s translated
// name, not the raw `providerId`. This module has no React context of its
// own, so it reads the i18next instance directly (the same pattern as
// `src/design-system/grid-interaction/grid-interaction.ts`) rather than threading a `t` prop through
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

    // Multi-connection (Task 5.2): a second `binance` or `btc_wallet` account may
    // connect while another already holds that provider. Each account keys its own
    // secret (Binance credentials) / public address (wallet, per-holding), and the
    // per-account `inFlightBalanceSyncs` join keys by `targetAccountId`, so distinct
    // accounts sync safely and independently. Only the target's existence is
    // validated here.
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
/**
 * Per-account single-flight join, mirroring `inFlightSync` in
 * `src/monobank/sync.ts` but keyed per account. Auto-sync (`useAutoSync`, app
 * open) and pull-to-refresh (`useSyncAll`) can each fan out over the SAME
 * connected crypto account; without this lock each fires its own
 * `runBalanceSync`, doubling the provider (Binance) request weight AND
 * double-registering the account's holdings into the shared, reference-counted
 * progress session (`src/monobank/sync-status.ts`) — whose accumulators reset
 * only when the session depth returns to 0 — so the "N / M holdings" total grew
 * by the crypto holding count on every overlap. While a run is in flight for an
 * account, every new trigger for that SAME account JOINS it and observes its
 * result instead of starting a second run; the lock releases the instant the run
 * settles — success OR failure — so a later, non-overlapping sync starts fresh.
 *
 * The key is the caller's `targetAccountId` when set (always the case for the
 * fan-out — see `syncJobsFor`/`resyncRequest`), and the provider institution
 * otherwise: there is one connection per provider id (see
 * `resolveTargetAccount`), so a no-target re-sync resolves to that one account
 * and shares its key. Keying per account (not one global lock like the Monobank
 * side, which drives a single token) lets a wallet sync and a Binance sync run
 * concurrently — they are distinct accounts and hit distinct provider endpoints.
 * The check and set are SYNCHRONOUS (no `await` before the map is written), so
 * two overlapping triggers cannot both slip past into their own run.
 */
const inFlightBalanceSyncs = new Map<string, Promise<BalanceSyncResult>>();

export const runBalanceSync = <Deps>(
  provider: BalanceProvider<Deps>,
  providerDeps: Deps,
  overrides: Partial<BalanceSyncDeps> = {},
): Promise<BalanceSyncResult> => {
  const key = overrides.targetAccountId ?? `institution:${provider.id}`;
  const joined = inFlightBalanceSyncs.get(key);
  if (joined) {
    return joined;
  }
  const run = runBalanceSyncInner(provider, providerDeps, overrides);
  inFlightBalanceSyncs.set(key, run);
  const release = (): void => {
    if (inFlightBalanceSyncs.get(key) === run) {
      inFlightBalanceSyncs.delete(key);
    }
  };
  // Release on both settle paths; `run` still carries the real result/rejection
  // to the caller and to every joined trigger.
  run.then(release, release);
  return run;
};

const runBalanceSyncInner = async <Deps>(
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
