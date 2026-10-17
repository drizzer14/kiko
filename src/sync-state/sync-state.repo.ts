import { eq } from 'drizzle-orm';
import {
  type ExchangeStatePatch,
  exchangeStatePatched,
  exchangeStateReset,
} from '@kiko/crypto-sync/exchange/walk-state';
import type { BalanceProviderId } from '@kiko/crypto-sync/provider';
import { type Repository, accounts, syncState, database, write } from '@kiko/db';

/**
 * The stored `exchange_state` text of an account that is STILL connected to `exchangeId`, read
 * inside the writer's own `write(...)`: `undefined` when the account is gone or left the exchange
 * (a walk holds the credentials for its whole run, so a disconnect can commit while it is in
 * flight), `{ text: null }` when it has no state row or a never-written column.
 */
const connectedExchangeState = async (
  databaseTransaction: typeof database,
  accountId: string,
  exchangeId: BalanceProviderId,
): Promise<{ text: string | null } | undefined> => {
  const rows = await databaseTransaction
    .select({ institution: accounts.institution, exchangeState: syncState.exchangeState })
    .from(accounts)
    .leftJoin(syncState, eq(syncState.accountId, accounts.id))
    .where(eq(accounts.id, accountId));
  const row = rows.at(0);

  if (row === undefined || row.institution !== exchangeId) {
    return undefined;
  }

  return { text: row.exchangeState };
};

/**
 * The per-connection sync state repository: the Monobank sync cursors and an exchange account's
 * walk state (`exchange_state`). It de-globalizes the former single-row `settings` cursor: every
 * read and write is keyed by the connected account's `accounts.id`, so a second connection can
 * never share and corrupt another's state (see the `syncState` table comment in
 * `src/db/schema.ts`). It mirrors the shape of `settings.repo.ts`'s retired cursor setters
 * exactly — a read returns a query builder for `useLiveQuery`; a write performs one transactional
 * update scoped to the account id.
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
    write((databaseTransaction) =>
      databaseTransaction.insert(syncState).values({ accountId }).onConflictDoNothing(),
    ),
  setLastSyncAt: (accountId: string, timestamp: number) =>
    write((databaseTransaction) =>
      databaseTransaction
        .update(syncState)
        .set({ lastSyncAt: timestamp })
        .where(eq(syncState.accountId, accountId)),
    ),
  /**
   * Stamp this account's full-fetch marker (epoch ms) — either the last FULL
   * statement fetch that succeeded (every card fetched regardless of
   * balance), or a first-ever full fetch that FAILED anchoring its own
   * from-cursor instead of its ceiling. Drives the balance-diff skip's
   * periodic safety net; see `lastFullSyncAt` in `db/schema.ts` and
   * `resolveFullSyncAtToPersist` in `monobank/sync/sync.ts`.
   */
  setLastFullSyncAt: (accountId: string, timestamp: number) =>
    write((databaseTransaction) =>
      databaseTransaction
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
    write((databaseTransaction) =>
      databaseTransaction
        .update(syncState)
        .set({ lastSyncDisplayAt: timestamp })
        .where(eq(syncState.accountId, accountId)),
    ),
  /**
   * Persist this account's Monobank ids whose statement fetch FAILED on the last
   * run — the set the next run force-fetches regardless of balance. Stores the
   * array, or NULL when empty. See `failedSyncMonobankIds` in `db/schema.ts` and
   * the end-of-run sequence in `src/monobank/sync/sync.ts`.
   */
  setFailedSyncMonobankIds: (accountId: string, ids: string[] | null) =>
    write((databaseTransaction) =>
      databaseTransaction
        .update(syncState)
        .set({ failedSyncMonobankIds: ids })
        .where(eq(syncState.accountId, accountId)),
    ),
  /**
   * Write changes to an exchange account's `exchange_state` (a walk's mark, a trade entry, a coin
   * list), only while `accounts.institution` is still `exchangeId`: the re-read, the gate and the
   * write share one `write(...)`, which op-sqlite runs on its one worker queue, so the patches of
   * a call land together (a cursor with the other marks written beside it), and a late write from
   * a walk started before a disconnect finds the institution cleared and writes nothing, instead
   * of undoing the disconnect's reset (`resetExchangeStateDatabaseTransaction`, which the
   * disconnect runs in the same write that clears the institution). It patches the stored JSON
   * text, never the parse (see `exchangeStatePatched`), inserts the row when none exists, and
   * writes nothing when the stored top level is malformed.
   */
  patchExchangeState: (
    accountId: string,
    exchangeId: BalanceProviderId,
    patches: readonly ExchangeStatePatch[],
  ) =>
    write(async (databaseTransaction) => {
      const stored = await connectedExchangeState(databaseTransaction, accountId, exchangeId);

      if (stored === undefined) {
        return;
      }

      const text = exchangeStatePatched(stored.text, patches);

      if (text === undefined) {
        return;
      }

      await databaseTransaction
        .insert(syncState)
        .values({ accountId, exchangeState: text })
        .onConflictDoUpdate({ target: syncState.accountId, set: { exchangeState: text } });
    }),
  /**
   * Replace an exchange account's whole `exchange_state` with its walks reset to `floorMs`
   * (`exchangeStateReset`), inside the caller's `write(...)`. It is the first half of
   * `accountsRepo.disconnectExchange`, which clears the institution in the same write: the gate
   * passes for the reset, and a walk's patch queued behind that write finds the institution
   * cleared and writes nothing, so nothing lands between the reset and the clear. A column
   * nothing ever wrote stays null.
   */
  resetExchangeStateDatabaseTransaction: async (
    databaseTransaction: typeof database,
    accountId: string,
    exchangeId: BalanceProviderId,
    floorMs: number,
  ) => {
    const stored = await connectedExchangeState(databaseTransaction, accountId, exchangeId);

    if (stored === undefined || stored.text === null) {
      return;
    }

    await databaseTransaction
      .update(syncState)
      .set({ exchangeState: exchangeStateReset(stored.text, floorMs) })
      .where(eq(syncState.accountId, accountId));
  },
} satisfies Repository;
