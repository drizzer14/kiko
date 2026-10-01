import {
  type Repository,
  accounts,
  categoryOverrides,
  type HoldingRow,
  holdings,
  type TransactionRow,
  transactions,
  id,
  database,
  write,
  chunkForTable,
  chunkRows,
} from '@kiko/db';
import {
  type SQL,
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  sql,
} from 'drizzle-orm';
import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import type { Currency } from '@kiko/currency/currency';
import type { ClosingBalance } from '@kiko/statement-import/parser';
import { exchangeReceivePath } from '@kiko/holdings/exchange-destination';
import type { DepositContribution } from '@kiko/holdings/holding-metadata';
import type { ExchangeConvertDirection } from '@kiko/holdings/exchange-convert';
import { appendDepositContributionDatabaseTransaction } from '@kiko/holdings/repo';
import { isSyncedAccount, isSyncedHolding, isSyncedTransaction } from '@kiko/holdings/deletable';

import { normalizeTransactionName } from '../normalize-name';

type NewTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time' | 'source'> &
  Partial<
    Pick<
      TransactionRow,
      'description' | 'category' | 'mcc' | 'hold' | 'counterIban' | 'comment' | 'externalId'
    >
  >;

type ManualTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time'> &
  Partial<
    Pick<
      TransactionRow,
      'description' | 'category' | 'exchangeCounterpartHoldingId' | 'changeGroupId'
    >
  >;

type TransactionEdit = Pick<TransactionRow, 'amountMinorUnits' | 'time'> &
  Partial<Pick<TransactionRow, 'description'>> & { transactionId: string };

// No holding NAMES here: neither leg persists a description anymore, so the
// only thing each leg needs about the other is its ID — the marker the display
// layer resolves the current name from (see transactions/exchange-description.ts).
type ExchangeInput = {
  sourceHoldingId: string;
  valueOutMinorUnits: number;
  destinationHoldingId: string;
  destinationType: HoldingRow['type'];
  valueInMinorUnits: number;
  time: number;
};

type ExchangeCounterpartInput = {
  direction: ExchangeConvertDirection;
  counterpartHoldingId: string;
  counterpartType: HoldingRow['type'];
  amountMinorUnits: number;
  // The EXISTING row itself: its id, so the same transaction can mark that row
  // as the other leg of this movement, and its holding id, which becomes the
  // NEW leg's exchange marker. The existing holding's NAME is not needed — the
  // label is resolved at render time from the id.
  existingTransactionId: string;
  existingHoldingId: string;
  time: number;
};

// One change-return of a split payment: a POSITIVE amount on a holding OTHER
// than the payer. `recordManualWithReturns` writes each as its own manual row,
// tied to the payment by a shared `changeGroupId`.
type ChangeReturn = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits'>;

type ManualWithReturnsInput = {
  // The full payment (amount < 0), carrying its category, on the paying holding.
  payment: ManualTransaction;
  // Each return (amount > 0) on a DIFFERENT holding, in the payment's currency.
  returns: ChangeReturn[];
};

/** The LATER of two nullable instants, treating `null` as "no boundary from
 * this source" rather than as an actual instant to compare — used to combine
 * the two boundary sources (`holding.balanceSetAt`, the newest sync-source
 * transaction) without a nested ternary. */
const laterOf = (a: number | null, b: number | null): number | null => {
  if (a === null) {
    return b;
  }

  if (b === null) {
    return a;
  }

  return Math.max(a, b);
};

/** A holding's rows from a SYNC source — boundary source (b) of THE BOUNDARY
 * in `importRows`'s doc comment. `holdingId` is a value, or `holdings.id` for
 * a subquery correlated to the outer holding row. */
const syncSourceRowsOf = (holdingId: string | typeof holdings.id) =>
  and(
    eq(transactions.holdingId, holdingId),
    ne(transactions.source, 'manual'),
    ne(transactions.source, 'import'),
  );

/** Whether a row dated `time` moves the stored balance. A row dated before the
 * boundary is history: the balance set at the boundary already counts it. */
const movesBalance = (time: number, boundary: number | null): boolean =>
  boundary === null || time >= boundary;

const balanceShareOf = (amountMinorUnits: number, time: number, boundary: number | null): number =>
  movesBalance(time, boundary) ? amountMinorUnits : 0;

const newestSyncTimeOfHolding = sql<number | null>`(
  SELECT max(${transactions.time}) FROM ${transactions} WHERE ${syncSourceRowsOf(holdings.id)}
)`;

/**
 * Move a holding's stored balance by `deltaFor(boundary)`, where `boundary` is
 * THE BOUNDARY `importRows` uses. The balance and the boundary are read inside
 * the caller's transaction, never from a render snapshot, so a concurrent
 * write cannot be clobbered by a stale read-modify-write, and a manual write
 * judges its row against the same boundary an import does.
 */
const moveBalanceDatabaseTransaction = async (
  databaseTransaction: typeof database,
  holdingId: string,
  deltaFor: (boundary: number | null) => number,
): Promise<void> => {
  const anchorRows = await databaseTransaction
    .select({
      balanceMinorUnits: holdings.balanceMinorUnits,
      balanceSetAt: holdings.balanceSetAt,
      newestSyncTime: newestSyncTimeOfHolding,
    })
    .from(holdings)
    .where(eq(holdings.id, holdingId))
    .limit(1);
  const anchor = anchorRows.at(0);

  if (anchor === undefined) {
    return;
  }

  const delta = deltaFor(laterOf(anchor.balanceSetAt, anchor.newestSyncTime));

  if (delta === 0) {
    return;
  }

  await databaseTransaction
    .update(holdings)
    .set({ balanceMinorUnits: anchor.balanceMinorUnits + delta })
    .where(eq(holdings.id, holdingId));
};

// Insert a manual transaction and adjust its holding's balance on an EXISTING
// transaction handle (see `moveBalanceDatabaseTransaction` for which rows move
// it). `recordManual` wraps this in its own `write(...)`; `recordExchange`
// calls it directly for the source leg and for a plain destination leg,
// keeping both legs in one transaction.
//
// The row carries its OWN category here — a picked category is never lost to
// a blank description or a cancelled override sheet. `upsertCategoryOverride`
// (category-overrides.repo.ts) governs a SEPARATE concern: propagating that
// pick to every OTHER same-name row, not whether this row itself is
// categorised.
const recordManualTransaction = async (
  databaseTransaction: typeof database,
  {
    holdingId,
    amountMinorUnits,
    time,
    description,
    category,
    exchangeCounterpartHoldingId,
    changeGroupId,
  }: ManualTransaction,
): Promise<void> => {
  await databaseTransaction.insert(transactions).values({
    id: id(),
    holdingId,
    amountMinorUnits,
    time,
    description: description ?? '',
    category: category ?? null,
    exchangeCounterpartHoldingId: exchangeCounterpartHoldingId ?? null,
    changeGroupId: changeGroupId ?? null,
    source: 'manual',
  });

  await moveBalanceDatabaseTransaction(databaseTransaction, holdingId, (boundary) =>
    balanceShareOf(amountMinorUnits, time, boundary),
  );
};

// Mark the EXISTING row of a Convert as the other leg of the same movement, on
// an EXISTING transaction handle so it commits with the new leg or not at all.
// The existing row is half of one money movement, so leaving it unmarked would
// keep the original expense in the spending pie — exactly the leak the marker
// exists to close, and one no other rule can catch across two currencies.
// `source` is read INSIDE the transaction, never from a render snapshot: a
// bank-owned (synced) row is never mutated by this app and stays unmarked (see
// the residual documented on `transactions.exchangeCounterpartHoldingId` in
// `db/schema.ts`).
const markExistingLegTransaction = async (
  databaseTransaction: typeof database,
  { existingTransactionId, counterpartHoldingId }: ExchangeCounterpartInput,
): Promise<void> => {
  const existingRows = await databaseTransaction
    .select({ source: transactions.source })
    .from(transactions)
    .where(eq(transactions.id, existingTransactionId))
    .limit(1);

  if (existingRows.at(0)?.source !== 'manual') {
    return;
  }

  await databaseTransaction
    .update(transactions)
    .set({ exchangeCounterpartHoldingId: counterpartHoldingId })
    .where(eq(transactions.id, existingTransactionId));
};

/**
 * A row's key in the `(source, external_id)` unique index, or `null` when it has
 * no external id — SQLite treats every NULL in a unique index as distinct, so
 * such a row (a manual one) never conflicts with anything.
 */
const conflictKeyOf = (input: NewTransaction): string | null => {
  return input.externalId ? `${input.source}:${input.externalId}` : null;
};

/**
 * Fold a batch onto one row per conflict key, keeping the LAST copy. SQLite
 * refuses to let a single statement upsert the same conflict target twice, which
 * two overlapping statement pages carrying one id would otherwise trigger; and
 * the later copy is the more settled one anyway. Rows with no external id are
 * all kept.
 */
const dedupByConflictKey = (inputs: NewTransaction[]): NewTransaction[] => {
  const lastIndexByKey = new Map<string, number>();

  inputs.forEach((input, index) => {
    const key = conflictKeyOf(input);

    if (key !== null) {
      lastIndexByKey.set(key, index);
    }
  });

  return inputs.filter((input, index) => {
    const key = conflictKeyOf(input);

    return key === null || lastIndexByKey.get(key) === index;
  });
};

// A one-column `inArray(...)` predicate binds one parameter per item — the
// same SQLITE_MAX_VARIABLE_NUMBER (32766) ceiling `chunkForTable`
// (`src/db/chunk-for-table.ts`) guards the multi-column insert below
// against, chunked directly at its own safe margin rather than derived from
// a table's column count, which a plain scalar list has none of.
const IN_CLAUSE_CHUNK_SIZE = 32_000;

/** Every stored row whose `conflictKeyOf` value is among `inputs`, read by
 * `readChunk` (one call per chunk) inside the caller's own transaction. */
const readStoredConflictRows = async <Row>(
  inputs: Pick<NewTransaction, 'source' | 'externalId'>[],
  readChunk: (where: SQL | undefined) => Promise<Row[]>,
): Promise<Row[]> => {
  const externalIds = inputs
    .map((input) => input.externalId)
    .filter((externalId): externalId is string => Boolean(externalId));

  if (externalIds.length === 0) {
    return [];
  }

  const sources = Array.from(
    new Set(inputs.filter((input) => Boolean(input.externalId)).map((input) => input.source)),
  );
  const stored: Row[] = [];

  // BOTH halves of the unique key are constrained, so SQLite SEARCHes
  // `transactions_source_external` on its leading `source` column; an
  // `external_id`-only predicate cannot use that index and SCANs it instead
  // (verified with EXPLAIN QUERY PLAN). Chunked over `externalIds` (a large
  // sync or statement import can carry tens of thousands) — see
  // `IN_CLAUSE_CHUNK_SIZE` above.
  for (const externalIdChunk of chunkRows(externalIds, IN_CLAUSE_CHUNK_SIZE)) {
    stored.push(
      ...(await readChunk(
        and(
          inArray(transactions.source, sources),
          inArray(transactions.externalId, externalIdChunk),
        ),
      )),
    );
  }

  return stored;
};

/** Every `conflictKeyOf` value among `inputs` that a stored row already
 * holds, read inside the caller's own transaction. */
const readStoredConflictKeys = async (
  databaseTransaction: typeof database,
  inputs: Pick<NewTransaction, 'source' | 'externalId'>[],
): Promise<Set<string>> => {
  const stored = await readStoredConflictRows(inputs, (where) =>
    databaseTransaction
      .select({ source: transactions.source, externalId: transactions.externalId })
      .from(transactions)
      .where(where),
  );

  return new Set(stored.map((row) => `${row.source}:${row.externalId}`));
};

/**
 * The subset of these rows the upsert will INSERT rather than refresh. Read
 * inside the caller's own transaction, so the result can never disagree with
 * the write it describes. `addManyDedup` uses only its `.length`; the
 * statement-import balance write (`importRows` below) additionally needs the
 * actual rows, to sum their `amountMinorUnits` — a refreshed (already
 * imported) row must contribute 0 to that sum, not just be excluded from the
 * count.
 */
const partitionNewRows = async (
  databaseTransaction: typeof database,
  inputs: NewTransaction[],
): Promise<NewTransaction[]> => {
  const known = await readStoredConflictKeys(databaseTransaction, inputs);

  return inputs.filter((input) => {
    const key = conflictKeyOf(input);

    return key === null || !known.has(key);
  });
};

/** A statement-import row, plus the older key the ledger may already hold
 * the same row under (`noonAliasDedupKey` in statement-import's mapping). */
type ImportRow = NewTransaction & { aliasExternalId?: string };

/** A row the ledger already holds under its alias: its real `time`, and the
 * time and amount the ledger stores it with. */
type AliasedRow = { time: number; storedTime: number; amountMinorUnits: number };

/**
 * `rows` without every row the ledger already holds under its
 * `aliasExternalId`: that stored row IS this row, so it is neither inserted
 * nor counted toward the balance, and it keeps its own stored time and key.
 * `aliased` lists those stored rows.
 */
const dropRowsStoredUnderAlias = async (
  databaseTransaction: typeof database,
  rows: ImportRow[],
): Promise<{ rows: NewTransaction[]; aliased: AliasedRow[] }> => {
  const aliases = rows.flatMap(({ source, aliasExternalId }) =>
    aliasExternalId ? [{ source, externalId: aliasExternalId }] : [],
  );
  const stored = await readStoredConflictRows(aliases, (where) =>
    databaseTransaction
      .select({
        source: transactions.source,
        externalId: transactions.externalId,
        time: transactions.time,
        amountMinorUnits: transactions.amountMinorUnits,
      })
      .from(transactions)
      .where(where),
  );
  const storedByKey = new Map(stored.map((row) => [`${row.source}:${row.externalId}`, row]));
  const storedFor = ({ source, aliasExternalId }: ImportRow) =>
    storedByKey.get(`${source}:${aliasExternalId}`);

  return {
    rows: rows
      .filter((row) => storedFor(row) === undefined)
      .map(({ aliasExternalId: _storedAlias, ...row }) => row),
    aliased: rows.flatMap(
      (row) =>
        foldMap(maybe(storedFor(row)), (storedRow) => [
          {
            time: row.time,
            storedTime: storedRow.time,
            amountMinorUnits: storedRow.amountMinorUnits,
          },
        ]) ?? [],
    ),
  };
};

/** The net of the `aliased` rows the post-closing read counted by their
 * stored time although their real time is at or before the closing as-of. */
const aliasedNetBeforeClosing = (aliased: AliasedRow[], asOfMilliseconds: number): number =>
  aliased
    .filter(({ time, storedTime }) => storedTime > asOfMilliseconds && time <= asOfMilliseconds)
    .reduce((sum, row) => sum + row.amountMinorUnits, 0);

// Every bank-owned column `insertDedupRowsDatabaseTransaction`'s upsert
// refreshes on conflict — ONE list. `bankOwnedTransactionSet` (which column
// to overwrite, and with what) and `bankOwnedTransactionSetWhere` (skip the
// whole write when nothing here actually changed) are both derived from it,
// so adding a column to one can never forget to add it to the other;
// `excluded.<db column>` is read off each column's own `.name`, not
// hand-typed a second time. `key` is constrained below to `keyof typeof
// transactions.$inferInsert`, so a typo'd key fails to compile instead of
// silently dropping that column from the upsert `set`.
const BANK_OWNED_TRANSACTION_COLUMNS = [
  { key: 'amountMinorUnits', column: transactions.amountMinorUnits },
  { key: 'description', column: transactions.description },
  { key: 'hold', column: transactions.hold },
  { key: 'mcc', column: transactions.mcc },
  { key: 'counterIban', column: transactions.counterIban },
  { key: 'time', column: transactions.time },
] as const satisfies ReadonlyArray<{
  key: keyof typeof transactions.$inferInsert;
  column: unknown;
}>;

export const bankOwnedTransactionSet = Object.fromEntries(
  BANK_OWNED_TRANSACTION_COLUMNS.map(({ key, column }) => [
    key,
    sql.raw(`excluded.${column.name}`),
  ]),
);

// `IS NOT` (not `!=`), since a bank-owned column can be NULL
// (`mcc`/`counterIban`/`hold`) and SQL's `!=` against NULL is never true —
// it would silently skip a genuine NULL-to-value change.
export const bankOwnedTransactionSetWhere = sql.join(
  BANK_OWNED_TRANSACTION_COLUMNS.map(
    ({ column }) => sql`${column} IS NOT ${sql.raw(`excluded.${column.name}`)}`,
  ),
  sql` OR `,
);

// The WHERE clause for `importRows`'s existing-rows-after-asOf read, exported
// so a real-SQLite test can prove the exact predicate — both the `holdingId`
// scope and the STRICT `gt` boundary (a row exactly AT `asOfMilliseconds`
// belongs to the closing balance itself, not after it) — rather than a
// hand-transcribed copy of it.
export const postClosingRowsWhere = (holdingId: string, asOfMilliseconds: number) =>
  and(eq(transactions.holdingId, holdingId), gt(transactions.time, asOfMilliseconds));

/**
 * Apply name->category override rules and upsert a batch of imported rows on
 * the `(source, external_id)` unique index — the shared core `addManyDedup`
 * and `importRows` (statement import's balance-write path, below) both run
 * inside their own `write(...)` transaction. Returns the rows that were
 * genuinely NEW — a refreshed (already-imported) row is excluded; a caller
 * that only needs the count uses `.length`.
 */
const insertDedupRowsDatabaseTransaction = async (
  databaseTransaction: typeof database,
  inputs: NewTransaction[],
): Promise<NewTransaction[]> => {
  if (inputs.length === 0) {
    return [];
  }

  const batch = dedupByConflictKey(inputs);
  // Apply name→category override rules at insert time. Normalize each
  // incoming description in JS (never SQL) and look the rules up by exact
  // equality on the already-normalized key. Chunked over `keys` (a large
  // import can carry tens of thousands of distinct descriptions) — see
  // `IN_CLAUSE_CHUNK_SIZE` above.
  const keys = Array.from(
    new Set(batch.map((input) => normalizeTransactionName(input.description ?? ''))),
  ).filter((key) => key !== '');
  const rules: { normalizedName: string; category: string }[] = [];

  for (const keyChunk of chunkRows(keys, IN_CLAUSE_CHUNK_SIZE)) {
    rules.push(
      ...(await databaseTransaction
        .select()
        .from(categoryOverrides)
        .where(inArray(categoryOverrides.normalizedName, keyChunk))),
    );
  }
  const categoryByName = new Map(rules.map((rule) => [rule.normalizedName, rule.category]));
  const withOverrides = batch.map((input) => {
    const override = categoryByName.get(normalizeTransactionName(input.description ?? ''));

    return override ? { ...input, category: override } : input;
  });
  const newRows = await partitionNewRows(databaseTransaction, batch);
  // Upsert on the `(source, external_id)` unique index: a re-fetched
  // Monobank item is REFRESHED, not dropped. A `hold: true` authorization
  // imports at its PROVISIONAL amount and re-syncs at the settled one, which
  // `onConflictDoNothing` silently discarded — freezing the wrong amount
  // forever. `excluded` is SQLite's alias for the row that would have been
  // inserted.
  //
  // The update set names only the BANK-owned columns. `category` (which may
  // be the user's own override, or a name rule's rewrite) and `comment` (the
  // user's note) are deliberately absent, as is every structural column
  // (`id`, `holding_id`, `exchange_counterpart_holding_id`).
  //
  // Manual rows are untouched either way: they carry a null `external_id`,
  // and SQLite treats each NULL in a unique index as distinct, so two of
  // them never conflict.
  //
  // Chunked per `chunkForTable`: a single unchunked insert bound one
  // parameter per PRESENT key per row and SQLite
  // rejects a statement over its 32766 bound-parameter ceiling — a whole
  // statement-import file failed past ~2980 rows, a Monobank sync past
  // ~2731. `dedupByConflictKey` already collapsed `withOverrides` to at
  // most one row per `(source, external_id)` key BEFORE this split, so no
  // two chunks can ever target the same conflict key — each chunk's
  // ON CONFLICT resolves independently, with identical semantics to the
  // old single-statement insert.
  const rows = withOverrides.map((input) => ({ id: id(), ...input }));

  for (const part of chunkForTable(transactions, rows)) {
    await databaseTransaction
      .insert(transactions)
      .values(part)
      .onConflictDoUpdate({
        target: [transactions.source, transactions.externalId],
        set: bankOwnedTransactionSet,
        setWhere: bankOwnedTransactionSetWhere,
      });
  }

  return newRows;
};

type ImportBalanceDecision = {
  nextBalance: number;
  balanceSetAt?: number;
};

/** `importRows`'s pure balance decision, pulled out of the write closure to
 * stay under Biome's cognitive-complexity cap — see that function's own doc
 * comment for the full rule this implements. `balanceSetAt` is present only
 * when a closing balance actually applied this call; the caller writes it to
 * `holdings` alongside `nextBalance`. `existingPostClosingNetMinorUnits` is
 * the net of every row ALREADY in the ledger (any source) dated after the
 * closing balance's own as-of, read before this import inserted anything —
 * an already-imported holding's later rows must not be erased by an older
 * statement's own closing figure. */
const resolveImportBalance = (
  holding: Pick<HoldingRow, 'balanceMinorUnits' | 'currency'>,
  boundary: number | null,
  newRows: NewTransaction[],
  closingBalance: ClosingBalance | undefined,
  existingPostClosingNetMinorUnits: number,
): ImportBalanceDecision => {
  const netDelta = newRows.reduce(
    (sum, row) => sum + balanceShareOf(row.amountMinorUnits, row.time, boundary),
    0,
  );
  const useClosingBalance =
    closingBalance !== undefined &&
    closingBalance.currency === holding.currency &&
    movesBalance(closingBalance.asOfSeconds * 1000, boundary);

  if (!useClosingBalance) {
    return { nextBalance: holding.balanceMinorUnits + netDelta };
  }

  const postClosingNet =
    newRows
      .filter((row) => row.time > closingBalance.asOfSeconds * 1000)
      .reduce((sum, row) => sum + row.amountMinorUnits, 0) + existingPostClosingNetMinorUnits;

  return {
    nextBalance: closingBalance.minorUnits + postClosingNet,
    balanceSetAt: closingBalance.asOfSeconds * 1000,
  };
};

export const transactionsRepo = {
  listByHoldingQuery: (holdingId: string) =>
    database.select().from(transactions).where(eq(transactions.holdingId, holdingId)),
  // Every transaction row, newest first, carrying its `holdingId` — the
  // Statistics line chart groups the whole ledger by holding to reconstruct
  // each holding's balance over time, which `listAllWithContextQuery` (a
  // display projection without `holdingId`) cannot feed.
  listAllQuery: () => database.select().from(transactions).orderBy(desc(transactions.time)),
  getByIdQuery: (transactionId: string) =>
    database.select().from(transactions).where(eq(transactions.id, transactionId)).limit(1),
  /**
   * The newest imported time for a holding's rows of one sync `source` (a single
   * `{ time }` row, or none). The crypto-sync transaction import reads this as an
   * incremental cursor: the next Binance fetch starts from just before this time
   * rather than re-walking the full history every sync.
   */
  latestSyncedTimeQuery: (holdingId: string, source: TransactionRow['source']) =>
    database
      .select({ time: transactions.time })
      .from(transactions)
      .where(and(eq(transactions.holdingId, holdingId), eq(transactions.source, source)))
      .orderBy(desc(transactions.time))
      .limit(1),
  /**
   * The DISTINCT holding ids that still carry an outstanding Monobank hold (a
   * pending authorization: `source = 'monobank'` AND `hold = true`). The sync
   * fetches these cards even when their /client-info balance is unchanged,
   * because a same-amount hold→settled refresh does not move the balance — so
   * the balance-diff skip would otherwise never re-fetch the settled amount.
   * `eq(transactions.hold, true)` compiles to `= 1` on the boolean-mode column,
   * excluding NULL/false rows.
   */
  holdingIdsWithHoldQuery: () =>
    database
      .selectDistinct({ holdingId: transactions.holdingId })
      .from(transactions)
      .where(and(eq(transactions.source, 'monobank'), eq(transactions.hold, true))),
  /**
   * The loan-payment matcher's own candidate read
   * (`src/loans/payment-matcher/`): every debit, not already linked, not
   * previously rejected (a manual "None" or Undo must stick), and not one leg
   * of an Exchange/Convert (the structural `exchangeCounterpartHoldingId`
   * marker, same check `exchange-exclusion.ts` makes) — filtered here in SQL,
   * not in JS, so the matcher never even reads a row it can never link
   * (P-NOWORK). Joined against the PAYER holding's own currency, which the
   * matcher compares against each loan's own currency itself (this query
   * makes no currency decision of its own).
   *
   * op-sqlite is a single-worker read queue every other app-open read
   * shares, so a plain, unbounded scan of every eligible debit ever
   * recorded would grow with the WHOLE ledger, not with what the matcher
   * could ever possibly use — bounded to `time >= minTime` (the caller
   * passes each loan's own earliest `startDate` minus the match window's own
   * before-margin, so no installment's candidate window is ever excluded)
   * and to `currencies` (only a loan's own currency can ever match rule 1,
   * the matcher's own per-pair check makes no currency decision of its own
   * either way — this is a P-NOWORK narrowing, not a correctness change).
   */
  loanMatchCandidatesQuery: (params: { minTime: number; currencies: readonly Currency[] }) =>
    database
      .select({
        id: transactions.id,
        holdingId: transactions.holdingId,
        currency: holdings.currency,
        amountMinorUnits: transactions.amountMinorUnits,
        time: transactions.time,
        description: transactions.description,
        counterIban: transactions.counterIban,
      })
      .from(transactions)
      .innerJoin(holdings, eq(transactions.holdingId, holdings.id))
      .where(
        and(
          lt(transactions.amountMinorUnits, 0),
          isNull(transactions.loanHoldingId),
          eq(transactions.loanLinkRejected, false),
          isNull(transactions.exchangeCounterpartHoldingId),
          gte(transactions.time, params.minTime),
          inArray(holdings.currency, [...params.currencies]),
        ),
      ),
  /**
   * Every transaction already linked (manual or auto alike) to one of these
   * loan holdings — the matcher's own "taken installment" input
   * (`LinkedLoanPayment`, `src/loans/payment-matcher/`): a link already
   * proven against rules 1+2 must keep its installment from being handed to
   * a DIFFERENT, later transaction on a following run —
   * `loanMatchCandidatesQuery` above itself excludes an already-linked row,
   * so without this separate read the matcher would never see it at all).
   */
  loanLinkedPaymentsQuery: (loanHoldingIds: readonly string[]) =>
    database
      .select({
        loanHoldingId: transactions.loanHoldingId,
        amountMinorUnits: transactions.amountMinorUnits,
        time: transactions.time,
      })
      .from(transactions)
      .where(inArray(transactions.loanHoldingId, [...loanHoldingIds])),
  /**
   * Every linked loan payment across EVERY loan, in one read, with the
   * PAYER holding's currency — the price book's loan-payment input
   * (`usePriceBook`, `src/prices/`), which every valuation site reads a
   * loan's outstanding from. One query for all loans, never one per
   * holding: op-sqlite serves the whole app from one worker thread
   * (kiko-architecture). The currency lets the loan ledger count only a
   * payment in the loan's own currency, the same rule the spending pie's
   * loan-payment exclusion applies.
   */
  loanLedgerPaymentsQuery: () =>
    database
      .select({
        loanHoldingId: transactions.loanHoldingId,
        time: transactions.time,
        amountMinorUnits: transactions.amountMinorUnits,
        currency: holdings.currency,
      })
      .from(transactions)
      .innerJoin(holdings, eq(transactions.holdingId, holdings.id))
      .where(isNotNull(transactions.loanHoldingId)),
  /**
   * Every transaction linked (manual or auto) to one loan holding, newest
   * first — the loan holding-detail screen's own "Linked payments" section:
   * the loan itself is ledgerless (`isLedgerlessHoldingType`), so
   * its own `listByHoldingQuery` would read nothing; a payment always lives
   * on the PAYER holding instead, found only by this marker.
   */
  listLinkedToLoanQuery: (loanHoldingId: string) =>
    database
      .select()
      .from(transactions)
      .where(eq(transactions.loanHoldingId, loanHoldingId))
      .orderBy(desc(transactions.time)),
  listAllWithContextQuery: () =>
    database
      .select({
        id: transactions.id,
        amountMinorUnits: transactions.amountMinorUnits,
        currency: holdings.currency,
        time: transactions.time,
        description: transactions.description,
        // The exchange marker travels with the display projection: Home reads
        // it to resolve an exchange leg's label, and Statistics reads it to
        // drop both legs from the spending pie.
        exchangeCounterpartHoldingId: transactions.exchangeCounterpartHoldingId,
        // The split-change group id travels too: the spending pie nets a
        // payment's linked returns into its category (statistics/category-breakdown).
        changeGroupId: transactions.changeGroupId,
        // Home reads the source to tell a synced (Monobank/crypto) row from a
        // manual one (`isSyncedTransaction`), gating its long-press delete —
        // only a manual row is deletable.
        source: transactions.source,
        category: transactions.category,
        accountId: accounts.id,
        accountName: accounts.name,
        holdingName: holdings.name,
        // Home reads the holding type to drop the HH:MM stamp on a
        // term_deposit/bond row (those are day-granular events).
        holdingType: holdings.type,
        // The loan-link marker travels too: Home shows a small glyph on any
        // row still carrying a link, regardless of `loanLinkSource` ('auto'
        // or 'manual' read the same marker).
        loanHoldingId: transactions.loanHoldingId,
      })
      .from(transactions)
      .innerJoin(holdings, eq(transactions.holdingId, holdings.id))
      .innerJoin(accounts, eq(holdings.accountId, accounts.id))
      .orderBy(desc(transactions.time)),
  /**
   * The DISTINCT, non-empty descriptions of the user's own MANUAL rows, newest
   * first — the source of the create-form's inline description suggestions.
   * The `source = 'manual'` filter EXCLUDES synced/bank descriptions (a Monobank
   * merchant name is not a manual entry the user re-types), and `<> ''` drops the
   * blank rows (a description-less exchange leg, a blank manual entry). Ordering
   * by `time` desc makes the ranking RECENCY, not frequency — the most recently
   * used names bubble up. The final capping and the fuzzy, case-insensitive
   * match against what the user is typing happen in JS (`normalizeTransactionName`),
   * never in SQL, since SQLite's `lower()` is ASCII-only.
   */
  distinctDescriptionsQuery: () =>
    database
      .selectDistinct({ description: transactions.description })
      .from(transactions)
      .where(and(eq(transactions.source, 'manual'), ne(transactions.description, '')))
      .orderBy(desc(transactions.time)),
  /**
   * The holding id of the user's MOST RECENT manual transaction (a single
   * `{ holdingId }` row, or none) — the default primary leg for the global
   * add-transaction entry (Bundle B). `source = 'manual'` excludes bank/crypto
   * imports (a synced holding is never a manual-create target), `time` desc
   * makes it the newest, and `limit 1` takes just that one. The form seeds its
   * primary-holding seam from this once, falling back to the first eligible
   * holding when the user has no manual history yet.
   */
  latestManualHoldingQuery: () =>
    database
      .select({ holdingId: transactions.holdingId })
      .from(transactions)
      .where(eq(transactions.source, 'manual'))
      .orderBy(desc(transactions.time))
      .limit(1),
  add: (input: NewTransaction) =>
    write((databaseTransaction) =>
      databaseTransaction.insert(transactions).values({ id: id(), ...input }),
    ),
  /**
   * Record a manual transaction and adjust its holding's balance in ONE
   * op-sqlite transaction, so the ledger and the balance can never desync
   * on a partial failure. A row dated before THE BOUNDARY (`importRows`)
   * is history and leaves the balance as it is (`moveBalanceDatabaseTransaction`).
   */
  recordManual: (input: ManualTransaction) =>
    write((databaseTransaction) => recordManualTransaction(databaseTransaction, input)),
  /**
   * Record an Exchange as two INDEPENDENT ledger rows in ONE transaction, tied
   * by the structural `exchangeCounterpartHoldingId` marker — each leg stores
   * the OTHER leg's holding id, and neither persists a description. The source
   * leg subtracts Value Out (in the
   * source's currency); the destination leg dispatches by type — a plain
   * transaction (+Value In) for cash/card/crypto_asset, or a deposit
   * contribution for a term_deposit. bond/jar are not valid destinations and
   * throw. Any failure rolls back BOTH legs, so the ledger and both balances
   * can never desync. Balances are read INSIDE the transaction, never from a
   * render snapshot, exactly as `recordManual` does.
   */
  recordExchange: (input: ExchangeInput) =>
    write(async (databaseTransaction) => {
      if (input.destinationHoldingId === input.sourceHoldingId) {
        throw new Error('recordExchange: destination equals source');
      }

      await recordManualTransaction(databaseTransaction, {
        holdingId: input.sourceHoldingId,
        amountMinorUnits: -input.valueOutMinorUnits,
        time: input.time,
        // No description is persisted: the label is resolved at render time
        // from this marker + the counterpart's CURRENT name via `t` (see
        // transactions/exchange-description.ts). A persisted
        // `Exchange to <name>` string was English forever and went stale on a
        // rename.
        exchangeCounterpartHoldingId: input.destinationHoldingId,
      });

      await match(exchangeReceivePath(input.destinationType))
        .with('plain', () =>
          recordManualTransaction(databaseTransaction, {
            holdingId: input.destinationHoldingId,
            amountMinorUnits: input.valueInMinorUnits,
            time: input.time,
            exchangeCounterpartHoldingId: input.sourceHoldingId,
          }),
        )
        .with('contribution', () => {
          const contribution: DepositContribution = {
            amountMinorUnits: input.valueInMinorUnits,
            date: input.time,
          };

          return appendDepositContributionDatabaseTransaction(
            databaseTransaction,
            input.destinationHoldingId,
            contribution,
          );
        })
        .with('excluded', () => {
          throw new Error(`recordExchange: ${input.destinationType} is not a valid destination`);
        })
        .exhaustive();
    }),
  /**
   * Convert-mode (spec "Convert an existing transaction"): record the ONE
   * missing counterpart leg of an existing transaction in ONE op-sqlite
   * transaction, and NEVER touch the existing row (which may be a synced,
   * bank-owned row). The direction is chosen by the caller from the existing
   * amount's sign:
   *   - 'record-destination' (existing was an EXPENSE): a POSITIVE receipt on
   *     the picked destination, dispatched by type exactly as `recordExchange`
   *     does — plain (+amount) for cash/card/crypto_asset, a deposit
   *     contribution for term_deposit, and bond/jar rejected.
   *   - 'record-source' (existing was an INCOME): a NEGATIVE payment on the
   *     picked source, always a plain transaction (a source leg is never a
   *     contribution).
   * The new leg persists NO description; it carries the same
   * `exchangeCounterpartHoldingId` marker create-mode writes (pointing at the
   * EXISTING row's holding), and the label is resolved at render time from it.
   * The EXISTING row is marked too, pointing back at the new leg's holding —
   * both halves of one movement leave the spending pie together — unless the
   * bank owns it (see `markExistingLegTransaction`).
   * Balances are read INSIDE the transaction, never from a render snapshot,
   * exactly as `recordManual` does.
   */
  recordExchangeCounterpart: (input: ExchangeCounterpartInput) =>
    write(async (databaseTransaction) => {
      // Defense in depth: the picker already excludes a synced/syncable
      // holding, but this write is reachable directly, so it
      // re-reads the counterpart's OWN holding+account here, inside the
      // transaction, rather than trust a caller-supplied flag — a sync
      // already owns that holding's balance, and a manual leg written onto
      // it would silently desync from the next sync run.
      const counterpartHoldingRows = await databaseTransaction
        .select({ accountId: holdings.accountId, metadata: holdings.metadata })
        .from(holdings)
        .where(eq(holdings.id, input.counterpartHoldingId))
        .limit(1);
      const counterpartHolding = counterpartHoldingRows.at(0);
      const counterpartAccountRows =
        (await foldMap(maybe(counterpartHolding), (holding) =>
          databaseTransaction
            .select({ institution: accounts.institution })
            .from(accounts)
            .where(eq(accounts.id, holding.accountId))
            .limit(1),
        )) ?? [];

      if (
        counterpartHolding !== undefined &&
        isSyncedHolding(counterpartHolding, counterpartAccountRows.at(0))
      ) {
        throw new Error(
          `recordExchangeCounterpart: counterpart holding ${input.counterpartHoldingId} is synced`,
        );
      }

      if (
        input.direction === 'record-source' &&
        exchangeReceivePath(input.counterpartType) !== 'plain'
      ) {
        throw new Error(
          `recordExchangeCounterpart: a source leg must be a plain holding, got ${input.counterpartType}`,
        );
      }

      await match(input.direction)
        .with('record-source', () =>
          recordManualTransaction(databaseTransaction, {
            holdingId: input.counterpartHoldingId,
            amountMinorUnits: -input.amountMinorUnits,
            time: input.time,
            exchangeCounterpartHoldingId: input.existingHoldingId,
          }),
        )
        .with('record-destination', () =>
          match(exchangeReceivePath(input.counterpartType))
            .with('plain', () =>
              recordManualTransaction(databaseTransaction, {
                holdingId: input.counterpartHoldingId,
                amountMinorUnits: input.amountMinorUnits,
                time: input.time,
                exchangeCounterpartHoldingId: input.existingHoldingId,
              }),
            )
            .with('contribution', () => {
              const contribution: DepositContribution = {
                amountMinorUnits: input.amountMinorUnits,
                date: input.time,
              };

              return appendDepositContributionDatabaseTransaction(
                databaseTransaction,
                input.counterpartHoldingId,
                contribution,
              );
            })
            .with('excluded', () => {
              throw new Error(
                `recordExchangeCounterpart: ${input.counterpartType} is not a valid destination`,
              );
            })
            .exhaustive(),
        )
        .exhaustive();

      await markExistingLegTransaction(databaseTransaction, input);
    }),
  /**
   * Record a manual payment and N linked change-returns as N+1 INDEPENDENT
   * ledger rows in ONE op-sqlite transaction, tied by a shared generated
   * `changeGroupId`. The payment (amount < 0) lands on its own holding carrying
   * its category; each return (amount > 0) lands on a DIFFERENT holding. Net
   * worth nets automatically because every balance moves inside the one
   * transaction; the spending pie nets the linked returns into the payment's
   * category (statistics/category-breakdown). Any failure rolls back every row,
   * so the ledger and every balance can never desync. Balances are read INSIDE
   * the transaction, never from a render snapshot, exactly as `recordManual`
   * does.
   */
  recordManualWithReturns: (input: ManualWithReturnsInput) =>
    write(async (databaseTransaction) => {
      const changeGroupId = id();

      await recordManualTransaction(databaseTransaction, { ...input.payment, changeGroupId });

      for (const change of input.returns) {
        await recordManualTransaction(databaseTransaction, {
          holdingId: change.holdingId,
          amountMinorUnits: change.amountMinorUnits,
          time: input.payment.time,
          changeGroupId,
        });
      }
    }),
  /**
   * Edit an existing MANUAL transaction and keep its holding's stored balance
   * consistent, all in ONE op-sqlite transaction. The row is re-read *inside*
   * the transaction so the balance delta is computed against the amount and
   * time that are actually persisted, never a stale render snapshot. The old
   * (amount, time) and the new one are each judged against THE BOUNDARY
   * (`importRows`) on their own: only a side dated at/after it counts, so an
   * edit that moves the row across the boundary adds or takes back its amount,
   * and an edit wholly before it leaves the balance untouched. A synced (monobank) transaction
   * is never mutated by this path — its amount is owned by the bank import — and
   * a missing id is a no-op rather than an error.
   */
  update: ({ transactionId, amountMinorUnits, time, description }: TransactionEdit) =>
    write(async (databaseTransaction) => {
      const existingRows = await databaseTransaction
        .select({
          holdingId: transactions.holdingId,
          amountMinorUnits: transactions.amountMinorUnits,
          time: transactions.time,
          source: transactions.source,
        })
        .from(transactions)
        .where(eq(transactions.id, transactionId))
        .limit(1);
      const existing = existingRows.at(0);

      if (existing?.source !== 'manual') {
        return;
      }
      await databaseTransaction
        .update(transactions)
        .set({ amountMinorUnits, time, description: description ?? '' })
        .where(eq(transactions.id, transactionId));
      await moveBalanceDatabaseTransaction(
        databaseTransaction,
        existing.holdingId,
        (boundary) =>
          balanceShareOf(amountMinorUnits, time, boundary) -
          balanceShareOf(existing.amountMinorUnits, existing.time, boundary),
      );
    }),
  /**
   * Delete a MANUAL transaction and reverse its effect on the holding's stored
   * balance, all in ONE op-sqlite transaction so the ledger and the balance can
   * never desync on a partial failure. The reversal is the exact inverse of
   * `recordManual`/`update`: `balance -= amountMinorUnits` for a row dated
   * at/after THE BOUNDARY (`importRows`), nothing for a row before it, whose
   * amount the balance set at the boundary already includes. A
   * synced (monobank) transaction is owned by the bank import and is refused with
   * a typed error; a missing id is a no-op rather than an error.
   */
  remove: (transactionId: string) =>
    write(async (databaseTransaction) => {
      const rows = await databaseTransaction
        .select()
        .from(transactions)
        .where(eq(transactions.id, transactionId));
      const row = rows.at(0);

      if (!row) {
        return;
      }

      if (isSyncedTransaction(row)) {
        throw new Error('transactionsRepo.remove: cannot delete a synced transaction');
      }
      await databaseTransaction.delete(transactions).where(eq(transactions.id, transactionId));
      await moveBalanceDatabaseTransaction(
        databaseTransaction,
        row.holdingId,
        (boundary) => -balanceShareOf(row.amountMinorUnits, row.time, boundary),
      );
    }),
  /**
   * Override the category of ONE transaction, by id, inside a single op-sqlite
   * transaction. This is the "just for this one" path: it rewrites only the
   * target row's `category` and touches nothing else — no balance, no other row.
   *
   * It is DELIBERATELY different from
   * `categoryOverridesRepo.upsertCategoryOverride` (category-overrides.repo.ts),
   * the "apply to all similar" name rule, which writes a name→category rule that
   * rewrites every same-name row AND every future import. Here nothing
   * propagates beyond this single row.
   *
   * There is NO `source` gate: a synced (bank-owned) row is still freely
   * categorizable — the category is the user's, not the bank's. A later re-sync
   * never clobbers the pick, because `addManyDedup`'s `onConflictDoUpdate` set
   * names only the bank-owned columns and deliberately excludes `category`.
   */
  setCategory: ({ transactionId, category }: { transactionId: string; category: string }) =>
    write((databaseTransaction) =>
      databaseTransaction
        .update(transactions)
        .set({ category })
        .where(eq(transactions.id, transactionId)),
    ),
  /**
   * Link (or un-link) ONE transaction to a loan holding via the USER's own
   * picker — the MANUAL write path, inside a single op-sqlite transaction.
   * The matcher's own path is `setAutoLoanLinks` (`source: 'auto'`), a
   * separate function: only a manual action may ever move `loanLinkRejected`.
   *
   * - A manual LINK (`loanHoldingId` non-null) clears `loanLinkRejected`,
   *   un-rejecting a row the user had previously undone — a fresh manual
   *   pick always overrides an earlier Undo.
   * - A manual "None" (`loanHoldingId: null`) SETS `loanLinkRejected`: the
   *   choice sticks, so the matcher never re-proposes a link on a row the
   *   user has explicitly said is not a loan payment. This deviates from
   *   the original design note's literal text ("a manual None clears the
   *   flag"), which the orchestrator ruled would make "None" not stick —
   *   the next sync would just auto-link it again.
   *
   * `loanLinkSource` is always cleared to null alongside a null
   * `loanHoldingId`, keeping the two columns in lockstep. There is NO
   * `source`-column gate, exactly like `setCategory` above and for the same
   * reason: the link is user state, not a mutation of bank-owned ledger
   * data, so it is allowed on a synced row too. A later re-sync never
   * clobbers it, because `addManyDedup`'s `onConflictDoUpdate` set names
   * only the bank-owned columns and deliberately excludes all three
   * loan-link columns.
   *
   * A LINK (`loanHoldingId` non-null) is refused with a typed error when the
   * payment's own holding currency differs from the target loan holding's
   * currency: `loanInterestPerPaymentMinor` computes interest in the LOAN's
   * currency, so a cross-currency link would either mislabel that amount or
   * compare two currencies' minor units directly (`statistics/loan-payments`
   * treats such a link, however written, as ordinary spending — this guard
   * is what keeps one from being written in the first place). "None" never
   * needs the check — there is no target currency to compare against.
   */
  setLoanPayment: ({
    transactionId,
    loanHoldingId,
  }: {
    transactionId: string;
    loanHoldingId: string | null;
  }) =>
    write(async (databaseTransaction) => {
      if (loanHoldingId !== null) {
        const paymentRows = await databaseTransaction
          .select({ holdingId: transactions.holdingId })
          .from(transactions)
          .where(eq(transactions.id, transactionId));
        const paymentHoldingId = paymentRows.at(0)?.holdingId;

        if (paymentHoldingId !== undefined) {
          const paymentHoldingRows = await databaseTransaction
            .select({ currency: holdings.currency })
            .from(holdings)
            .where(eq(holdings.id, paymentHoldingId));
          const loanHoldingRows = await databaseTransaction
            .select({ currency: holdings.currency })
            .from(holdings)
            .where(eq(holdings.id, loanHoldingId));
          const paymentCurrency = paymentHoldingRows.at(0)?.currency;
          const loanCurrency = loanHoldingRows.at(0)?.currency;

          if (
            paymentCurrency !== undefined &&
            loanCurrency !== undefined &&
            paymentCurrency !== loanCurrency
          ) {
            throw new Error(
              'transactionsRepo.setLoanPayment: cannot link a payment to a loan holding in a different currency',
            );
          }
        }
      }

      await databaseTransaction
        .update(transactions)
        .set({
          loanHoldingId,
          loanLinkSource: loanHoldingId === null ? null : ('manual' as const),
          loanLinkRejected: loanHoldingId === null,
        })
        .where(eq(transactions.id, transactionId));
    }),
  /**
   * Batch-link the matcher's PROPOSED candidates to their loan holdings, in
   * ONE op-sqlite transaction — the auto-match write path, "one
   * db.transaction() writes the links". Split out of `setLoanPayment`
   * because only a MANUAL action may ever move `loanLinkRejected`: this
   * function never sets or reads it into the write, and its own WHERE
   * clause skips any row that is already
   * linked (`loanHoldingId` non-null) or already rejected, so a candidate
   * list that is stale, or a user Undo/manual-link that raced this batch,
   * can never be silently overwritten. A link whose row fails that WHERE is
   * simply not updated — no error, no partial side effect. An empty
   * `links` array is a no-op.
   *
   * Every target loan holding is ALSO re-checked to still exist AS AN OPEN
   * LOAN — `type = 'loan'` AND `closedAt IS NULL`, not merely that its id is
   * still present — inside this SAME transaction, before any write: the
   * matcher computes its candidates from a snapshot read moments earlier, so
   * a loan holding can be deleted, closed, or (in principle) re-typed in the
   * gap between that read and this write. `holdingsRepo.remove` clears every
   * link that ALREADY points at a holding the instant it is deleted, but
   * cannot clear a link this call has not written yet, and neither a close
   * nor a re-type touches an existing link at all — only THIS re-check does.
   * A link whose loan fails that check is simply skipped, the same
   * no-error/no-partial-effect contract the per-row WHERE above already
   * gives every other skip.
   */
  setAutoLoanLinks: (links: { transactionId: string; loanHoldingId: string }[]) =>
    write(async (databaseTransaction) => {
      if (links.length === 0) {
        return;
      }

      const loanHoldingIds = Array.from(new Set(links.map((link) => link.loanHoldingId)));
      const existingLoanHoldingRows = await databaseTransaction
        .select({ id: holdings.id })
        .from(holdings)
        .where(
          and(
            inArray(holdings.id, loanHoldingIds),
            eq(holdings.type, 'loan'),
            isNull(holdings.closedAt),
          ),
        );
      const existingLoanHoldingIds = new Set(existingLoanHoldingRows.map((row) => row.id));

      for (const link of links) {
        if (!existingLoanHoldingIds.has(link.loanHoldingId)) {
          continue;
        }

        await databaseTransaction
          .update(transactions)
          .set({ loanHoldingId: link.loanHoldingId, loanLinkSource: 'auto' })
          .where(
            and(
              eq(transactions.id, link.transactionId),
              isNull(transactions.loanHoldingId),
              eq(transactions.loanLinkRejected, false),
            ),
          );
      }
    }),
  /**
   * Undo an auto-suggested loan-payment link (false-positive handling):
   * clears the link and sets `loanLinkRejected`, so the matcher
   * never re-proposes the same link on this row again. A later MANUAL link
   * (or manual "None", via `setLoanPayment`) is the only thing that clears
   * the flag back.
   */
  undoAutoLoanLink: (transactionId: string) =>
    write((databaseTransaction) =>
      databaseTransaction
        .update(transactions)
        .set({ loanHoldingId: null, loanLinkSource: null, loanLinkRejected: true })
        .where(and(eq(transactions.id, transactionId), eq(transactions.loanLinkSource, 'auto'))),
    ),
  /**
   * Upsert a batch of imported rows on the `(source, external_id)` unique index
   * and return how many of them were genuinely NEW — the number the sync reports
   * to the user as "imported".
   */
  addManyDedup: (inputs: NewTransaction[]) =>
    write(
      async (databaseTransaction) =>
        (await insertDedupRowsDatabaseTransaction(databaseTransaction, inputs)).length,
    ),
  /**
   * Statement import's ONE write: upsert the parsed rows (the same
   * `(source, external_id)` dedup as `addManyDedup`) AND move the target
   * holding's `balanceMinorUnits`, in a SINGLE op-sqlite transaction. This
   * is the ONE full statement of the balance rule — `kiko-domain`'s
   * "Statement import" section, `ParsedStatement.closingBalance`'s doc
   * comment (`parser.ts`), `importStatement`'s own doc comment, and
   * `resolveClosingBalance`'s doc comment (`monobank-csv.format.ts`) all
   * point back here rather than restating it. The two writes MUST stay
   * atomic in one transaction: calling only `addManyDedup` (which upserts
   * `transactions` and never touches `holdings`) leaves an import-only
   * holding's displayed balance stuck at 0 forever, even though its
   * transaction list shows the real imported rows.
   *
   * THE BOUNDARY: every decision below is relative to one "as-of" instant —
   * the LATER of (a) `holding.balanceSetAt` — set by `holdingsRepo.create`
   * (a non-zero typed opening balance), `holdingsRepo.updateWithBalanceDelta`
   * (a balance edit whose delta is non-zero, stamped at the edit's own
   * `time`), and this function's own closing-balance write below (see "The
   * closing-balance write" further down); NOT by `recordManual`, either leg
   * of an exchange, a change-return row, or `accountsRepo.createCashAccount`
   * — those write ordinary ledger entries, not a balance being SET — and (b)
   * the newest transaction from a SYNC source (`source` not in `('manual',
   * 'import')`). A sync-set balance is authoritative the same way an applied
   * closing balance is, and it survives a disconnect: `accountsRepo.disconnect`
   * clears `accounts.institution` only, so the holding keeps its
   * `monobank`/`btc_wallet`/`binance` rows and this still finds them.
   *
   * `recordManual` (and every exchange or change-return leg), `update`, and
   * `remove` read the SAME boundary (`moveBalanceDatabaseTransaction`): a
   * manual row dated before it is history there too and moves no balance, so
   * deleting a manual duplicate of an imported row, or entering a back-dated
   * one, never pushes the balance off the bank's closing figure.
   *
   * `boundary` is `null` when NEITHER (a) nor (b) has ever happened for this
   * holding: every genuinely new row moves the balance regardless of its own
   * date, and a `closingBalance` is always eligible — this is the original
   * bug-fix case (an import-only holding must show the statement's
   * net/closing balance, not 0).
   *
   * With a boundary, each genuinely new row (from `insertDedupRowsDatabaseTransaction`) is
   * split by its OWN `time` against it: a row dated BEFORE the boundary is
   * HISTORY — it still inserts as a real ledger row, but contributes 0 to
   * `netDelta`. A row dated AT/AFTER the boundary is CURRENT and counts at
   * its full amount.
   *
   * The balance move is `base + netDelta` — the sum of only the CURRENT new
   * rows — so a re-import of an already-imported file (every row refreshed,
   * none new) leaves the balance untouched, exactly like a second identical
   * import must. UNLESS `closingBalance` is given, is in the holding's OWN
   * currency, and is AS OF a time at or after the boundary — then the
   * closing balance is written outright PLUS `postClosingNet`: the net of
   * every row dated STRICTLY AFTER the closing balance's own as-of, from
   * BOTH this import's own new rows AND every row (any source) ALREADY in
   * the ledger before this import ran, read once before this import inserts
   * anything. The rows already in the ledger matter for an out-of-order
   * statement, e.g. importing September's closing balance after an October
   * manual row already exists — without them, September's own closing
   * figure would silently overwrite October's already-recorded row. A
   * stored row an incoming row matched by its `aliasExternalId` counts by
   * the incoming row's real `time`, not by the noon the ledger stores it at.
   * A statement OLDER than the boundary falls back to
   * the net-delta rule instead (where its own rows are, by construction,
   * all history and add 0 too), so an out-of-order re-import can never
   * regress the balance to a stale closing figure.
   *
   * The closing-balance write is `nextBalance = closingBalance.minorUnits +
   * postClosingNet`, not `base + netDelta` — the implicit adjustment this
   * makes, `D = closingBalance.minorUnits - (base + netDelta)`, is never
   * recorded as a ledger row, it just overwrites `base`; `holding.balanceSetAt`
   * is the only durable trace this write leaves behind, not a transaction
   * row. For a holding with NO prior transaction (`base` is always 0, and
   * this statement's own rows are the WHOLE history) this is exact: nothing
   * is left unaccounted for.
   * For a holding with pre-existing history, `D` silently absorbs whatever
   * happened before this statement's own coverage started — a prior manual
   * entry error, an out-of-band transfer, or a real gap this particular
   * statement predates — the resulting balance is correct as of
   * `asOfSeconds`, but the SIZE of `D` is never surfaced anywhere. A
   * history-only import (rows before the boundary, inserted at 0) leaves the
   * same kind of untracked adjustment one level down: `createHoldingValuer`
   * (`src/statistics/holding-value-at/holding-value-at.ts`) derives a
   * holding's opening balance as `current balance - sum(all transactions)`,
   * so those newly inserted rows shift that subtraction even though they
   * added 0 to the
   * current balance, moving every PAST value the net-worth series
   * reconstructs for this holding by the same untracked amount.
   *
   * Imported times are real instants (a named format's own Kyiv reading,
   * `parse-date-time.ts`; column mapping's reading in its mapping's source
   * zone), so the
   * eligibility comparison (`asOfSeconds * 1000 >= boundary`) against a
   * genuinely-UTC boundary (a manual entry or edit timestamped with the real
   * `Date.now()`) is exact. A legacy stored row, and an import-set
   * `balanceSetAt`, are moved onto the same real-instant convention once by
   * `rezoneImportTimes` (`statement-import/rezone-import-times/`).
   *
   * `insertDedupRowsDatabaseTransaction`'s `(source, external_id)` dedup key includes
   * `source` — a row from ANOTHER source (a `manual` entry, a `monobank`
   * sync row) that happens to represent the same real-world transaction as
   * an imported row is NOT a dedup hit; it is a genuinely new `import`-
   * sourced row, and its amount counts fully in `netDelta` PROVIDED it is
   * also dated at/after the boundary — exactly like any other genuinely new
   * row. Importing a statement that covers a transaction the user already
   * entered manually therefore double-counts that amount in the net-delta
   * path when both land on the current side of the boundary (the
   * closing-balance path is unaffected, since it overwrites rather than
   * adds).
   *
   * An account a bank sync owns (`isSyncedAccount`) refuses the import
   * outright, before anything is written, whichever of its holdings is the
   * target: the sync already writes every row of it under its own `source`,
   * so the same rows under `import` would be a second copy no dedup key
   * matches, and an import row cannot be deleted. Account detail offers no
   * Import statement there; this guards a stale route into the import
   * screens.
   *
   * NO MIGRATION was written for holdings a pre-fix build already wrote a
   * wrong (0 or under-counted) balance into: `1.0.0` is
   * not published — build 25 was still in App Store review when this fix
   * landed — so no real user has broken data to repair; a corrected build
   * simply starts applying this rule to every import going forward. The
   * `balance_set_at` migration DOES backfill existing rows, but only as a
   * HEURISTIC (`drizzle/migrations/0036_*.sql`): it guesses a hand-set row
   * by shape (`description ''`, `category` NULL, no exchange/change-return
   * marker), since pre-migration data carries no direct signal for "this
   * manual row was a balance being SET, not an ordinary entry" — this is
   * for backfilling PRE-migration data only, not a repair of the balance
   * itself.
   *
   * A legacy `.kiko` restore backfills the same way: see
   * `restoreDataSnapshot` (`data-transfer/snapshot/restore-snapshot.ts`).
   */
  importRows: (input: {
    holdingId: string;
    rows: ImportRow[];
    closingBalance?: ClosingBalance;
  }): Promise<number> =>
    write(async (databaseTransaction) => {
      const holdingRows = await databaseTransaction
        .select()
        .from(holdings)
        .where(eq(holdings.id, input.holdingId))
        .limit(1);
      const holding = holdingRows.at(0);

      if (!holding) {
        // Review follow-up (ponytail): the real caller (`importStatement`)
        // already validates the holding exists before this ever runs — a
        // missing holding here means a caller bug or a race, not a normal
        // path to silently degrade into a balance-less dedup insert.
        throw new Error(`Target holding not found: ${input.holdingId}`);
      }

      const accountRows = await databaseTransaction
        .select({ institution: accounts.institution })
        .from(accounts)
        .where(eq(accounts.id, holding.accountId))
        .limit(1);
      const account = accountRows.at(0);

      if (account !== undefined && isSyncedAccount(account)) {
        throw new Error('statement-import/synced-account');
      }

      // Read BEFORE the new rows are upserted below, so this reflects the
      // holding's ledger as it stood going into this import — never a row
      // this very import is about to add. This IS boundary source (b): see
      // THE BOUNDARY in the doc comment above.
      const syncRows = await databaseTransaction
        .select({ time: sql<number | null>`max(${transactions.time})` })
        .from(transactions)
        .where(syncSourceRowsOf(input.holdingId));
      const syncBoundary = syncRows.at(0)?.time ?? null;
      const boundary = laterOf(holding.balanceSetAt, syncBoundary);

      // Also read BEFORE the new rows are upserted — an EXISTING row (any
      // source, already in the ledger before this import ran) dated after a
      // closing balance's own as-of must still count toward it; only the
      // rows THIS import adds were counted before, so a re-import (or an
      // out-of-order older statement) could erase a later row the ledger
      // already knew about. The query below filters by holdingId and time
      // alone, with no source/dedup check, so a manual entry the user
      // already logged for the same real-world transaction as an
      // after-asOf statement row is counted here too — the same
      // double-count risk the net-delta path already carries.
      const { rows, aliased } = await dropRowsStoredUnderAlias(databaseTransaction, input.rows);
      let existingPostClosingNetMinorUnits = 0;

      if (input.closingBalance !== undefined) {
        const asOfMilliseconds = input.closingBalance.asOfSeconds * 1000;
        const existingPostClosingRows = await databaseTransaction
          .select({ net: sql<number | null>`sum(${transactions.amountMinorUnits})` })
          .from(transactions)
          .where(postClosingRowsWhere(input.holdingId, asOfMilliseconds));

        existingPostClosingNetMinorUnits =
          (existingPostClosingRows.at(0)?.net ?? 0) -
          aliasedNetBeforeClosing(aliased, asOfMilliseconds);
      }

      const newRows = await insertDedupRowsDatabaseTransaction(databaseTransaction, rows);
      const { nextBalance, balanceSetAt } = resolveImportBalance(
        holding,
        boundary,
        newRows,
        input.closingBalance,
        existingPostClosingNetMinorUnits,
      );

      if (nextBalance !== holding.balanceMinorUnits || balanceSetAt !== undefined) {
        await databaseTransaction
          .update(holdings)
          .set({ balanceMinorUnits: nextBalance, balanceSetAt })
          .where(eq(holdings.id, input.holdingId));
      }

      return newRows.length;
    }),
} satisfies Repository;
