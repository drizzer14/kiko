import {
  type FundingMatchRow,
  IN_CLAUSE_CHUNK_SIZE,
  type Repository,
  chunkForTable,
  chunkRows,
  database,
  fundingMatchRows,
} from '@kiko/db';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';

type DatabaseTransaction = typeof database;

/**
 * The stored set of the Funding ledger, on the table `funding_match_rows`: one row per ledger row
 * and per source, keyed by `(account_id, side, record_key)`. Every statement filters by
 * `account_id`, so it rides the primary key's leading column and never touches another account.
 * The three writes take the caller's transaction handle, because a reconcile writes its
 * difference and its prune in ONE `write(...)`, so a failure rolls both back.
 */
export const bybitFundingMatchRepo = {
  /** Every stored row of the account: the one read that rule 51 makes per reconcile. */
  readByAccount: (accountId: string): Promise<FundingMatchRow[]> =>
    database.select().from(fundingMatchRows).where(eq(fundingMatchRows.accountId, accountId)),
  /** Inserts each row, and rewrites every column of a row whose key is already stored. */
  upsertDatabaseTransaction: async (
    databaseTransaction: DatabaseTransaction,
    rows: FundingMatchRow[],
  ): Promise<void> => {
    for (const chunk of chunkForTable(fundingMatchRows, rows)) {
      await databaseTransaction
        .insert(fundingMatchRows)
        .values(chunk)
        .onConflictDoUpdate({
          target: [fundingMatchRows.accountId, fundingMatchRows.side, fundingMatchRows.recordKey],
          set: {
            series: sql`excluded.series`,
            coin: sql`excluded.coin`,
            direction: sql`excluded.direction`,
            amount: sql`excluded.amount`,
            fee: sql`excluded.fee`,
            tax: sql`excluded.tax`,
            timeStart: sql`excluded.time_start`,
            timeEnd: sql`excluded.time_end`,
            earnPrincipal: sql`excluded.earn_principal`,
          },
        });
    }
  },
  /** Deletes the rows of one side of the account that hold one of `recordKeys`. */
  removeDatabaseTransaction: async (
    databaseTransaction: DatabaseTransaction,
    accountId: string,
    side: FundingMatchRow['side'],
    recordKeys: string[],
  ): Promise<void> => {
    for (const chunk of chunkRows(recordKeys, IN_CLAUSE_CHUNK_SIZE)) {
      await databaseTransaction
        .delete(fundingMatchRows)
        .where(
          and(
            eq(fundingMatchRows.accountId, accountId),
            eq(fundingMatchRows.side, side),
            inArray(fundingMatchRows.recordKey, chunk),
          ),
        );
    }
  },
  /**
   * Deletes the rows of the account whose extent ENDS before `timeEnd`, on both sides: a row that
   * ends at `timeEnd` stays.
   */
  pruneDatabaseTransaction: async (
    databaseTransaction: DatabaseTransaction,
    accountId: string,
    timeEnd: number,
  ): Promise<void> => {
    await databaseTransaction
      .delete(fundingMatchRows)
      .where(and(eq(fundingMatchRows.accountId, accountId), lt(fundingMatchRows.timeEnd, timeEnd)));
  },
} satisfies Repository;
