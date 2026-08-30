import { and, eq, sql } from 'drizzle-orm';
import { database, write } from '../db/client';
import { id } from '../db/id';
import { type HoldingRow, holdings } from '../db/schema';

type NewHolding = Pick<HoldingRow, 'accountId' | 'name' | 'type' | 'currency'> &
  Partial<Pick<HoldingRow, 'balanceMinorUnits' | 'metadata' | 'sortOrder'>>;

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
  create: (input: NewHolding) => write(tx => tx.insert(holdings).values({ id: id(), ...input })),
  setBalance: (holdingId: string, minorUnits: number) =>
    write(tx =>
      tx.update(holdings).set({ balanceMinorUnits: minorUnits }).where(eq(holdings.id, holdingId)),
    ),
  upsertMonobank: ({ monobankId, metadata, ...rest }: MonobankHolding) =>
    write(async tx => {
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
};
