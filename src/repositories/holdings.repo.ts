import { and, eq, sql } from 'drizzle-orm';
import { database, write } from '../db/client';
import { id } from '../db/id';
import { type HoldingRow, holdings, transactions } from '../db/schema';
import { isSyncedHolding } from '../holdings/deletable';
import { asTermDepositMeta, type DepositContribution } from '../holdings/holding-metadata';
import type { Repository } from './repository';

type NewHolding = Pick<HoldingRow, 'accountId' | 'name' | 'type' | 'currency'> &
  Partial<Pick<HoldingRow, 'balanceMinorUnits' | 'metadata' | 'sortOrder' | 'color'>>;

/**
 * A Monobank-sourced holding carries the Monobank account/jar id in its
 * metadata. Upserts match on `metadata->>'monobankId'` so a re-synced
 * bank account updates its balance in place instead of duplicating.
 */
type MonobankHolding = NewHolding & { monobankId: string };

export const holdingsRepo = {
  allQuery: () => database.select().from(holdings),
  listByAccountQuery: (accountId: string) =>
    database.select().from(holdings).where(eq(holdings.accountId, accountId)),
  /**
   * Insert a new holding and resolve to its generated app id (the text UUID),
   * so a caller can immediately act on the new row (e.g. set its icon). The
   * op-sqlite insert result (rowsAffected/lastInsertRowId) is the SQLite rowid,
   * not this id, so it is not returned.
   */
  create: (input: NewHolding): Promise<string> =>
    write(async (tx) => {
      const holdingId = id();
      await tx.insert(holdings).values({ id: holdingId, ...input });
      return holdingId;
    }),
  setBalance: (holdingId: string, minorUnits: number) =>
    write((tx) =>
      tx.update(holdings).set({ balanceMinorUnits: minorUnits }).where(eq(holdings.id, holdingId)),
    ),
  updateName: (holdingId: string, name: string) =>
    write((tx) => tx.update(holdings).set({ name }).where(eq(holdings.id, holdingId))),
  /**
   * Sets the holding's icon (an SF Symbol name) or, with `null`, clears it back
   * to no custom icon. The display layer falls back to a type-derived default
   * when the stored icon is null.
   */
  setIcon: (holdingId: string, icon: string | null) =>
    write((tx) => tx.update(holdings).set({ icon }).where(eq(holdings.id, holdingId))),
  /**
   * Appends one contribution to a term deposit and rewrites its metadata in a
   * single transaction. Metadata is rebuilt cleanly from the parsed meta, so
   * any legacy `principalMinorUnits`/`startDate` keys are dropped rather than
   * carried forward. Contributions are kept sorted by date ascending.
   */
  appendDepositContribution: (holdingId: string, contribution: DepositContribution) =>
    write(async (tx) => {
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
    }),
  /**
   * Deletes a manual holding and all of its transactions in one transaction.
   * Refuses a Monobank-synced holding (its balance is owned by the sync), so a
   * synced row is left untouched.
   */
  remove: (holdingId: string) =>
    write(async (tx) => {
      const rows = await tx.select().from(holdings).where(eq(holdings.id, holdingId));
      const row = rows.at(0);
      if (!row) {
        return;
      }
      if (isSyncedHolding(row)) {
        throw new Error('remove: cannot delete a synced holding');
      }
      await tx.delete(transactions).where(eq(transactions.holdingId, holdingId));
      await tx.delete(holdings).where(eq(holdings.id, holdingId));
    }),
  upsertMonobank: ({ monobankId, metadata, ...rest }: MonobankHolding) =>
    write(async (tx) => {
      const merged = { ...(metadata as Record<string, unknown> | null), monobankId };
      const monobankMatch = sql`json_extract(${holdings.metadata}, '$.monobankId') = ${monobankId}`;
      const existing = await tx
        .select({ id: holdings.id })
        .from(holdings)
        .where(and(eq(holdings.accountId, rest.accountId), monobankMatch))
        .limit(1);
      const current = existing.at(0);
      if (current) {
        await tx
          .update(holdings)
          .set({ balanceMinorUnits: rest.balanceMinorUnits ?? 0, metadata: merged })
          .where(eq(holdings.id, current.id));
        return;
      }
      await tx.insert(holdings).values({ id: id(), ...rest, metadata: merged });
    }),
} satisfies Repository;
