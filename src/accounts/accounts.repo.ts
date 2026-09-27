import {
  type Repository,
  id,
  database,
  write,
  type AccountRow,
  accounts,
  holdings,
  syncState,
  transactions,
} from '@kiko/db';
import { asc, eq, sql } from 'drizzle-orm';
import type { Money } from '@kiko/currency/money';
import type { Currency } from '@kiko/currency/currency';
import { SYNCED_AT_FIELD } from '@kiko/holdings/holding-metadata';
import { isCurrencyAllowedForHoldingType } from '@kiko/holdings/holding-currency';
import { clearLoanLinksForHoldingsDatabaseTransaction } from '@kiko/holdings/repo';
import { isSyncedAccount, type SyncedInstitution } from '@kiko/holdings/deletable';

// The next free grid slot for a new account, read inside the same write
// transaction as the insert so a concurrent create cannot observe a stale
// maximum. A DEBT account appends after every account; an ASSET account
// must sort before every debt account, but an archived row can leave
// `assetMax` tied with or past `debtMin` (`reorder` only rewrites ACTIVE
// ids) — when the candidate slot would collide, every debt account shifts
// up by exactly `candidate - debtMin + 1`, not a flat `+ 1`, to clear the
// WHOLE gap, not just a contiguous one.
const nextSortOrder = async (
  databaseTransaction: typeof database,
  kind: AccountRow['kind'],
): Promise<number> => {
  const rows = await databaseTransaction
    .select({
      assetMax: sql<number>`coalesce(max(case when ${accounts.kind} != 'debt' then ${accounts.sortOrder} end), -1)`,
      debtMin: sql<
        number | null
      >`min(case when ${accounts.kind} = 'debt' then ${accounts.sortOrder} end)`,
      allMax: sql<number>`coalesce(max(${accounts.sortOrder}), -1)`,
    })
    .from(accounts);
  const row = rows.at(0);

  if (kind === 'debt') {
    return (row?.allMax ?? -1) + 1;
  }

  const candidate = (row?.assetMax ?? -1) + 1;
  const debtMin = row?.debtMin;

  if (debtMin !== null && debtMin !== undefined && candidate >= debtMin) {
    await databaseTransaction
      .update(accounts)
      .set({ sortOrder: sql`${accounts.sortOrder} + ${candidate - debtMin + 1}` })
      .where(eq(accounts.kind, 'debt'));
  }

  return candidate;
};

type NewAccount = Pick<AccountRow, 'name' | 'kind'> &
  Partial<Pick<AccountRow, 'id' | 'institution' | 'bankId' | 'sortOrder' | 'color'>>;

type NewCashAccount = {
  name: string;
  currency: Currency;
  // Converted to minor units, and currency-checked against `currency`, inside
  // the write itself (kiko-domain "Money at the boundary") — never by the
  // caller.
  initialBalance: Money;
  // Optional SF Symbol icon, persisted on the account row in the same
  // transaction so a cash account created with a picked icon keeps it (the
  // create form now offers the icon picker for every kind, cash included).
  icon?: string | null;
  // Optional entity color hex, persisted on the account row in the same
  // transaction so a cash account created with a picked (or type-default) color
  // keeps it (the create form offers the color picker for every kind).
  color?: string | null;
};

// A disconnect strips ONLY the balance-sync `syncedAt` stamp (stale
// bookkeeping). The sync KEYS (`monobankId` / `walletAddress` / `binanceAsset`)
// are deliberately KEPT: `upsertByMetadataKey` matches on them, so dropping
// them made a reconnect insert a SECOND holding carrying the same balance,
// double-counting net worth while the original kept every transaction.
// "Manual" is now decided by the account's cleared `institution` alone — see
// `isSyncedHolding`. Every other key (iban, maskedPan, …) stays too.
const strippedOnDisconnect: readonly string[] = [SYNCED_AT_FIELD];

const withoutSyncMetadata = (metadata: Record<string, unknown>): Record<string, unknown> | null => {
  const kept = Object.entries(metadata).filter(([key]) => !strippedOnDisconnect.includes(key));

  return kept.length > 0 ? Object.fromEntries(kept) : null;
};

export const accountsRepo = {
  // Ordered by the user-controlled `sortOrder` (the drag-and-drop grid order),
  // with `createdAt` as a stable tiebreak so any rows that happen to share a
  // rank keep a deterministic order rather than flickering between renders.
  listQuery: () =>
    database.select().from(accounts).orderBy(asc(accounts.sortOrder), asc(accounts.createdAt)),
  byIdQuery: (accountId: string) =>
    database.select().from(accounts).where(eq(accounts.id, accountId)),
  /**
   * The account(s) connected under one institution — Monobank by default, or a
   * balance provider (`'btc_wallet'` / `'binance'`). The one-connection-per-
   * institution invariant means this yields at most one row; the UI uses it to
   * hide "Connect" on every other account while one is connected.
   */
  connectedQuery: (institution: SyncedInstitution = 'monobank') =>
    database.select().from(accounts).where(eq(accounts.institution, institution)),
  /**
   * Insert a new account and resolve to its app id (the text UUID), so a caller
   * can immediately act on the new row (e.g. set its icon). The id is generated
   * here unless the caller pre-generated one and passes it in `input.id` — the
   * create form does this so the shared crypto sync fields (which bind to an
   * existing account id) can key their Keychain write and connect to the future
   * row before it is inserted. The op-sqlite insert result
   * (rowsAffected/lastInsertRowId) is the SQLite rowid, not this id, so it is
   * not returned.
   */
  create: (input: NewAccount): Promise<string> =>
    write(async (databaseTransaction) => {
      const accountId = input.id ?? id();
      const sortOrder = input.sortOrder ?? (await nextSortOrder(databaseTransaction, input.kind));
      await databaseTransaction.insert(accounts).values({ ...input, id: accountId, sortOrder });

      return accountId;
    }),
  /**
   * Create a cash account, its initial cash holding, and — for a non-zero
   * initial balance — that holding's opening ledger row, in ONE op-sqlite
   * transaction, so the account can never persist without its holding (or its
   * holding without the row explaining its balance) on a partial failure
   * (mirrors `transactionsRepo.recordManual`'s ledger + balance atomicity).
   *
   * The opening balance is a manual adjustment like any other, so it gets its
   * own `manual` transaction (kiko-domain: a holding's balance history must stay
   * derivable from its transactions; `holdingsRepo.updateWithBalanceDelta`
   * enforces the same invariant for a later edit). Without it, `holdingValueAt`
   * (statistics/holding-value-at/holding-value-at.ts) back-derived the opening balance as
   * `balance - sum(transactions)` and the whole historical net-worth series
   * carried a step no ledger row could explain.
   *
   * The row is inserted directly rather than through
   * `transactionsRepo.recordManual`, which would ALSO add the amount to a
   * balance the insert above has already set. It carries no description and no
   * category: the label resolves at render time
   * (transactions/row-description.ts).
   *
   * A non-zero initial balance also stamps the holding's `balanceSetAt` — it
   * IS a hand-set balance, the same as `holdingsRepo.create`'s own typed
   * opening balance (see `transactionsRepo.importRows`'s doc comment for why
   * this matters) — at the SAME instant as the ledger row's `time`.
   */
  createCashAccount: ({ name, currency, initialBalance, icon, color }: NewCashAccount) =>
    write(async (databaseTransaction) => {
      if (initialBalance.currency !== currency) {
        throw new Error(
          'accountsRepo.createCashAccount: initial balance currency does not match the account currency',
        );
      }

      if (!isCurrencyAllowedForHoldingType('cash', currency)) {
        throw new Error(`accountsRepo.createCashAccount: a cash holding cannot hold ${currency}`);
      }

      const accountId = id();
      const holdingId = id();
      const sortOrder = await nextSortOrder(databaseTransaction, 'cash');
      const now = Date.now();
      const initialBalanceMinorUnits = initialBalance.minorUnits;

      await databaseTransaction.insert(accounts).values({
        id: accountId,
        name,
        kind: 'cash',
        icon: icon ?? null,
        color: color ?? null,
        sortOrder,
      });
      await databaseTransaction.insert(holdings).values({
        id: holdingId,
        accountId,
        name,
        type: 'cash',
        currency,
        balanceMinorUnits: initialBalanceMinorUnits,
        balanceSetAt: initialBalanceMinorUnits !== 0 ? now : null,
      });

      if (initialBalanceMinorUnits === 0) {
        return;
      }

      await databaseTransaction.insert(transactions).values({
        id: id(),
        holdingId,
        amountMinorUnits: initialBalanceMinorUnits,
        time: now,
        description: '',
        category: null,
        source: 'manual',
      });
    }),
  /**
   * Disconnect a synced account (Monobank, wallet, or Binance), turning it into
   * a plain manual account whose data is kept as a historical snapshot. In ONE
   * op-sqlite transaction: clear the account's `institution` (so
   * `isSyncedAccount` is false, every holding under it reads as manual through
   * `isSyncedHolding`, and `remove` accepts it), and drop the now-stale
   * `syncedAt` stamp from any holding carrying one.
   *
   * The sync KEYS (`monobankId` / `walletAddress` / `binanceAsset`) are KEPT on
   * purpose: `holdingsRepo`'s metadata-key upsert matches on them, so a later
   * reconnect re-adopts these very rows (with their transactions) instead of
   * inserting duplicates that double-count every balance.
   *
   * Balances, holdings and transactions are left as-is; manual holdings under
   * the account are untouched. Clearing a Keychain item is NOT done here — the
   * Keychain is not transactional; the `monobank/disconnect` and
   * `crypto-sync/disconnect` operations compose both.
   */
  disconnect: (accountId: string) =>
    write(async (databaseTransaction) => {
      await databaseTransaction
        .update(accounts)
        .set({ institution: null })
        .where(eq(accounts.id, accountId));
      const accountHoldings = await databaseTransaction
        .select()
        .from(holdings)
        .where(eq(holdings.accountId, accountId));

      // The loop's only job now is to drop `syncedAt` — the account's cleared
      // institution (written above) is what makes each holding manual, so
      // there is no `isSyncedHolding` guard left to apply here.
      for (const holding of accountHoldings) {
        const metadata = holding.metadata;

        // A JSON column can hold a non-object (nothing here writes one, but the
        // `in` test below would throw on it), and only a record can carry the
        // stamp — so both are skipped.
        if (typeof metadata !== 'object' || metadata === null || !(SYNCED_AT_FIELD in metadata)) {
          continue;
        }

        await databaseTransaction
          .update(holdings)
          .set({ metadata: withoutSyncMetadata(metadata as Record<string, unknown>) })
          .where(eq(holdings.id, holding.id));
      }
    }),
  update: (accountId: string, patch: Partial<AccountRow>) =>
    write((databaseTransaction) =>
      databaseTransaction.update(accounts).set(patch).where(eq(accounts.id, accountId)),
    ),
  /**
   * Sets the account's icon (an SF Symbol name) or, with `null`, clears it back
   * to no custom icon. The display layer falls back to a kind-derived default
   * when the stored icon is null.
   */
  setIcon: (accountId: string, icon: string | null) =>
    write((databaseTransaction) =>
      databaseTransaction.update(accounts).set({ icon }).where(eq(accounts.id, accountId)),
    ),
  /**
   * Persist a drag-and-drop reorder of the accounts grid. `orderedIds` is the
   * full new front-to-back order of the visible accounts; each row's
   * `sortOrder` is rewritten to its 0-based index in one transaction so the
   * `listQuery` ordering matches the grid the user just arranged. Archived
   * accounts are filtered out of the grid, so their (untouched) `sortOrder`
   * may tie with a rewritten value — harmless, since they never render and the
   * `createdAt` tiebreak keeps any tie deterministic.
   */
  reorder: (orderedIds: string[]) =>
    write(async (databaseTransaction) => {
      for (let index = 0; index < orderedIds.length; index += 1) {
        await databaseTransaction
          .update(accounts)
          .set({ sortOrder: index })
          .where(eq(accounts.id, orderedIds[index]));
      }
    }),
  /**
   * Delete a MANUAL account together with all of its holdings, every one of
   * their transactions, and its `sync_state` cursor row (INT-1 — an account
   * that ever attempted a Monobank sync, even a failed first Connect, carries
   * one), in ONE op-sqlite transaction so a partial failure can never leave
   * orphaned holdings, ledger rows, or a stranded cursor behind (and so
   * foreign-key enforcement, ON per connection, is satisfied by deleting
   * children before parents: transactions and `sync_state`, then holdings,
   * then the account). A synced (monobank) account is owned by the bank
   * connection and is refused with a typed error; a missing id is a no-op
   * rather than an error.
   *
   * A debt account can hold a loan, and OTHER
   * holdings' payment rows can point back at that loan via `loanHoldingId`.
   * Deleting the account deletes the loan holding too, so this cascade
   * clears those links in the SAME transaction — the same
   * `clearLoanLinksForHoldingsDatabaseTransaction` cascade `holdingsRepo.remove` runs for a
   * single loan holding, applied here to every holding the
   * deleted account owned. A no-op when none of them was a loan.
   */
  remove: (accountId: string) =>
    write(async (databaseTransaction) => {
      const rows = await databaseTransaction
        .select()
        .from(accounts)
        .where(eq(accounts.id, accountId));
      const row = rows.at(0);

      if (!row) {
        return;
      }

      if (isSyncedAccount(row)) {
        throw new Error('accountsRepo.remove: cannot delete a synced account');
      }
      const accountHoldings = await databaseTransaction
        .select()
        .from(holdings)
        .where(eq(holdings.accountId, accountId));

      for (const holding of accountHoldings) {
        await databaseTransaction
          .delete(transactions)
          .where(eq(transactions.holdingId, holding.id));
      }
      // INT-1: `sync_state.account_id` is an FK with NO ACTION (migration
      // `0027`), so deleting `accounts` while a row still references it throws
      // a foreign key constraint error and rolls back the whole delete — for
      // ANY account that ever ran a Monobank sync, including one whose very
      // first Connect attempt failed (`runSyncInner` creates this row via
      // `syncStateRepo.ensure` before the account ever becomes synced). Delete
      // it here, before the account row goes — mirrors the order
      // `restoreDataSnapshot` already uses (`data-transfer/snapshot/restore-snapshot.ts`).
      await databaseTransaction.delete(syncState).where(eq(syncState.accountId, accountId));
      await clearLoanLinksForHoldingsDatabaseTransaction(
        databaseTransaction,
        accountHoldings.map((holding) => holding.id),
      );
      await databaseTransaction.delete(holdings).where(eq(holdings.accountId, accountId));
      await databaseTransaction.delete(accounts).where(eq(accounts.id, accountId));
    }),
} satisfies Repository;
