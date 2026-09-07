import { and, asc, eq, sql } from 'drizzle-orm';

import { database, write } from '../db/client';
import { id } from '../db/id';
import { accounts, type HoldingRow, holdings, transactions } from '../db/schema';
import { isSyncedHolding } from '../holdings/deletable';
import {
  asTermDepositMeta,
  type DepositContribution,
  type ExchangeMetadataField,
  type SyncedMetadataField,
} from '../holdings/holding-metadata';

import type { Repository } from './repository';

// The next free grid slot for a new holding under one account: one past that
// account's current highest `sortOrder` (or 0 when it has no holdings yet), so
// a freshly created holding appends to the end of that account's grid. Scoped
// per account because each account renders its own holdings grid. Read inside
// the write transaction so a concurrent create cannot observe a stale maximum.
const nextSortOrder = async (tx: typeof database, accountId: string): Promise<number> => {
  const rows = await tx
    .select({ value: sql<number>`coalesce(max(${holdings.sortOrder}), -1)` })
    .from(holdings)
    .where(eq(holdings.accountId, accountId));

  return (rows.at(0)?.value ?? -1) + 1;
};

type NewHolding = Pick<HoldingRow, 'accountId' | 'name' | 'type' | 'currency'> &
  Partial<Pick<HoldingRow, 'balanceMinorUnits' | 'metadata' | 'sortOrder' | 'color'>>;

/**
 * A synced holding carries its source key in `metadata[metadataField]`:
 * `monobankId` for a Monobank card/jar, `walletAddress` / `binanceAsset` for a
 * balance provider. Upserts match on that key so a re-sync updates the balance
 * in place instead of duplicating the holding.
 */
type SyncedHolding = NewHolding & { metadataField: SyncedMetadataField; metadataKey: string };

type MonobankHolding = NewHolding & { monobankId: string };

export type ExchangeHolding = NewHolding & {
  metadataField: ExchangeMetadataField;
  metadataKey: string;
};

// Match on `json_extract(metadata, '$.<field>') = key`, scoped to the account;
// update balance + metadata in place on a hit, insert with a fresh sortOrder on
// a miss. The JSON path is bound as a parameter (json_extract takes any text
// expression), so this one helper serves every synced field. The holding's
// name is written only on insert — a user rename survives a re-sync.
const upsertByMetadataKey = async (
  tx: typeof database,
  { metadataField, metadataKey, metadata, ...rest }: SyncedHolding,
): Promise<void> => {
  const merged = { ...(metadata as Record<string, unknown> | null), [metadataField]: metadataKey };
  const keyMatch = sql`json_extract(${holdings.metadata}, ${`$.${metadataField}`}) = ${metadataKey}`;
  const existing = await tx
    .select({ id: holdings.id })
    .from(holdings)
    .where(and(eq(holdings.accountId, rest.accountId), keyMatch))
    .limit(1);
  const current = existing.at(0);

  if (current) {
    await tx
      .update(holdings)
      .set({ balanceMinorUnits: rest.balanceMinorUnits ?? 0, metadata: merged })
      .where(eq(holdings.id, current.id));

    return;
  }

  const sortOrder = rest.sortOrder ?? (await nextSortOrder(tx, rest.accountId));
  await tx.insert(holdings).values({ id: id(), ...rest, metadata: merged, sortOrder });
};

// Append one contribution to a term deposit and rewrite its metadata, operating
// on an EXISTING transaction handle so a caller (e.g. `recordExchange`) can run
// it inside a larger single transaction. `appendDepositContribution` wraps this
// in its own `write(...)`. Throws on a non-deposit or invalid/absent metadata.
export const appendDepositContributionTx = async (
  tx: typeof database,
  holdingId: string,
  contribution: DepositContribution,
): Promise<void> => {
  const rows = await tx.select().from(holdings).where(eq(holdings.id, holdingId));
  const row = rows.at(0);

  if (row?.type !== 'term_deposit') {
    throw new Error('appendDepositContribution: not a term deposit');
  }

  const meta = asTermDepositMeta(row.metadata);

  if (meta === null) {
    throw new Error('appendDepositContribution: invalid deposit metadata');
  }

  const { amountMinorUnits, date } = contribution;

  if (!Number.isFinite(amountMinorUnits) || !Number.isFinite(date)) {
    throw new Error('appendDepositContribution: invalid contribution');
  }

  // Build the item explicitly (never spread `contribution`) so no extra
  // caller-supplied keys can persist into stored metadata.
  const contributions = [...meta.contributions, { amountMinorUnits, date }].sort(
    (a, b) => a.date - b.date,
  );

  await tx
    .update(holdings)
    .set({
      metadata: {
        contributions,
        annualRatePct: meta.annualRatePct,
        termMonths: meta.termMonths,
        recapitalization: meta.recapitalization,
        compounding: meta.compounding,
      },
    })
    .where(eq(holdings.id, holdingId));
};

export const holdingsRepo = {
  // Ordered by the user-controlled `sortOrder` (the drag-and-drop grid order),
  // with `createdAt` as a stable tiebreak so rows sharing a rank keep a
  // deterministic order rather than flickering between renders.
  allQuery: () =>
    database.select().from(holdings).orderBy(asc(holdings.sortOrder), asc(holdings.createdAt)),
  byIdQuery: (holdingId: string) =>
    database.select().from(holdings).where(eq(holdings.id, holdingId)),
  listByAccountQuery: (accountId: string) =>
    database
      .select()
      .from(holdings)
      .where(eq(holdings.accountId, accountId))
      .orderBy(asc(holdings.sortOrder), asc(holdings.createdAt)),
  /**
   * Insert a new holding and resolve to its generated app id (the text UUID),
   * so a caller can immediately act on the new row (e.g. set its icon). The
   * op-sqlite insert result (rowsAffected/lastInsertRowId) is the SQLite rowid,
   * not this id, so it is not returned. A new holding appends to the end of its
   * account's grid via `sortOrder = max + 1` unless an explicit order is given.
   *
   * A non-zero opening balance additionally seeds its own `manual` transaction
   * in the SAME op-sqlite transaction — the same rule
   * `updateWithBalanceDelta` (an edit) and `accountsRepo.createCashAccount`
   * (a cash account's first holding) follow, so a holding's balance is
   * explained by its ledger from the moment it exists (kiko-domain). Without
   * it, `holdingValueAt` (statistics/holding-value-at.ts) back-derives an
   * opening balance out of `balance - sum(transactions)` that no row accounts
   * for, and the historical net-worth series carries an unexplained step.
   * The row is inserted directly rather than through
   * `transactionsRepo.recordManual`, which would add the amount to the balance
   * this insert has already set. It is the SYNC upserts (`upsertMonobank` /
   * `upsertExchange`), not this function, that write a provider-owned balance,
   * so no sync path is affected.
   */
  create: (input: NewHolding): Promise<string> =>
    write(async (tx) => {
      const holdingId = id();
      const sortOrder = input.sortOrder ?? (await nextSortOrder(tx, input.accountId));
      await tx.insert(holdings).values({ id: holdingId, ...input, sortOrder });

      const openingBalance = input.balanceMinorUnits ?? 0;

      if (openingBalance !== 0) {
        await tx.insert(transactions).values({
          id: id(),
          holdingId,
          amountMinorUnits: openingBalance,
          time: Date.now(),
          description: '',
          category: null,
          source: 'manual',
        });
      }

      return holdingId;
    }),
  updateName: (holdingId: string, name: string) =>
    write((tx) => tx.update(holdings).set({ name }).where(eq(holdings.id, holdingId))),
  /**
   * Generic partial update for a holding row (name, color, metadata), mirroring
   * `accountsRepo.update`. The icon routes through `setIcon` instead (so a
   * cleared icon persists an explicit null), the same split the create form
   * uses.
   *
   * A patch that touches `balanceMinorUnits` belongs on
   * `updateWithBalanceDelta` below, NOT here: this bare `set(patch)` moves a
   * balance with no ledger row to explain it, which breaks the kiko-domain
   * invariant. `update` stays bare on purpose for the non-balance callers
   * (`setIcon`/`setColor`-style field writes, the sync's own writes, reorder),
   * which must never start emitting transactions.
   */
  update: (holdingId: string, patch: Partial<HoldingRow>) =>
    write((tx) => tx.update(holdings).set(patch).where(eq(holdings.id, holdingId))),
  /**
   * Update a holding's editable fields and, when `balanceMinorUnits` is part of
   * the patch and differs from what is stored, write the DIFFERENCE as a
   * `manual` transaction — both in ONE op-sqlite transaction, so the balance and
   * the ledger row can never desync on a partial failure.
   *
   * WHY: kiko-domain's invariant is that a manual balance adjustment always
   * writes a manual transaction, so a holding's balance history stays derivable
   * from its transactions. `holdingValueAt` (statistics/holding-value-at.ts)
   * back-derives each holding's opening balance as
   * `currentBalance - sum(allTransactions)`, so a bare `set({ balanceMinorUnits })`
   * retroactively shifted the ENTIRE historical net-worth series by the delta,
   * with no ledger row to explain it, and left the holding-detail transaction
   * list unable to reconcile with its own displayed Value.
   *
   * The stored balance is re-read INSIDE the transaction so the delta is computed
   * against what is actually persisted, never a render snapshot — the same rule
   * `transactionsRepo.update` follows.
   *
   * The row is inserted here directly rather than through
   * `transactionsRepo.recordManual`, which ALSO adjusts the balance: the patch
   * above has already written the absolute new balance, so routing through it
   * would apply the delta a second time. Do not "DRY" the two together.
   *
   * The row carries no description and no category: the list resolves its label
   * at render time (transactions/row-description.ts), so no English sentence is
   * persisted, and the category stays the user's to pick.
   *
   * DELIBERATE (ruled, not an oversight): with a null category the row folds
   * onto `settings.defaultCategoryKey`, so a downward correction DOES count as
   * spending in the breakdown — exactly like any other uncategorised manual
   * row, and the user can edit or recategorise it. Do not "fix" this by
   * excluding these rows without a decision to give them a structural marker
   * (the exchange precedent in db/schema.ts), which a reserved category value
   * cannot provide.
   */
  updateWithBalanceDelta: (holdingId: string, patch: Partial<HoldingRow>, time: number) =>
    write(async (tx) => {
      const rows = await tx
        .select({ balanceMinorUnits: holdings.balanceMinorUnits })
        .from(holdings)
        .where(eq(holdings.id, holdingId))
        .limit(1);
      const stored = rows.at(0)?.balanceMinorUnits;

      await tx.update(holdings).set(patch).where(eq(holdings.id, holdingId));

      if (patch.balanceMinorUnits === undefined || stored === undefined) {
        return;
      }

      const delta = patch.balanceMinorUnits - stored;

      if (delta === 0) {
        return;
      }

      await tx.insert(transactions).values({
        id: id(),
        holdingId,
        amountMinorUnits: delta,
        time,
        description: '',
        category: null,
        source: 'manual',
      });
    }),
  /**
   * Sets the holding's icon (an SF Symbol name) or, with `null`, clears it back
   * to no custom icon. The display layer falls back to a type-derived default
   * when the stored icon is null.
   */
  setIcon: (holdingId: string, icon: string | null) =>
    write((tx) => tx.update(holdings).set({ icon }).where(eq(holdings.id, holdingId))),
  /**
   * Sets the holding's color (an entity-color hex) or, with `null`, clears it
   * back to no custom color. The display layer falls back to a type-derived
   * default when the stored color is null — the same fallback the icon uses.
   * Mirrors `setIcon` so the detail header can edit the color exactly as the
   * create form does.
   */
  setColor: (holdingId: string, color: string | null) =>
    write((tx) => tx.update(holdings).set({ color }).where(eq(holdings.id, holdingId))),
  /**
   * Appends one contribution to a term deposit and rewrites its metadata in a
   * single transaction. Metadata is rebuilt cleanly from the parsed meta, so
   * any legacy `principalMinorUnits`/`startDate` keys are dropped rather than
   * carried forward. Contributions are kept sorted by date ascending.
   */
  appendDepositContribution: (holdingId: string, contribution: DepositContribution) =>
    write((tx) => appendDepositContributionTx(tx, holdingId, contribution)),
  /**
   * Deletes a manual holding and all of its transactions in one transaction.
   * Refuses a holding whose balance is owned by a LIVE sync, so a synced row is
   * left untouched. That ownership is read from the holding's ACCOUNT (its
   * `institution`, fetched inside the same transaction) as well as the
   * holding's own sync key — a disconnected account keeps its holdings' keys so
   * a reconnect re-adopts them, and those rows are deletable again.
   */
  remove: (holdingId: string) =>
    write(async (tx) => {
      const rows = await tx.select().from(holdings).where(eq(holdings.id, holdingId));
      const row = rows.at(0);
      if (!row) {
        return;
      }
      const accountRows = await tx
        .select({ institution: accounts.institution })
        .from(accounts)
        .where(eq(accounts.id, row.accountId));

      if (isSyncedHolding(row, accountRows.at(0))) {
        throw new Error('remove: cannot delete a synced holding');
      }
      await tx.delete(transactions).where(eq(transactions.holdingId, holdingId));
      await tx.delete(holdings).where(eq(holdings.id, holdingId));
    }),
  upsertMonobank: ({ monobankId, ...rest }: MonobankHolding) =>
    write((tx) =>
      upsertByMetadataKey(tx, { ...rest, metadataField: 'monobankId', metadataKey: monobankId }),
    ),
  /**
   * Balance-provider counterpart of `upsertMonobank`: one live balance snapshot
   * per provider, matched on `walletAddress` / `binanceAsset`. No transaction
   * import — a wallet or exchange gives a number, not a statement.
   */
  upsertExchange: (holding: ExchangeHolding) => write((tx) => upsertByMetadataKey(tx, holding)),
  /**
   * Persist a drag-and-drop reorder of one account's holdings grid.
   * `orderedIds` is the full new front-to-back order of that account's visible
   * holdings; each row's `sortOrder` is rewritten to its 0-based index in one
   * transaction so the `listByAccountQuery` ordering matches the grid the user
   * just arranged. Only the passed holdings are touched, so other accounts'
   * holdings are unaffected.
   */
  reorder: (orderedIds: string[]) =>
    write(async (tx) => {
      for (let index = 0; index < orderedIds.length; index += 1) {
        await tx
          .update(holdings)
          .set({ sortOrder: index })
          .where(eq(holdings.id, orderedIds[index]));
      }
    }),
} satisfies Repository;
