import type { Repository } from '@kiko/db/repository';
import { eq } from 'drizzle-orm';

import { database, write } from '../db/client';
import { syncState } from '../db/schema';

/**
 * The per-connection Monobank sync cursor repository. It de-globalizes the
 * former single-row `settings` cursor: every read and write is keyed by the
 * connected Monobank account's `accounts.id`, so a second connection can never
 * share and corrupt another's cursor (see the `syncState` table comment in
 * `src/db/schema.ts`). It mirrors the shape of `settings.repo.ts`'s retired
 * cursor setters exactly — a read returns a query builder for `useLiveQuery`; a
 * write performs one transactional update scoped to the account id.
 */
export const syncStateRepo = {
  getQuery: (accountId: string) =>
    database.select().from(syncState).where(eq(syncState.accountId, accountId)),
  /**
   * Insert the cursor row for an account id if it does not exist yet, so a
   * setter always has a row to update. Idempotent: a second call is a no-op via
   * `onConflictDoNothing`. `runSyncInner` calls this right after resolving the
   * target account.
   */
  ensure: (accountId: string) =>
    write((tx) => tx.insert(syncState).values({ accountId }).onConflictDoNothing()),
  setLastSyncAt: (accountId: string, timestamp: number) =>
    write((tx) =>
      tx.update(syncState).set({ lastSyncAt: timestamp }).where(eq(syncState.accountId, accountId)),
    ),
  /**
   * Stamp this account's last FULL statement fetch (epoch ms) — the run that
   * fetched every card regardless of balance. Drives the balance-diff skip's
   * periodic safety net; see `lastFullSyncAt` in `db/schema.ts` and
   * `runSyncInner` in `monobank/sync.ts`.
   */
  setLastFullSyncAt: (accountId: string, timestamp: number) =>
    write((tx) =>
      tx
        .update(syncState)
        .set({ lastFullSyncAt: timestamp })
        .where(eq(syncState.accountId, accountId)),
    ),
  /**
   * Stamp this account's DISPLAY "last synced" timestamp (epoch ms), written on
   * every run that reached Monobank with at least one card succeeding — decoupled
   * from `lastSyncAt`, the pure statement cursor. See `lastSyncDisplayAt` in
   * `db/schema.ts`.
   */
  setLastSyncDisplayAt: (accountId: string, timestamp: number) =>
    write((tx) =>
      tx
        .update(syncState)
        .set({ lastSyncDisplayAt: timestamp })
        .where(eq(syncState.accountId, accountId)),
    ),
  /**
   * Persist this account's Monobank ids whose statement fetch FAILED on the last
   * run — the set the next run force-fetches regardless of balance. Stores the
   * array, or NULL when empty. See `failedSyncMonobankIds` in `db/schema.ts` and
   * the end-of-run sequence in `monobank/sync.ts`.
   */
  setFailedSyncMonobankIds: (accountId: string, ids: string[] | null) =>
    write((tx) =>
      tx
        .update(syncState)
        .set({ failedSyncMonobankIds: ids })
        .where(eq(syncState.accountId, accountId)),
    ),
} satisfies Repository;
