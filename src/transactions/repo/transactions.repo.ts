import {
  type Repository,
  accounts,
  deletedImportKeys,
  type HoldingRow,
  holdings,
  type TransactionRow,
  transactions,
  id,
  database,
  write,
  chunkForTable,
  chunkRows,
  IN_CLAUSE_CHUNK_SIZE,
} from '@kiko/db';
import {
  type SQL,
  and,
  desc,
  eq,
  gt,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import {
  appendDepositContributionDatabaseTransaction,
  clearDeletedImportKeysDatabaseTransaction,
  depositContributionMatchedDatabaseTransaction,
  removeDepositContributionDatabaseTransaction,
  removeHoldingDatabaseTransaction,
} from '@kiko/holdings/repo';
import { match } from 'ts-pattern';
import {
  type RewriteGuardField,
  REWRITE_GUARD_FIELDS,
  prepareRules,
  subjectOfStoredRow,
  winningRule,
} from '@kiko/categories/category-rules';
import maybe, { foldMap } from 'fnts/maybe';
import { maxOf, minOf } from '@kiko/numbers';
import type { Currency } from '@kiko/currency/currency';
import { exchangeReceivePath } from '@kiko/holdings/exchange-destination';
import type { DepositContribution } from '@kiko/holdings/holding-metadata';
import { transactionTemplatesRepo } from '@kiko/transaction-templates/repo';
import { isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';
import type { ExchangeConvertDirection } from '@kiko/holdings/exchange-convert';
import type { ClosingBalance, TimeReading } from '@kiko/statement-import/parser';
import { readAllRulesDatabaseTransaction } from '@kiko/categories/category-rules-repo';
import { isSyncedAccount, isSyncedHolding, isDeletableTransaction } from '@kiko/holdings/deletable';

import type {
  BalanceChange,
  DepositRemoval,
  ExchangeRemoval,
  RemoveHoldingsPlan,
  RemovePlan,
} from '../remove-notice';
import { balanceBoundaryOf, movesBalance } from '../balance-boundary';
import { SYNC_MATCH_WINDOW_MILLISECONDS, pairSyncInputsWithImportRows } from '../sync-adoption';

// A step the caller runs in the SAME write, after the rows are written, so a failure in either
// part rolls both back. It lets the transaction form save a template with its transaction without
// this feature importing the templates one.
type Alongside = (databaseTransaction: typeof database) => Promise<void>;

// The three movement markers are insert-only: the upsert's update set
// (`BANK_OWNED_TRANSACTION_COLUMNS`) leaves them out, since the deterministic key
// of a history row never changes the movement it names.
type NewTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time' | 'source'> &
  Partial<
    Pick<
      TransactionRow,
      | 'description'
      | 'category'
      | 'mcc'
      | 'hold'
      | 'counterIban'
      | 'comment'
      | 'externalId'
      | 'exchangeCounterpartHoldingId'
      | 'exchangePairId'
      | 'untrackedCounterpart'
    >
  >;

type ManualTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time'> &
  Partial<
    Pick<
      TransactionRow,
      | 'description'
      | 'category'
      | 'exchangeCounterpartHoldingId'
      | 'exchangePairId'
      | 'changeGroupId'
      | 'categorySetByHand'
    >
  >;

type TransactionEdit = Pick<TransactionRow, 'amountMinorUnits' | 'time'> &
  Partial<Pick<TransactionRow, 'description'>> & { transactionId: string };

// No holding NAMES here: neither leg persists a description anymore, so the
// only thing each leg needs about the other is its ID — the marker the display
// layer resolves the current name from (see
// src/transactions/exchange-description/exchange-description.ts).
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

/** A holding's rows from a SYNC source — boundary source (b) of THE BOUNDARY
 * in `importRows`'s doc comment. `holdingId` is a value, or `holdings.id` for
 * a subquery correlated to the outer holding row. */
const syncSourceRowsOf = (holdingId: string | typeof holdings.id) =>
  and(
    eq(transactions.holdingId, holdingId),
    ne(transactions.source, 'manual'),
    ne(transactions.source, 'import'),
  );

const balanceShareOf = (amountMinorUnits: number, time: number, boundary: number | null): number =>
  movesBalance(time, boundary) ? amountMinorUnits : 0;

const newestSyncTimeOfHolding = sql<number | null>`(
  SELECT max(${transactions.time}) FROM ${transactions} WHERE ${syncSourceRowsOf(holdings.id)}
)`;

/**
 * A holding with THE BOUNDARY (`importRows`) — the one read the import judges
 * its rows against. Read inside the caller's transaction, never from a render
 * snapshot, so a concurrent write cannot be clobbered by a stale
 * read-modify-write.
 */
const readAnchoredHoldingDatabaseTransaction = async (
  databaseTransaction: typeof database,
  holdingId: string,
): Promise<{ holding: HoldingRow; boundary: number | null } | undefined> => {
  const rows = await databaseTransaction
    .select({ ...getTableColumns(holdings), newestSyncTime: newestSyncTimeOfHolding })
    .from(holdings)
    .where(eq(holdings.id, holdingId))
    .limit(1);

  return foldMap(maybe(rows.at(0)), ({ newestSyncTime, ...holding }) => ({
    holding,
    boundary: balanceBoundaryOf({ balanceSetAt: holding.balanceSetAt, newestSyncTime }),
  }));
};

const writeBalanceDeltaDatabaseTransaction = async (
  databaseTransaction: typeof database,
  holding: HoldingRow,
  delta: number,
): Promise<void> => {
  if (delta === 0) {
    return;
  }

  await databaseTransaction
    .update(holdings)
    .set({ balanceMinorUnits: holding.balanceMinorUnits + delta })
    .where(eq(holdings.id, holding.id));
};

/** A holding, read inside the caller's transaction so a balance move built on
 * it cannot clobber a concurrent write. */
const readHoldingDatabaseTransaction = async (
  databaseTransaction: typeof database,
  holdingId: string,
): Promise<HoldingRow | undefined> => {
  const rows = await databaseTransaction
    .select()
    .from(holdings)
    .where(eq(holdings.id, holdingId))
    .limit(1);

  return rows.at(0);
};

/** Move a holding's stored balance by `delta`. A holding that is already gone
 * has no balance to move. */
const moveBalanceDatabaseTransaction = async (
  databaseTransaction: typeof database,
  holdingId: string,
  delta: number,
): Promise<void> => {
  await foldMap(
    maybe(await readHoldingDatabaseTransaction(databaseTransaction, holdingId)),
    (holding) => writeBalanceDeltaDatabaseTransaction(databaseTransaction, holding, delta),
  );
};

// Insert a manual transaction and adjust its holding's balance by its full
// amount, whatever its date, on an EXISTING transaction handle: every
// transaction updates the balance. `recordManual` wraps this in its own
// `write(...)`; `recordExchange` calls it directly for the source leg and for a
// plain destination leg, keeping both legs in one transaction.
//
// The row carries its OWN category here — a picked category is never lost to
// a blank description or a cancelled override sheet. `applyNameRule`
// (category-rules.repo.ts) governs a SEPARATE concern: propagating that
// pick to every same-name row (and, when the form names this row as the rule's source, writes
// this row's own category and by-hand flag as well), not whether this row itself is categorised.
const recordManualTransaction = async (
  databaseTransaction: typeof database,
  {
    holdingId,
    amountMinorUnits,
    time,
    description,
    category,
    exchangeCounterpartHoldingId,
    exchangePairId,
    changeGroupId,
    categorySetByHand,
  }: ManualTransaction,
): Promise<string> => {
  // Read BEFORE the insert so a ledgerless target is refused before anything is
  // written: its value derives from its metadata, so a row here would show in
  // the Home list and the category breakdown yet never reach net worth. The
  // throw also rolls back the rest of the caller's
  // transaction (a split's payment row, an exchange's source leg).
  const holding = await readHoldingDatabaseTransaction(databaseTransaction, holdingId);

  if (holding !== undefined && isLedgerlessHoldingType(holding.type)) {
    throw new Error('transactions/ledgerless-holding');
  }

  const rowId = id();

  await databaseTransaction.insert(transactions).values({
    id: rowId,
    holdingId,
    amountMinorUnits,
    time,
    description: description ?? '',
    category: category ?? null,
    categorySetByHand: categorySetByHand ?? false,
    exchangeCounterpartHoldingId: exchangeCounterpartHoldingId ?? null,
    exchangePairId: exchangePairId ?? null,
    changeGroupId: changeGroupId ?? null,
    source: 'manual',
  });

  if (holding !== undefined) {
    await writeBalanceDeltaDatabaseTransaction(databaseTransaction, holding, amountMinorUnits);
  }

  return rowId;
};

// Mark the EXISTING row of a Convert as the other leg of the same movement, on
// an EXISTING transaction handle so it commits with the new leg or not at all.
// The existing row is half of one money movement, so leaving it unmarked would
// keep the original expense in the spending pie — exactly the leak the marker
// exists to close, and one no other rule can catch across two currencies.
// `existing` is read INSIDE the transaction, never from a render snapshot. A
// bank-owned (synced) row is never marked by a Convert (see the residual
// documented on `transactions.exchangeCounterpartHoldingId` in `db/schema.ts`,
// which also says how a bank-owned row can come to carry a marker anyway); it
// still gets the pair id, which is what tells the delete its partner is the
// bank's, and the delete then clears a marker that row carries once the leg it
// names is gone (`markerLegIsGone`). A row
// that already carries a marker keeps it: the marker of a deposit source leg is
// what takes the deposit's contribution out with the leg, and a second Convert
// of that leg must not point it somewhere else.
const markExistingLegTransaction = async (
  databaseTransaction: typeof database,
  existing: Pick<TransactionRow, 'source' | 'exchangeCounterpartHoldingId'> | undefined,
  { existingTransactionId, counterpartHoldingId }: ExchangeCounterpartInput,
  exchangePairId: string,
): Promise<void> => {
  if (existing === undefined) {
    return;
  }

  await databaseTransaction
    .update(transactions)
    .set({
      exchangePairId,
      ...(isDeletableTransaction(existing) && existing.exchangeCounterpartHoldingId === null
        ? { exchangeCounterpartHoldingId: counterpartHoldingId }
        : {}),
    })
    .where(eq(transactions.id, existingTransactionId));
};

type NamedHolding = Pick<HoldingRow, 'id' | 'name' | 'type' | 'currency'>;

const holdingIdsOf = (rows: TransactionRow[]): string[] => [
  ...new Set(
    rows.flatMap((row) => [
      row.holdingId,
      ...(foldMap(maybe(row.exchangeCounterpartHoldingId), (markerId) => [markerId]) ?? []),
    ]),
  ),
];

const readNamedHoldingsDatabaseTransaction = async (
  databaseTransaction: typeof database,
  holdingIds: string[],
): Promise<Map<string, NamedHolding>> => {
  if (holdingIds.length === 0) {
    return new Map();
  }

  const rows = await databaseTransaction
    .select({
      id: holdings.id,
      name: holdings.name,
      type: holdings.type,
      currency: holdings.currency,
    })
    .from(holdings)
    .where(inArray(holdings.id, holdingIds));

  return new Map(rows.map((holding) => [holding.id, holding]));
};

const markerHoldingOf = (
  row: Pick<TransactionRow, 'exchangeCounterpartHoldingId'>,
  holdingsById: Map<string, NamedHolding>,
): NamedHolding | undefined =>
  foldMap(maybe(row.exchangeCounterpartHoldingId), (holdingId) => holdingsById.get(holdingId));

const presentIdsOf = (values: (string | null)[]): string[] => [
  ...new Set(values.flatMap((value) => foldMap(maybe(value), (present) => [present]) ?? [])),
];

// Every row, other than `seeds` themselves, of the movements the `seeds` are
// parts of (one row for a transaction delete, every row of the deleted holdings
// for a holding delete). A Convert is allowed on a split row, so a split group
// and a pair id each can lead to a row that carries the other, and following
// either ONE hop leaves a part behind (the converted payment's other leg, or
// the returns): money created or lost. So each pass reads the rows that share a
// group or pair id not read before, and the ids of those rows feed the next
// pass, until a pass finds no new row. Each id is read once, so it ends at the
// latest when every row has been reached.
const readMovementRowsDatabaseTransaction = async (
  databaseTransaction: typeof database,
  seeds: TransactionRow[],
): Promise<TransactionRow[]> => {
  const reached = new Map<string, TransactionRow>(seeds.map((seed) => [seed.id, seed]));
  const readGroupIds = new Set<string>();
  const readPairIds = new Set<string>();
  let frontier = seeds;

  while (frontier.length > 0) {
    const groupIds = presentIdsOf(frontier.map((reachedRow) => reachedRow.changeGroupId)).filter(
      (groupId) => !readGroupIds.has(groupId),
    );
    const pairIds = presentIdsOf(frontier.map((reachedRow) => reachedRow.exchangePairId)).filter(
      (pairId) => !readPairIds.has(pairId),
    );
    const sharing = [
      ...(groupIds.length > 0 ? [inArray(transactions.changeGroupId, groupIds)] : []),
      ...(pairIds.length > 0 ? [inArray(transactions.exchangePairId, pairIds)] : []),
    ];

    if (sharing.length === 0) {
      break;
    }

    for (const groupId of groupIds) {
      readGroupIds.add(groupId);
    }

    for (const pairId of pairIds) {
      readPairIds.add(pairId);
    }

    const found = await databaseTransaction
      .select()
      .from(transactions)
      .where(or(...sharing));

    frontier = found.filter((foundRow) => !reached.has(foundRow.id));

    for (const foundRow of frontier) {
      reached.set(foundRow.id, foundRow);
    }
  }

  const seedIds = new Set(seeds.map((seed) => seed.id));

  return [...reached.values()].filter((reachedRow) => !seedIds.has(reachedRow.id));
};

// What a delete does to the other rows of a movement: a row the user owns
// (manual or imported) goes with it, a bank-owned row is never deleted — "kept",
// and its exchange marker is cleared only when the leg it names goes too — and a
// sync running in between cannot change that, because the rows are read inside
// the delete's own transaction. `split` are
// the rows in a split group of the movement, `pair` the rows in an Exchange or
// Convert pair of it; one row can be in both.
type LinkedRows = {
  split: { removed: TransactionRow[]; kept: TransactionRow[] };
  pair: { removed: TransactionRow[]; kept: TransactionRow[] };
};

const byOwnership = (rows: TransactionRow[]): LinkedRows['split'] => ({
  removed: rows.filter(isDeletableTransaction),
  kept: rows.filter((row) => !isDeletableTransaction(row)),
});

const isOneOf = (ids: string[], value: string | null): boolean =>
  value !== null && ids.includes(value);

const readLinkedRowsDatabaseTransaction = async (
  databaseTransaction: typeof database,
  row: TransactionRow,
): Promise<LinkedRows> => {
  const others = await readMovementRowsDatabaseTransaction(databaseTransaction, [row]);
  const movement = [row, ...others];
  const groupIds = presentIdsOf(movement.map((part) => part.changeGroupId));
  const pairIds = presentIdsOf(movement.map((part) => part.exchangePairId));

  return {
    split: byOwnership(others.filter((other) => isOneOf(groupIds, other.changeGroupId))),
    pair: byOwnership(others.filter((other) => isOneOf(pairIds, other.exchangePairId))),
  };
};

// A row removed with `row` once, even if it shared both a group and a pair id.
const rowsToRemoveWith = (row: TransactionRow, linked: LinkedRows): TransactionRow[] => [
  ...new Map(
    [row, ...linked.pair.removed, ...linked.split.removed].map((removed) => [removed.id, removed]),
  ).values(),
];

const uniqueHoldingNamesOf = (
  rows: TransactionRow[],
  holdingsById: Map<string, NamedHolding>,
): string[] => [
  ...new Set(
    rows.flatMap(
      (row) => foldMap(maybe(holdingsById.get(row.holdingId)), (holding) => [holding.name]) ?? [],
    ),
  ),
];

// How far deleting `rows` moves each holding's balance, by holding name: the sum
// of their full amounts taken back, in the holding's own currency. A holding
// whose parts net to nothing has no entry, and none at all gives `undefined`.
const balanceChangesOf = (
  rows: TransactionRow[],
  holdingsById: Map<string, NamedHolding>,
): BalanceChange[] | undefined => {
  const netByHoldingId = new Map<string, number>();

  for (const row of rows) {
    netByHoldingId.set(
      row.holdingId,
      (netByHoldingId.get(row.holdingId) ?? 0) - row.amountMinorUnits,
    );
  }

  const changes = [...netByHoldingId]
    .flatMap(([holdingId, minorUnits]) => {
      const holding = holdingsById.get(holdingId);

      return holding === undefined || minorUnits === 0
        ? []
        : [{ name: holding.name, currency: holding.currency, minorUnits }];
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return changes.length > 0 ? changes : undefined;
};

// The pair rows of the exchange `row` is itself a part of (its own pair id): the
// confirm names them as the other parts of that exchange.
const ownPairOf = (row: TransactionRow, linked: LinkedRows): LinkedRows['pair'] => {
  const ofOwnPair = (rows: TransactionRow[]): TransactionRow[] =>
    rows.filter(
      (part) => row.exchangePairId !== null && part.exchangePairId === row.exchangePairId,
    );

  return { removed: ofOwnPair(linked.pair.removed), kept: ofOwnPair(linked.pair.kept) };
};

// The pair rows a delete reaches only through the split: a pair the row is no
// member of. A member of the split is named by the split sentence, not as a leg
// of a conversion, so what is left to name is the legs outside the split, of the
// payment's own conversion as much as of a return's.
const viaSplitPairOf = (row: TransactionRow, linked: LinkedRows): LinkedRows['pair'] => {
  const memberIds = [...linked.split.removed, ...linked.split.kept].map((member) => member.id);
  const reachedViaSplit = (rows: TransactionRow[]): TransactionRow[] =>
    rows.filter(
      (part) =>
        !memberIds.includes(part.id) &&
        (row.exchangePairId === null || part.exchangePairId !== row.exchangePairId),
    );

  return { removed: reachedViaSplit(linked.pair.removed), kept: reachedViaSplit(linked.pair.kept) };
};

// The test the row's label applies (`transactionRowDescription`) to read "Transfer
// to/from" instead of "Exchange to/from": the holdings are known and hold one currency.
// The notice also names the other legs of the pair, which can differ from the marker's
// holding when a leg was converted again, so each of them must hold that currency too.
const holdsSameCurrencyAs = (
  row: TransactionRow,
  otherLegs: TransactionRow[],
  holdingsById: Map<string, NamedHolding>,
): boolean => {
  const own = holdingsById.get(row.holdingId);

  return (
    own !== undefined &&
    [
      markerHoldingOf(row, holdingsById),
      ...otherLegs.map((leg) => holdingsById.get(leg.holdingId)),
    ].every((holding) => holding?.currency === own.currency)
  );
};

const exchangeRemovalOf = (
  row: TransactionRow,
  linked: LinkedRows,
  holdingsById: Map<string, NamedHolding>,
): ExchangeRemoval | undefined => {
  const pair = ownPairOf(row, linked);

  if (pair.removed.length > 0) {
    return {
      kind: 'deleted',
      names: uniqueHoldingNamesOf(pair.removed, holdingsById),
      ...(pair.kept.length > 0 ? { keptNames: uniqueHoldingNamesOf(pair.kept, holdingsById) } : {}),
      ...(holdsSameCurrencyAs(row, pair.removed, holdingsById) ? { sameCurrency: true } : {}),
    };
  }

  if (pair.kept.length > 0) {
    return { kind: 'syncedKept', names: uniqueHoldingNamesOf(pair.kept, holdingsById) };
  }

  const marker = markerHoldingOf(row, holdingsById);

  // A deposit source leg has no partner row by design: its plan is the deposit's.
  if (row.exchangeCounterpartHoldingId === null || marker?.type === 'term_deposit') {
    return undefined;
  }

  return {
    kind: 'missing',
    ...foldMap(maybe(marker), ({ name }) => ({ name })),
    ...(holdsSameCurrencyAs(row, [], holdingsById) ? { sameCurrency: true } : {}),
  };
};

// What the delete does to the conversions it reaches only through the split: the
// pairs outside it that go or stay, and a member's exchange marker that no pair
// row answers (a legacy leg), named by the holding it points at. A deposit leg
// has no partner row by design, so its marker is no finding.
const splitExchangesOf = (
  row: TransactionRow,
  linked: LinkedRows,
  holdingsById: Map<string, NamedHolding>,
): ExchangeRemoval[] | undefined => {
  const pair = viaSplitPairOf(row, linked);
  const movement = [
    row,
    ...linked.pair.removed,
    ...linked.pair.kept,
    ...linked.split.removed,
    ...linked.split.kept,
  ];
  const own = exchangeRemovalOf(row, linked, holdingsById);
  // The row's own sentence already says this holding could not be found.
  const reportedByOwn = (marker: NamedHolding | undefined): boolean =>
    own?.kind === 'missing' && own.name === marker?.name;
  const unanswered = linked.split.removed
    .filter(
      (member) =>
        member.id !== row.id &&
        member.exchangeCounterpartHoldingId !== null &&
        !hasPartnerRow(member, movement),
    )
    .map((member) => markerHoldingOf(member, holdingsById))
    .filter((marker) => !reportedByOwn(marker));
  const unansweredNames = [
    ...new Set(
      unanswered.flatMap((marker) =>
        marker === undefined || marker.type === 'term_deposit' ? [] : [marker.name],
      ),
    ),
  ];
  const exchanges: ExchangeRemoval[] = [
    ...(pair.removed.length > 0
      ? [{ kind: 'deleted' as const, names: uniqueHoldingNamesOf(pair.removed, holdingsById) }]
      : []),
    ...(pair.kept.length > 0
      ? [{ kind: 'syncedKept' as const, names: uniqueHoldingNamesOf(pair.kept, holdingsById) }]
      : []),
    ...unansweredNames.map((name) => ({ kind: 'missing' as const, name })),
    ...(unanswered.some((marker) => marker === undefined) ? [{ kind: 'missing' as const }] : []),
  ];

  return exchanges.length > 0 ? exchanges : undefined;
};

const depositRemovalOf = async (
  databaseTransaction: typeof database,
  rows: TransactionRow[],
  holdingsById: Map<string, NamedHolding>,
): Promise<DepositRemoval | undefined> => {
  for (const row of rows) {
    const deposit = markerHoldingOf(row, holdingsById);

    if (deposit?.type === 'term_deposit') {
      return {
        name: deposit.name,
        matched: await depositContributionMatchedDatabaseTransaction(
          databaseTransaction,
          deposit.id,
          row.time,
        ),
      };
    }
  }

  return undefined;
};

// What deleting `row` takes with it, for the confirm text. The delete reads the
// same rows again inside its own transaction, so this only has to be right when
// nothing changes in between, and is never what decides.
const planRemoveDatabaseTransaction = async (
  databaseTransaction: typeof database,
  row: TransactionRow,
): Promise<RemovePlan> => {
  const linked = await readLinkedRowsDatabaseTransaction(databaseTransaction, row);
  const removed = rowsToRemoveWith(row, linked);
  const holdingsById = await readNamedHoldingsDatabaseTransaction(
    databaseTransaction,
    holdingIdsOf([...removed, ...linked.pair.kept]),
  );

  return {
    split: linked.split.removed.length > 0,
    exchange: exchangeRemovalOf(row, linked, holdingsById),
    splitExchanges: splitExchangesOf(row, linked, holdingsById),
    deposit: await depositRemovalOf(databaseTransaction, removed, holdingsById),
    balanceChanges: balanceChangesOf(removed, holdingsById),
  };
};

// The term deposit `row` paid into, unless that deposit is being deleted too:
// its contribution then goes with the deposit.
const paidDepositOf = (
  row: TransactionRow,
  holdingsById: Map<string, NamedHolding>,
  deletedHoldingIds: ReadonlySet<string>,
): NamedHolding | undefined => {
  const marker = markerHoldingOf(row, holdingsById);

  return marker?.type === 'term_deposit' && !deletedHoldingIds.has(marker.id) ? marker : undefined;
};

// Take the contribution `row` made out of the deposit it paid into.
const removeContributionOfRowDatabaseTransaction = async (
  databaseTransaction: typeof database,
  row: TransactionRow,
  holdingsById: Map<string, NamedHolding>,
  deletedHoldingIds: ReadonlySet<string>,
): Promise<void> => {
  const deposit = paidDepositOf(row, holdingsById, deletedHoldingIds);

  if (deposit !== undefined) {
    await removeDepositContributionDatabaseTransaction(databaseTransaction, deposit.id, row.time);
  }
};

const NO_HOLDINGS: ReadonlySet<string> = new Set();

// The stored key of each import row among `rows`, per holding: what a re-import
// of the deleted row is recognised by (`readRevivedKeysDatabaseTransaction`).
const deletedImportKeysOf = (rows: TransactionRow[]): { holdingId: string; externalId: string }[] =>
  rows
    .filter((row) => row.source === 'import')
    .flatMap(
      (row) =>
        foldMap(maybe(row.externalId), (externalId) => [
          { holdingId: row.holdingId, externalId },
        ]) ?? [],
    );

// Keep the key of every deleted import row, so a re-import knows it was deleted
// and not just never imported. Written once per holding and key (a row deleted
// again after it came back writes the same key).
const rememberDeletedImportKeysDatabaseTransaction = async (
  databaseTransaction: typeof database,
  rows: TransactionRow[],
): Promise<void> => {
  for (const part of chunkForTable(deletedImportKeys, deletedImportKeysOf(rows))) {
    await databaseTransaction.insert(deletedImportKeys).values(part).onConflictDoNothing();
  }
};

// Whether the leg the marker of the kept row `keptRow` names goes with this delete:
// its holding is among the deleted ones, or a removed row of the same pair sat on
// it. A marker that names anything else (a deposit a second Convert of the leg
// never repointed) still has its leg, and so still keeps the row out of spending.
const markerLegIsGone = (
  keptRow: TransactionRow,
  removedRows: TransactionRow[],
  deletedHoldingIds: ReadonlySet<string>,
): boolean =>
  foldMap(
    maybe(keptRow.exchangeCounterpartHoldingId),
    (markerHoldingId) =>
      deletedHoldingIds.has(markerHoldingId) ||
      removedRows.some(
        (removedRow) =>
          removedRow.holdingId === markerHoldingId &&
          removedRow.exchangePairId !== null &&
          removedRow.exchangePairId === keptRow.exchangePairId,
      ),
  ) ?? false;

// Delete rows and give each one's full amount back to its OWN holding, in that
// holding's currency, whatever the row's date or source: every row updated the
// balance when it was written, so none can stay in it once the row is gone.
// Then take a deposit's contribution out with the leg that paid it. A bank-owned
// row of the same movement (`kept`) stays. Its marker is cleared in the same write
// only when the leg it names is gone with this delete (`markerLegIsGone`): a marker
// left behind would keep a real purchase out of spending for good, and one cleared
// while its leg stays would count that purchase twice. Its pair id
// stays, and so does every bank-owned column. Everything runs on the caller's
// transaction, so a throw (a database error mid-delete) rolls the rows and
// balances back too.
const removeRowsDatabaseTransaction = async (
  databaseTransaction: typeof database,
  rows: TransactionRow[],
  kept: TransactionRow[],
  deletedHoldingIds: ReadonlySet<string> = NO_HOLDINGS,
): Promise<void> => {
  const holdingsById = await readNamedHoldingsDatabaseTransaction(
    databaseTransaction,
    holdingIdsOf(rows),
  );

  for (const row of rows) {
    await databaseTransaction.delete(transactions).where(eq(transactions.id, row.id));
    await moveBalanceDatabaseTransaction(databaseTransaction, row.holdingId, -row.amountMinorUnits);
    await removeContributionOfRowDatabaseTransaction(
      databaseTransaction,
      row,
      holdingsById,
      deletedHoldingIds,
    );
  }

  await rememberDeletedImportKeysDatabaseTransaction(databaseTransaction, rows);

  for (const row of kept.filter((keptRow) => markerLegIsGone(keptRow, rows, deletedHoldingIds))) {
    await databaseTransaction
      .update(transactions)
      .set({ exchangeCounterpartHoldingId: null })
      .where(eq(transactions.id, row.id));
  }
};

// What deleting a set of holdings reaches in OTHER holdings. `own` are the rows
// of the deleted holdings that link to anything (a pair id, a split group or an
// exchange marker; a row with none leads nowhere). `removed` are the rows
// elsewhere that belong to the same movements and are the user's, `kept` the
// bank's, which are never deleted (a kept row's marker is cleared when it names a
// deleted holding or the holding of a removed row in the same pair). A deposit among
// the deleted holdings also reaches the legs that paid into it, whose marker names it. A
// partner on a deleted holding is in `own`, so it is never counted twice: it
// goes with its holding, with no reversal.
type HoldingsLinks = {
  own: TransactionRow[];
  removed: TransactionRow[];
  kept: TransactionRow[];
};

const readLinksOfHoldingsDatabaseTransaction = async (
  databaseTransaction: typeof database,
  holdingIds: string[],
): Promise<HoldingsLinks> => {
  if (holdingIds.length === 0) {
    return { own: [], removed: [], kept: [] };
  }

  const own = await databaseTransaction
    .select()
    .from(transactions)
    .where(
      and(
        inArray(transactions.holdingId, holdingIds),
        or(
          isNotNull(transactions.exchangePairId),
          isNotNull(transactions.changeGroupId),
          isNotNull(transactions.exchangeCounterpartHoldingId),
        ),
      ),
    );
  const deposits = await databaseTransaction
    .select({ id: holdings.id })
    .from(holdings)
    .where(and(inArray(holdings.id, holdingIds), eq(holdings.type, 'term_deposit')));
  const inbound =
    deposits.length === 0
      ? []
      : await databaseTransaction
          .select()
          .from(transactions)
          .where(
            and(
              inArray(
                transactions.exchangeCounterpartHoldingId,
                deposits.map((deposit) => deposit.id),
              ),
              notInArray(transactions.holdingId, holdingIds),
            ),
          );
  const reached = await readMovementRowsDatabaseTransaction(databaseTransaction, [
    ...own,
    ...inbound,
  ]);

  return { own, ...byOwnership([...inbound, ...reached]) };
};

/**
 * What deleting the holdings `holdingIds` must do to the rest of the ledger,
 * run on the caller's transaction BEFORE the holdings go (their rows are still
 * there to follow): delete the user's rows of the same movements on other
 * holdings, giving each row's full amount back to its holding, and take
 * out of a deposit the contribution a deleted holding's leg made. A bank-owned
 * row of a movement stays, with its exchange marker cleared in the same write
 * when the marker names a deleted holding or a leg removed with it.
 * Every deposit among the holdings also loses the legs that paid into it.
 */
export const cascadeLinkedRowsDatabaseTransaction = async (
  databaseTransaction: typeof database,
  holdingIds: string[],
): Promise<void> => {
  const { own, removed, kept } = await readLinksOfHoldingsDatabaseTransaction(
    databaseTransaction,
    holdingIds,
  );
  const deletedHoldingIds = new Set(holdingIds);
  const holdingsById = await readNamedHoldingsDatabaseTransaction(
    databaseTransaction,
    holdingIdsOf(own),
  );

  await removeRowsDatabaseTransaction(databaseTransaction, removed, kept, deletedHoldingIds);

  for (const row of own) {
    await removeContributionOfRowDatabaseTransaction(
      databaseTransaction,
      row,
      holdingsById,
      deletedHoldingIds,
    );
  }
};

const sortedHoldingNamesOf = (
  rows: TransactionRow[],
  holdingsById: Map<string, NamedHolding>,
): string[] => uniqueHoldingNamesOf(rows, holdingsById).sort();

const hasPartnerRow = (row: TransactionRow, linkedRows: TransactionRow[]): boolean =>
  row.exchangePairId !== null &&
  linkedRows.some((other) => other.id !== row.id && other.exchangePairId === row.exchangePairId);

// The deposits whose contribution a deleted leg's delete takes out, and those
// where it cannot be matched and stays, each by name.
const contributionNamesDatabaseTransaction = async (
  databaseTransaction: typeof database,
  rows: TransactionRow[],
  holdingsById: Map<string, NamedHolding>,
  deletedHoldingIds: ReadonlySet<string>,
): Promise<{ reversed: string[]; kept: string[] }> => {
  const reversed = new Set<string>();
  const kept = new Set<string>();

  for (const row of rows) {
    const deposit = paidDepositOf(row, holdingsById, deletedHoldingIds);

    if (deposit === undefined) {
      continue;
    }

    const matched = await depositContributionMatchedDatabaseTransaction(
      databaseTransaction,
      deposit.id,
      row.time,
    );

    (matched ? reversed : kept).add(deposit.name);
  }

  return { reversed: [...reversed].sort(), kept: [...kept].sort() };
};

// The holdings the exchange legs of the deleted holdings point at without a
// partner row to find, by name, and whether one of them points at a holding
// that is gone (nothing to name). A marker that names a deleted holding, or a
// deposit (its leg has no partner row by design), is no finding.
const unlinkedLegsOf = (
  own: TransactionRow[],
  linkedRows: TransactionRow[],
  holdingsById: Map<string, NamedHolding>,
  deletedHoldingIds: ReadonlySet<string>,
): { names: string[]; plain: boolean } => {
  const markers = own.flatMap((row) =>
    row.exchangeCounterpartHoldingId === null ||
    deletedHoldingIds.has(row.exchangeCounterpartHoldingId) ||
    hasPartnerRow(row, linkedRows)
      ? []
      : [holdingsById.get(row.exchangeCounterpartHoldingId)],
  );

  return {
    names: [
      ...new Set(
        markers.flatMap((marker) =>
          marker === undefined || marker.type === 'term_deposit' ? [] : [marker.name],
        ),
      ),
    ].sort(),
    plain: markers.some((marker) => marker === undefined),
  };
};

/**
 * What `cascadeLinkedRowsDatabaseTransaction` would do for `holdingIds`, for the
 * delete confirm's text. The cascade reads the same rows again inside its own
 * transaction, so this only has to be right when nothing changes in between, and
 * is never what decides.
 */
const planLinkedRowsDatabaseTransaction = async (
  databaseTransaction: typeof database,
  holdingIds: string[],
): Promise<RemoveHoldingsPlan> => {
  const { own, removed, kept } = await readLinksOfHoldingsDatabaseTransaction(
    databaseTransaction,
    holdingIds,
  );
  const deletedHoldingIds = new Set(holdingIds);
  const linkedRows = [...own, ...removed, ...kept];
  const holdingsById = await readNamedHoldingsDatabaseTransaction(
    databaseTransaction,
    holdingIdsOf(linkedRows),
  );
  const contributions = await contributionNamesDatabaseTransaction(
    databaseTransaction,
    [...own, ...removed],
    holdingsById,
    deletedHoldingIds,
  );
  const unlinked = unlinkedLegsOf(own, linkedRows, holdingsById, deletedHoldingIds);

  return {
    deletedRows: { count: removed.length, names: sortedHoldingNamesOf(removed, holdingsById) },
    reversedContributions: contributions.reversed,
    keptContributions: contributions.kept,
    keptSynced: sortedHoldingNamesOf(kept, holdingsById),
    unlinked: unlinked.names,
    unlinkedPlain: unlinked.plain,
    templatesChanged: await transactionTemplatesRepo.countReferencingHoldingsDatabaseTransaction(
      databaseTransaction,
      holdingIds,
    ),
    balanceChanges: balanceChangesOf(removed, holdingsById),
  };
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
 * the write it describes. `addManyDedup` counts them and hands the rows to the
 * adoption (`adoptImportTwinsDatabaseTransaction`), which may take some over as
 * the sync's own rows; the statement-import balance write (`importRows` below)
 * needs the actual rows, to sum their `amountMinorUnits` — a refreshed (already
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
 * the same row under (`noonAliasDedupKey` in statement-import's mapping), and
 * how coarse its clock is. */
type ImportRow = NewTransaction & { aliasExternalId?: string; timeReading?: TimeReading };

const isKey = (key: string | null | undefined): key is string => Boolean(key);

/** The deleted keys of this holding that rows of the batch come back under: for
 * each row's `externalId`, the deleted keys it matches, its own and its
 * `aliasExternalId` (a row stored under the older noon key was deleted under
 * that key). Read before `dropRowsStoredUnderAlias` strips the alias, and
 * before any row is upserted. A row that is not inserted (stored already, or
 * held by a sync row) never clears its key. */
const readRevivedKeysDatabaseTransaction = async (
  databaseTransaction: typeof database,
  holdingId: string,
  rows: ImportRow[],
): Promise<Map<string, string[]>> => {
  const candidates = [
    ...new Set(rows.flatMap(({ externalId, aliasExternalId }) => [externalId, aliasExternalId])),
  ].filter(isKey);
  const deleted = new Set<string>();

  for (const keyChunk of chunkRows(candidates, IN_CLAUSE_CHUNK_SIZE)) {
    const found = await databaseTransaction
      .select({ externalId: deletedImportKeys.externalId })
      .from(deletedImportKeys)
      .where(
        and(
          eq(deletedImportKeys.holdingId, holdingId),
          inArray(deletedImportKeys.externalId, keyChunk),
        ),
      );

    for (const { externalId } of found) {
      deleted.add(externalId);
    }
  }

  const revived = new Map<string, string[]>();

  for (const { externalId, aliasExternalId } of rows) {
    const matched = [externalId, aliasExternalId].filter(isKey).filter((key) => deleted.has(key));

    if (isKey(externalId) && matched.length > 0) {
      revived.set(externalId, matched);
    }
  }

  return revived;
};

/** Forget the keys of the rows an import just brought back. */
const clearRevivedKeysDatabaseTransaction = async (
  databaseTransaction: typeof database,
  holdingId: string,
  keys: string[],
): Promise<void> => {
  for (const keyChunk of chunkRows(keys, IN_CLAUSE_CHUNK_SIZE)) {
    await databaseTransaction
      .delete(deletedImportKeys)
      .where(
        and(
          eq(deletedImportKeys.holdingId, holdingId),
          inArray(deletedImportKeys.externalId, keyChunk),
        ),
      );
  }
};

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
): Promise<{ rows: ImportRow[]; aliased: AliasedRow[] }> => {
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
    rows: rows.filter((row) => storedFor(row) === undefined),
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

const MINUTE_CLOCK_LAST_SECOND_MILLISECONDS = 59_000;

type SyncedRow = { time: number; amountMinorUnits: number };

/** The first and last instant a row's clock reading allows, how far from them
 * a synced row of the same purchase can be, and which of two rows whose reach
 * ends at the same instant claims first. */
type ClockRange = { earliest: number; latest: number; window: number; claimOrder: number };

// A timed reading and the sync stamp one purchase seconds apart. A date-only
// reading is held by a synced row of its own local day only. Where its reach
// ends together with a timed reading's, it claims after it, which places the
// same purchase more precisely; it never claims ahead of a row whose reach ends
// sooner, since that can strand the only synced row the earlier one reaches.
const clockRangeOf = ({ time, timeReading }: ImportRow): ClockRange =>
  match(timeReading)
    .with(undefined, () => ({
      earliest: time,
      latest: time,
      window: SYNC_MATCH_WINDOW_MILLISECONDS,
      claimOrder: 0,
    }))
    .with({ kind: 'minute' }, () => ({
      earliest: time,
      latest: time + MINUTE_CLOCK_LAST_SECOND_MILLISECONDS,
      window: SYNC_MATCH_WINDOW_MILLISECONDS,
      claimOrder: 0,
    }))
    .with({ kind: 'day' }, ({ fromSeconds, untilSeconds }) => ({
      earliest: fromSeconds * 1000,
      latest: untilSeconds * 1000 - 1,
      window: 0,
      claimOrder: 1,
    }))
    .exhaustive();

type RangedRow = { row: ImportRow; range: ClockRange };

const reachStartOf = ({ earliest, window }: ClockRange): number => earliest - window;

const reachEndOf = ({ latest, window }: ClockRange): number => latest + window;

const byClaimTurn = (left: RangedRow, right: RangedRow): number =>
  reachEndOf(left.range) - reachEndOf(right.range) ||
  left.range.claimOrder - right.range.claimOrder ||
  reachStartOf(left.range) - reachStartOf(right.range);

/** Each amount's synced times, ascending. */
const syncedTimesByAmount = (synced: SyncedRow[]): Map<number, number[]> => {
  const byAmount = new Map<number, number[]>();

  for (const { time, amountMinorUnits } of synced) {
    const times = byAmount.get(amountMinorUnits) ?? [];

    times.push(time);
    byAmount.set(amountMinorUnits, times);
  }

  for (const times of byAmount.values()) {
    times.sort((left, right) => left - right);
  }

  return byAmount;
};

/** Whether `row` takes the earliest unclaimed same-amount synced time in its
 * reach; a taken time leaves `unclaimed`. */
const claimsSyncedTime = (unclaimed: Map<number, number[]>, { row, range }: RangedRow): boolean => {
  const times = unclaimed.get(row.amountMinorUnits) ?? [];
  const reachStart = reachStartOf(range);
  const index = times.findIndex((time) => time >= reachStart);

  if (index === -1 || times[index] > reachEndOf(range)) {
    return false;
  }

  times.splice(index, 1);

  return true;
};

/**
 * `rows` without every row a sync source already holds on this holding: the
 * same amount, dated within `SYNC_MATCH_WINDOW_MILLISECONDS` of the row's clock
 * reading, or on the same local day for a date-only row. A disconnected
 * bank keeps its synced rows, and a statement over the same period carries
 * them again under keys no dedup key matches, so that statement row is
 * neither inserted nor counted toward the balance. One synced row stands for
 * one statement row. The statement rows claim in order of where their reach
 * ends, each taking the earliest unclaimed synced row in reach: that holds as
 * many rows as any pairing can, so a real unsynced row of the same amount at
 * the edge of the synced period never strands a synced one. The file's row
 * order decides only between two rows read at the same instant.
 */
const dropRowsHeldBySync = async (
  databaseTransaction: typeof database,
  holdingId: string,
  rows: ImportRow[],
): Promise<NewTransaction[]> => {
  if (rows.length === 0) {
    return [];
  }

  const rangedRows = rows.map((row) => ({ row, range: clockRangeOf(row) }));
  const synced = await databaseTransaction
    .select({ time: transactions.time, amountMinorUnits: transactions.amountMinorUnits })
    .from(transactions)
    .where(
      and(
        syncSourceRowsOf(holdingId),
        gte(transactions.time, minOf(rangedRows.map(({ range }) => reachStartOf(range)))),
        lte(transactions.time, maxOf(rangedRows.map(({ range }) => reachEndOf(range)))),
      ),
    );
  const unclaimed = syncedTimesByAmount(synced);
  const heldRows = new Set<ImportRow>();

  for (const rangedRow of [...rangedRows].sort(byClaimTurn)) {
    if (claimsSyncedTime(unclaimed, rangedRow)) {
      heldRows.add(rangedRow.row);
    }
  }

  return rows
    .filter((row) => !heldRows.has(row))
    .map(({ aliasExternalId: _storedAlias, timeReading: _timeReading, ...row }) => row);
};

/** The net of the `aliased` rows the post-closing read counted by their
 * stored time although their real time is at or before the closing as-of. */
const aliasedNetBeforeClosing = (aliased: AliasedRow[], asOfMilliseconds: number): number =>
  aliased
    .filter(({ time, storedTime }) => storedTime > asOfMilliseconds && time <= asOfMilliseconds)
    .reduce((sum, row) => sum + row.amountMinorUnits, 0);

// Every bank-owned column `upsertDedupRowsDatabaseTransaction`'s upsert
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

// One SQL condition per field of `REWRITE_GUARD_FIELDS`, typed over that list: a field added to or
// dropped from it fails to compile here, so the refresh below and `isRewriteEligible` always name
// the same rows.
const GUARD_FIELD_IS_UNSET: Record<RewriteGuardField, SQL> = {
  categorySetByHand: sql`${transactions.categorySetByHand} = 0`,
  exchangePairId: sql`${transactions.exchangePairId} IS NULL`,
  exchangeCounterpartHoldingId: sql`${transactions.exchangeCounterpartHoldingId} IS NULL`,
  setsBalance: sql`${transactions.setsBalance} = 0`,
  changeGroupId: sql`${transactions.changeGroupId} IS NULL`,
};

// The refresh of a row a rule won at this batch: the bank-owned columns, and the rule's category
// only when the row is one a rule may rewrite (`REWRITE_GUARD_FIELDS`: not picked by hand, not an
// exchange leg, a balance-setting row or a split-change row) AND its amount changed, since the
// amount is what the rules judge again. The CASE reads the OLD row (SQLite evaluates every SET
// expression against it), so such a row, or a refresh with the same amount, keeps the category it
// has. A row no rule won never reaches this set, so the bank's category is never written back.
const ruleWonTransactionSet = {
  ...bankOwnedTransactionSet,
  category: sql`CASE WHEN ${sql.join(
    REWRITE_GUARD_FIELDS.map((field) => GUARD_FIELD_IS_UNSET[field]),
    sql` AND `,
  )}
    AND ${transactions.amountMinorUnits} IS NOT ${sql.raw(`excluded.${transactions.amountMinorUnits.name}`)}
    THEN ${sql.raw(`excluded.${transactions.category.name}`)}
    ELSE ${transactions.category} END`,
};

// The WHERE clause for `importRows`'s existing-rows-on-top-of-the-closing read,
// exported so a real-SQLite test can prove the exact predicate — the `holdingId`
// scope and the STRICT `gt` boundary — rather than a hand-transcribed copy of
// it. A row counts on top of a closing balance when it is dated after the as-of
// (any source), or when it is MANUAL and dated on or before it: the bank figure
// holds the bank's own rows, never a manual entry, so a closing never absorbs
// one. A row that set a balance never counts: its amount is part of the balance
// a hand edit or an opening set, which a closing balance replaces outright.
export const postClosingRowsWhere = (holdingId: string, asOfMilliseconds: number) =>
  and(
    eq(transactions.holdingId, holdingId),
    or(gt(transactions.time, asOfMilliseconds), eq(transactions.source, 'manual')),
    eq(transactions.setsBalance, false),
  );

type RuledBatch = {
  rows: NewTransaction[];
  // The rows whose category is a rule's, so the upsert can tell them from the bank's.
  ruleWon: ReadonlySet<NewTransaction>;
};

// Apply the category rules at insert time: the winning rule of a row replaces its category, and a
// row no rule wins keeps the bank's. The rules are read once per call and prepared once, and the
// currencies of the batch's holdings are read only when some rule is readable (an amount matcher
// compares the holding's currency). A row whose holding is not found has no currency, so only
// the rules that need none can match it. Chunked over the holding ids (a large import can span
// many holdings) — see `IN_CLAUSE_CHUNK_SIZE`.
const withCategoryRules = async (
  databaseTransaction: typeof database,
  batch: NewTransaction[],
): Promise<RuledBatch> => {
  if (batch.length === 0) {
    return { rows: batch, ruleWon: new Set() };
  }

  const prepared = prepareRules(await readAllRulesDatabaseTransaction(databaseTransaction));

  if (prepared.ordered.length === 0) {
    return { rows: batch, ruleWon: new Set() };
  }

  const currencyByHoldingId = new Map<string, Currency>();

  for (const holdingIdChunk of chunkRows(
    Array.from(new Set(batch.map((input) => input.holdingId))),
    IN_CLAUSE_CHUNK_SIZE,
  )) {
    for (const holding of await databaseTransaction
      .select({ id: holdings.id, currency: holdings.currency })
      .from(holdings)
      .where(inArray(holdings.id, holdingIdChunk))) {
      currencyByHoldingId.set(holding.id, holding.currency);
    }
  }

  const ruleWon = new Set<NewTransaction>();
  const rows = batch.map((input) => {
    const winner = winningRule(
      prepared,
      subjectOfStoredRow({
        description: input.description ?? '',
        amountMinorUnits: input.amountMinorUnits,
        time: input.time,
        currency: currencyByHoldingId.get(input.holdingId) ?? null,
      }),
    );

    if (winner === undefined) {
      return input;
    }

    const ruled = { ...input, category: winner.category };

    ruleWon.add(ruled);

    return ruled;
  });

  return { rows, ruleWon };
};

/** A stored statement-import row a sync input can adopt. */
type ImportTwin = Pick<
  TransactionRow,
  'id' | 'holdingId' | 'amountMinorUnits' | 'time' | 'externalId' | 'category' | 'comment'
>;

/** Every `import` row on the inputs' holdings dated within the match window of the span of
 * their times, read inside the caller's own transaction. */
const readImportTwinsDatabaseTransaction = async (
  databaseTransaction: typeof database,
  inputs: NewTransaction[],
): Promise<ImportTwin[]> => {
  const times = inputs.map((input) => input.time);

  return databaseTransaction
    .select({
      id: transactions.id,
      holdingId: transactions.holdingId,
      amountMinorUnits: transactions.amountMinorUnits,
      time: transactions.time,
      externalId: transactions.externalId,
      category: transactions.category,
      comment: transactions.comment,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.source, 'import'),
        inArray(
          transactions.holdingId,
          Array.from(new Set(inputs.map((input) => input.holdingId))),
        ),
        gte(transactions.time, minOf(times) - SYNC_MATCH_WINDOW_MILLISECONDS),
        lte(transactions.time, maxOf(times) + SYNC_MATCH_WINDOW_MILLISECONDS),
      ),
    );
};

// The bank's values go onto the import row through the same column list the
// upsert refreshes, so a bank-owned column added there is adopted here too.
// `category` and `comment` are user and file state: the import row's own value
// stays, and only a column it never had is filled from the sync.
const adoptedValuesOf = (twin: ImportTwin, input: NewTransaction) => ({
  ...Object.fromEntries(
    BANK_OWNED_TRANSACTION_COLUMNS.map(({ key }) => [
      key,
      input[key] ?? (key === 'description' ? '' : null),
    ]),
  ),
  source: input.source,
  externalId: input.externalId,
  category: twin.category ?? input.category,
  comment: twin.comment ?? input.comment,
});

/**
 * Turn the statement-import twin of each of these NEW sync inputs into the
 * sync's own row, in place, and return the inputs it adopted so the insert skips
 * them. The rule
 * (which import row a sync input adopts, the residual it leaves) is
 * `pairSyncInputsWithImportRows`'s. One UPDATE by the import row's id: every
 * structural column (`id`, `holding_id`, the loan link, the exchange pair and
 * its marker, `change_group_id`, `sets_balance`, `created_at`) stays, and no
 * `holdings` row is written. The sync overwrites the stored balance from the
 * bank's own figure, and an adoption adds no amount anywhere, so the ledger keeps
 * one row per purchase without moving any balance. Runs only on the sync insert
 * path: a statement import never adopts.
 */
const adoptImportTwinsDatabaseTransaction = async (
  databaseTransaction: typeof database,
  newRows: NewTransaction[],
): Promise<Set<NewTransaction>> => {
  if (newRows.length === 0) {
    return new Set();
  }

  const adoptions = pairSyncInputsWithImportRows(
    newRows,
    await readImportTwinsDatabaseTransaction(databaseTransaction, newRows),
  );
  const { rows: withRules } = await withCategoryRules(
    databaseTransaction,
    adoptions.map(({ input }) => input),
  );

  for (const [index, { candidate }] of adoptions.entries()) {
    await databaseTransaction
      .update(transactions)
      .set(adoptedValuesOf(candidate, withRules[index]))
      .where(eq(transactions.id, candidate.id));
  }

  return new Set(adoptions.map(({ input }) => input));
};

/**
 * Apply the category rules and upsert a batch already folded onto
 * one row per conflict key (`dedupByConflictKey`) on the `(source, external_id)`
 * unique index.
 */
const upsertDedupRowsDatabaseTransaction = async (
  databaseTransaction: typeof database,
  batch: NewTransaction[],
): Promise<void> => {
  const { rows: withRules, ruleWon } = await withCategoryRules(databaseTransaction, batch);
  // Upsert on the `(source, external_id)` unique index: a re-fetched
  // Monobank item is REFRESHED, not dropped. A `hold: true` authorization
  // imports at its PROVISIONAL amount and re-syncs at the settled one, which
  // `onConflictDoNothing` silently discarded — freezing the wrong amount
  // forever. `excluded` is SQLite's alias for the row that would have been
  // inserted.
  //
  // The update set names the BANK-owned columns. `comment` (the user's note)
  // is deliberately absent, as is every structural column (`id`, `holding_id`,
  // `exchange_counterpart_holding_id`). `category` (which may be the user's
  // own pick, or a rule's rewrite) is absent from the set of a row no rule
  // won; for a row a rule won it is written only by `ruleWonTransactionSet`'s
  // guarded CASE.
  //
  // Manual rows are untouched either way: they carry a null `external_id`,
  // and SQLite treats each NULL in a unique index as distinct, so two of
  // them never conflict.
  //
  // Chunked per `chunkForTable`: a single unchunked insert bound one
  // parameter per PRESENT key per row and SQLite
  // rejects a statement over its 32766 bound-parameter ceiling — a whole
  // statement-import file failed past ~2980 rows, a Monobank sync past
  // ~2731. `dedupByConflictKey` already collapsed `withRules` to at
  // most one row per `(source, external_id)` key BEFORE this split, so no
  // two chunks can ever target the same conflict key — each chunk's
  // ON CONFLICT resolves independently, with identical semantics to the
  // old single-statement insert. A row sits in exactly one of the two
  // inserts below, so their conflict keys stay disjoint too. The rows a rule
  // won are inserted after the others, so rows with an identical time (a
  // date-only import) can change their relative order; tie order is not a
  // contract.
  const toInsertRow = (input: NewTransaction) => ({ id: id(), ...input });
  const partitions = [
    {
      rows: withRules.filter((input) => !ruleWon.has(input)).map(toInsertRow),
      set: bankOwnedTransactionSet,
    },
    {
      rows: withRules.filter((input) => ruleWon.has(input)).map(toInsertRow),
      set: ruleWonTransactionSet,
    },
  ];

  for (const { rows, set } of partitions) {
    for (const part of chunkForTable(transactions, rows)) {
      await databaseTransaction
        .insert(transactions)
        .values(part)
        .onConflictDoUpdate({
          target: [transactions.source, transactions.externalId],
          set,
          setWhere: bankOwnedTransactionSetWhere,
        });
    }
  }
};

/**
 * Upsert a batch of imported rows on the `(source, external_id)` unique index —
 * the shared core `importRows` (statement import's balance-write path, below)
 * runs inside its own `write(...)` transaction, and `addManyDedup` shares
 * `upsertDedupRowsDatabaseTransaction` with it. Returns the rows that were
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
  const newRows = await partitionNewRows(databaseTransaction, batch);

  await upsertDedupRowsDatabaseTransaction(databaseTransaction, batch);

  return newRows;
};

// What a row the import inserts adds to the balance on the net-delta path: all of
// it for a row brought back after a delete, else its share by the boundary.
const importShareOf = (
  row: NewTransaction,
  boundary: number | null,
  revivedKeys: ReadonlyMap<string, string[]>,
): number => {
  const wasDeleted =
    foldMap(maybe(row.externalId), (externalId) => revivedKeys.has(externalId)) ?? false;

  return wasDeleted
    ? row.amountMinorUnits
    : balanceShareOf(row.amountMinorUnits, row.time, boundary);
};

type ImportBalanceDecision = {
  nextBalance: number;
  balanceSetAt?: number;
  balanceSetRowId?: null;
};

/** `importRows`'s pure balance decision, pulled out of the write closure to
 * stay under Biome's cognitive-complexity cap — see that function's own doc
 * comment for the full rule this implements. `balanceSetAt` and
 * `balanceSetRowId` are present only when a closing balance actually applied
 * this call; the caller writes them to `holdings` alongside `nextBalance`.
 * `existingPostClosingNetMinorUnits` is the net of every row ALREADY in the
 * ledger that rides on top of the bank figure (never a row that set a
 * balance): any row dated after the closing balance's own as-of, and every
 * MANUAL row dated on or before it, read before this import inserted anything
 * — an already-imported holding's later rows must not be erased by an older
 * statement's own closing figure, and the bank figure never holds a manual
 * entry, so a closing never absorbs one (`postClosingRowsWhere`).
 *
 * KNOWN LIMIT: a manual row that duplicates a bank row (the user logged a
 * purchase by hand, and the statement they import holds it too) counts twice,
 * once in the bank figure and once on top, until the user deletes the manual
 * row; that delete lands the balance exactly on the bank figure.
 *
 * `revivedKeys` are the rows this import brings
 * back after the user deleted them: the net-delta path counts one at its full
 * amount whatever its date (its delete reversed it), where a row the holding
 * never had counts only after the boundary. */
const resolveImportBalance = (
  holding: Pick<HoldingRow, 'balanceMinorUnits' | 'currency'>,
  boundary: number | null,
  newRows: NewTransaction[],
  closingBalance: ClosingBalance | undefined,
  existingPostClosingNetMinorUnits: number,
  revivedKeys: ReadonlyMap<string, string[]>,
): ImportBalanceDecision => {
  const netDelta = newRows.reduce((sum, row) => sum + importShareOf(row, boundary, revivedKeys), 0);
  // `>=`, not `movesBalance`'s `>`: a closing balance is itself an anchor, so
  // one as of exactly the boundary re-asserts the bank's figure rather than
  // being history the earlier anchor already counted.
  const useClosingBalance =
    closingBalance !== undefined &&
    closingBalance.currency === holding.currency &&
    (boundary === null || closingBalance.asOfSeconds * 1000 >= boundary);

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
    balanceSetRowId: null,
  };
};

type ImportInput = {
  holdingId: string;
  rows: ImportRow[];
  closingBalance?: ClosingBalance;
};

/** Everything `importRows` reads from the ledger before it writes a row, and
 * what `previewImportBalance` reads to say what that write would do. `rows` is
 * the batch without the rows the ledger already holds under an alias or a
 * sync source; `existingPostClosingNetMinorUnits` is `resolveImportBalance`'s
 * penultimate argument. `revivedKeys` maps the `externalId` of a row of the
 * batch to the deleted keys it matches (`readRevivedKeysDatabaseTransaction`),
 * `resolveImportBalance`'s last. */
type ImportPlan = {
  holding: HoldingRow;
  boundary: number | null;
  rows: NewTransaction[];
  existingPostClosingNetMinorUnits: number;
  revivedKeys: Map<string, string[]>;
};

/** The reads both `importRows` and `previewImportBalance` make, refusals
 * included, so what the preview shows is decided by the same code the import
 * runs. It writes nothing. */
const readImportPlanDatabaseTransaction = async (
  databaseTransaction: typeof database,
  input: ImportInput,
): Promise<ImportPlan> => {
  // Read BEFORE the new rows are upserted, so the boundary reflects the
  // holding's ledger as it stood going into this import — never a row this
  // very import is about to add.
  const anchored = await readAnchoredHoldingDatabaseTransaction(
    databaseTransaction,
    input.holdingId,
  );

  if (anchored === undefined) {
    // The real caller (`importStatement`) already validates the holding exists
    // before this ever runs — a missing holding here means a caller bug or a
    // race, not a normal path to silently degrade into a balance-less dedup
    // insert.
    throw new Error(`Target holding not found: ${input.holdingId}`);
  }

  const { holding, boundary } = anchored;
  const accountRows = await databaseTransaction
    .select({ institution: accounts.institution })
    .from(accounts)
    .where(eq(accounts.id, holding.accountId))
    .limit(1);
  const account = accountRows.at(0);

  if (account !== undefined && isSyncedAccount(account)) {
    throw new Error('statement-import/synced-account');
  }

  // Same refusal as `recordManualTransaction`'s: the import screen's
  // "Create new holding" can still hand back a ledgerless one.
  if (isLedgerlessHoldingType(holding.type)) {
    throw new Error('statement-import/ledgerless-holding');
  }

  // The alias is read here, while `dropRowsStoredUnderAlias` below has not yet
  // stripped it: a row stored under its noon alias was deleted under that key.
  const revivedKeys = await readRevivedKeysDatabaseTransaction(
    databaseTransaction,
    input.holdingId,
    input.rows,
  );

  // Also read BEFORE the new rows are upserted — an EXISTING row already in
  // the ledger before this import ran must still count on top of a closing
  // balance: a row (any source) dated after its as-of, and a manual row dated
  // on or before it; only the rows THIS import adds were counted before, so a
  // re-import (or an out-of-order older statement) could erase a row the
  // ledger already knew about. The query below filters by holdingId, time, the
  // source of an on-or-before row, and the balance-set mark, with no dedup
  // check, so a manual entry the user already logged for the same real-world
  // transaction as a statement row is counted here too — the same
  // double-count risk the net-delta path already carries.
  const { rows: unaliasedRows, aliased } = await dropRowsStoredUnderAlias(
    databaseTransaction,
    input.rows,
  );
  const rows = await dropRowsHeldBySync(databaseTransaction, input.holdingId, unaliasedRows);

  if (input.closingBalance === undefined) {
    return { holding, boundary, rows, existingPostClosingNetMinorUnits: 0, revivedKeys };
  }

  const asOfMilliseconds = input.closingBalance.asOfSeconds * 1000;
  const existingPostClosingRows = await databaseTransaction
    .select({ net: sql<number | null>`sum(${transactions.amountMinorUnits})` })
    .from(transactions)
    .where(postClosingRowsWhere(input.holdingId, asOfMilliseconds));

  return {
    holding,
    boundary,
    rows,
    existingPostClosingNetMinorUnits:
      (existingPostClosingRows.at(0)?.net ?? 0) -
      aliasedNetBeforeClosing(aliased, asOfMilliseconds),
    revivedKeys,
  };
};

/** What a statement import would leave a holding's balance at, for the preview
 * a user reads before importing. `set` is a closing balance that applies: the
 * balance becomes `minorUnits`, which is the bank figure plus the holding's own
 * entries the statement does not hold (every manual one dated on or before its
 * date, and every row dated after it), so it differs from `bankMinorUnits` when
 * there are any. A file
 * with no closing balance, or one that does not apply, either `change`s the
 * balance by its rows after the boundary or leaves it. */
export type ImportBalancePreview = { currency: Currency } & (
  | { kind: 'set'; minorUnits: number; bankMinorUnits: number; asOfSeconds: number }
  | { kind: 'change'; fromMinorUnits: number; toMinorUnits: number }
  | { kind: 'stays'; minorUnits: number }
);

const importBalancePreviewOf = (
  holding: Pick<HoldingRow, 'balanceMinorUnits' | 'currency'>,
  decision: ImportBalanceDecision,
  closingBalance: ClosingBalance | undefined,
): ImportBalancePreview => {
  const { currency } = holding;

  if (closingBalance !== undefined && decision.balanceSetAt !== undefined) {
    return {
      kind: 'set',
      currency,
      minorUnits: decision.nextBalance,
      bankMinorUnits: closingBalance.minorUnits,
      asOfSeconds: closingBalance.asOfSeconds,
    };
  }

  if (decision.nextBalance === holding.balanceMinorUnits) {
    return { kind: 'stays', currency, minorUnits: holding.balanceMinorUnits };
  }

  return {
    kind: 'change',
    currency,
    fromMinorUnits: holding.balanceMinorUnits,
    toMinorUnits: decision.nextBalance,
  };
};

// The display projection of every ledger row: the columns Home and the other
// ledger lists read, joined to the holding and account each belongs to.
const contextRowsQuery = () =>
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
      // The untracked-wallet code travels with it, for the same two readers.
      untrackedCounterpart: transactions.untrackedCounterpart,
      // With the marker, what the row label needs to compare the leg's own
      // currency to its counterpart's (`holdingCurrencyById`).
      holdingId: transactions.holdingId,
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
      // With the name, what `accountDisplayName` needs to show an implicit
      // account (whose stored name is an English sentinel) by its localized
      // kind name.
      accountKind: accounts.kind,
      accountArchivedAt: accounts.archivedAt,
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
    .innerJoin(accounts, eq(holdings.accountId, accounts.id));

export const transactionsRepo = {
  listByHoldingQuery: (holdingId: string) =>
    database.select().from(transactions).where(eq(transactions.holdingId, holdingId)),
  // Every transaction row, newest first, as stored — the Statistics line chart
  // groups the whole ledger by holding to reconstruct each holding's balance
  // over time. `listWithContextBetweenQuery` is a display projection joined to
  // the holding and account for their names, which this read has no use for.
  listAllQuery: () => database.select().from(transactions).orderBy(desc(transactions.time)),
  getByIdQuery: (transactionId: string) =>
    database.select().from(transactions).where(eq(transactions.id, transactionId)).limit(1),
  /**
   * The newest imported time for a holding's rows of one sync `source` (a single
   * `{ time }` row, or none). The crypto-sync transaction import reads this as an
   * incremental cursor: the next Binance fetch starts from just before this time
   * rather than re-walking the full history every sync. With `externalIdPrefixes`, only
   * the rows whose external id starts with one of them count, so a cursor can follow one
   * kind of row while other kinds of the same source sit on the holding. The prefix is
   * compared by `substr`, not `LIKE`, so an id with `%` or `_` in it is no pattern.
   */
  latestSyncedTimeQuery: (
    holdingId: string,
    source: TransactionRow['source'],
    externalIdPrefixes?: string[],
  ) =>
    database
      .select({ time: transactions.time })
      .from(transactions)
      .where(
        and(
          eq(transactions.holdingId, holdingId),
          eq(transactions.source, source),
          foldMap(maybe(externalIdPrefixes), (prefixes) =>
            or(
              ...prefixes.map(
                (prefix) =>
                  sql`substr(${transactions.externalId}, 1, ${prefix.length}) = ${prefix}`,
              ),
            ),
          ),
        ),
      )
      .orderBy(desc(transactions.time))
      .limit(1),
  /**
   * Which of `externalIds` a stored row of `source` already holds, on any holding —
   * the same `(source, external_id)` lookup `addManyDedup` counts new rows with.
   */
  storedExternalIdsQuery: async (
    source: TransactionRow['source'],
    externalIds: string[],
  ): Promise<Set<string>> => {
    const stored = await readStoredConflictRows(
      externalIds.map((externalId) => ({ source, externalId })),
      (where) =>
        database.select({ externalId: transactions.externalId }).from(transactions).where(where),
    );

    return new Set(stored.flatMap((row) => row.externalId ?? []));
  },
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
   * rejected (a manual "None" or Undo must stick), and not one leg
   * of an Exchange/Convert or a move to an untracked Binance wallet (the structural
   * `exchangeCounterpartHoldingId` and `untrackedCounterpart` markers, same checks
   * `exchange-exclusion.ts` makes) — filtered here in SQL,
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
          isNull(transactions.untrackedCounterpart),
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
  /**
   * Every ledger row with its holding and account, newest first, whose time
   * falls within the inclusive `[from, to]` bounds; an `undefined` side is
   * open-ended, so an `undefined` pair is the whole ledger. Home reads its
   * picked date range through this instead of every row.
   */
  listWithContextBetweenQuery: (from: number | undefined, to: number | undefined) =>
    contextRowsQuery()
      .where(
        and(
          foldMap(maybe(from), (start) => gte(transactions.time, start)),
          foldMap(maybe(to), (end) => lte(transactions.time, end)),
        ),
      )
      .orderBy(desc(transactions.time)),
  /**
   * The earliest and latest time of the whole ledger (`listWithContextBetweenQuery`
   * with no bounds), in one row; both are null for an empty ledger — Home's
   * date-range field shows the span of the whole ledger while it reads only a
   * window of it.
   */
  contextSpanQuery: () =>
    database
      .select({
        earliest: sql<number | null>`min(${transactions.time})`,
        latest: sql<number | null>`max(${transactions.time})`,
      })
      .from(transactions)
      .innerJoin(holdings, eq(transactions.holdingId, holdings.id))
      .innerJoin(accounts, eq(holdings.accountId, accounts.id)),
  /**
   * Each stored category of the whole ledger once, in the order the newest-first
   * ledger first meets it — Home's category filter lists every category the
   * ledger holds while it reads only a window of it.
   */
  contextCategoriesQuery: () =>
    database
      .select({ category: transactions.category })
      .from(transactions)
      .innerJoin(holdings, eq(transactions.holdingId, holdings.id))
      .innerJoin(accounts, eq(holdings.accountId, accounts.id))
      .groupBy(transactions.category)
      .orderBy(desc(sql`max(${transactions.time})`)),
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
   * on a partial failure. The balance moves by the row's full amount whatever
   * its date, a back-dated row included: every transaction updates the balance. Returns the new
   * row's id; `categorySetByHand` marks a category the user picked, which no rule replaces.
   */
  recordManual: (input: ManualTransaction, alongside?: Alongside) =>
    write(async (databaseTransaction) => {
      const rowId = await recordManualTransaction(databaseTransaction, input);

      await alongside?.(databaseTransaction);

      return rowId;
    }),
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
  recordExchange: (input: ExchangeInput, alongside?: Alongside) =>
    write(async (databaseTransaction) => {
      if (input.destinationHoldingId === input.sourceHoldingId) {
        throw new Error('recordExchange: destination equals source');
      }

      // A deposit destination has no row to share it with: its leg is a
      // contribution in the deposit's metadata, found again by the leg's date.
      const exchangePairId = id();

      await recordManualTransaction(databaseTransaction, {
        holdingId: input.sourceHoldingId,
        amountMinorUnits: -input.valueOutMinorUnits,
        time: input.time,
        // No description is persisted: the label is resolved at render time
        // from this marker + the counterpart's CURRENT name via `t` (see
        // src/transactions/exchange-description/exchange-description.ts). A persisted
        // `Exchange to <name>` string was English forever and went stale on a
        // rename.
        exchangeCounterpartHoldingId: input.destinationHoldingId,
        exchangePairId,
      });

      await match(exchangeReceivePath(input.destinationType))
        .with('plain', () =>
          recordManualTransaction(databaseTransaction, {
            holdingId: input.destinationHoldingId,
            amountMinorUnits: input.valueInMinorUnits,
            time: input.time,
            exchangeCounterpartHoldingId: input.sourceHoldingId,
            exchangePairId,
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

      await alongside?.(databaseTransaction);
    }),
  /**
   * Convert-mode (spec "Convert an existing transaction"): record the ONE
   * missing counterpart leg of an existing transaction in ONE op-sqlite
   * transaction; the existing row (which may be a synced, bank-owned row) gets
   * only the pair id (plus the marker when it is manual or imported), never its
   * amount, time or balance. The direction is chosen by the caller from the
   * existing amount's sign:
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

      const existingRows = await databaseTransaction
        .select({
          source: transactions.source,
          exchangePairId: transactions.exchangePairId,
          exchangeCounterpartHoldingId: transactions.exchangeCounterpartHoldingId,
        })
        .from(transactions)
        .where(eq(transactions.id, input.existingTransactionId))
        .limit(1);
      const existing = existingRows.at(0);
      // An existing row that already belongs to a movement hands its id on, so
      // converting a leg again puts the new leg in the same group and one
      // delete takes the whole group.
      const exchangePairId = existing?.exchangePairId ?? id();

      await match(input.direction)
        .with('record-source', () =>
          recordManualTransaction(databaseTransaction, {
            holdingId: input.counterpartHoldingId,
            amountMinorUnits: -input.amountMinorUnits,
            time: input.time,
            exchangeCounterpartHoldingId: input.existingHoldingId,
            exchangePairId,
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
                exchangePairId,
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

      await markExistingLegTransaction(databaseTransaction, existing, input, exchangePairId);
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
   * does. Returns the payment row's id; the payment's `categorySetByHand` lands on that row
   * only, since a return has no category.
   */
  recordManualWithReturns: (input: ManualWithReturnsInput, alongside?: Alongside) =>
    write(async (databaseTransaction) => {
      const changeGroupId = id();

      const paymentId = await recordManualTransaction(databaseTransaction, {
        ...input.payment,
        changeGroupId,
      });

      for (const change of input.returns) {
        await recordManualTransaction(databaseTransaction, {
          holdingId: change.holdingId,
          amountMinorUnits: change.amountMinorUnits,
          time: input.payment.time,
          changeGroupId,
        });
      }

      await alongside?.(databaseTransaction);

      return paymentId;
    }),
  /**
   * Edit an existing MANUAL transaction and keep its holding's stored balance
   * consistent, all in ONE op-sqlite transaction. The row is re-read *inside*
   * the transaction so the balance delta is computed against the amount that is
   * actually persisted, never a stale render snapshot. The balance moves by the
   * difference of the amounts, whatever the row's date or mark (a row that set
   * a balance included): every transaction updates the balance, so a row's date
   * never decides whether its amount counts. A synced (monobank) transaction is
   * never mutated by this path — its amount is owned by the bank import — and a
   * missing id is a no-op rather than an error.
   */
  update: (
    { transactionId, amountMinorUnits, time, description }: TransactionEdit,
    alongside?: Alongside,
  ) =>
    write(async (databaseTransaction) => {
      const existingRows = await databaseTransaction
        .select()
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
        amountMinorUnits - existing.amountMinorUnits,
      );
      await alongside?.(databaseTransaction);
    }),
  /**
   * Delete a MANUAL or IMPORTED transaction and reverse its effect on the
   * holding's stored balance, all in ONE op-sqlite transaction so the ledger and
   * the balance can never desync on a partial failure. Every delete takes the
   * row's full amount back (`balance -= amountMinorUnits`): every transaction
   * updates the balance, so none can stay in it without its row. That holds
   * whatever the row's source, its date against THE BOUNDARY (`importRows`), and
   * whether it set a balance. Only the balance moves: `balanceSetAt` stays, and
   * no bank figure is stored, so deleting every row of an import ends on the
   * statement's opening balance. A deleted import row with a stored key also
   * leaves that key for its holding (`deleted_import_keys`), so a re-import can
   * tell it from a row the holding never had; every row
   * `removeRowsDatabaseTransaction` deletes does the same, a cascaded partner
   * included. A synced (monobank) transaction is owned by the
   * sync and is refused with a typed error; a missing id is a no-op rather than
   * an error.
   *
   * A row that is one part of a movement takes the rest with it, each reversed
   * the same way on its own holding, in that holding's currency: every other row
   * of an Exchange or Convert
   * that shares its `exchangePairId` and every other row of a split
   * (`changeGroupId`), followed from each row found to every row it shares an
   * id with (a Convert on a split row links the two), and, for a leg that paid a
   * term deposit, the one contribution dated at the leg's time
   * (`removeDepositContributionDatabaseTransaction`). A bank-owned partner is
   * kept, never deleted, with its exchange marker cleared in the same write only
   * when the leg it names is gone (`markerLegIsGone`). The linked rows are read here,
   * inside the delete, so a sync that ran after `removePlan` read them cannot
   * change what is deleted.
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

      if (!isDeletableTransaction(row)) {
        throw new Error('transactionsRepo.remove: cannot delete a synced transaction');
      }

      const linked = await readLinkedRowsDatabaseTransaction(databaseTransaction, row);

      await removeRowsDatabaseTransaction(
        databaseTransaction,
        rowsToRemoveWith(row, linked),
        linked.pair.kept,
      );
    }),
  /**
   * What `remove` would take with the row, for the delete confirm's text: a plain
   * plan (nothing linked) for a row that stands alone or does not exist.
   */
  removePlan: async (transactionId: string): Promise<RemovePlan> => {
    const rows = await database
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId));

    return (
      foldMap(maybe(rows.at(0)), (row) => planRemoveDatabaseTransaction(database, row)) ?? {
        split: false,
      }
    );
  },
  /**
   * Delete a manual holding with all of its transactions, and with them the
   * movements those transactions are one part of: in one transaction, the
   * cascade (`cascadeLinkedRowsDatabaseTransaction`), then the holding itself
   * (`removeHoldingDatabaseTransaction`, which refuses a holding a live sync
   * owns and rolls the cascade back with it). A missing id is a no-op.
   */
  removeHolding: (holdingId: string) =>
    write(async (databaseTransaction) => {
      await cascadeLinkedRowsDatabaseTransaction(databaseTransaction, [holdingId]);
      await removeHoldingDatabaseTransaction(databaseTransaction, holdingId);
    }),
  /**
   * What deleting these holdings (one holding, or every holding of an account)
   * would take from OTHER holdings, for the delete confirm's text: nothing
   * (`removeHoldingsNotice` gives no text) for holdings no movement links to.
   */
  removeHoldingsPlan: (holdingIds: string[]): Promise<RemoveHoldingsPlan> =>
    planLinkedRowsDatabaseTransaction(database, holdingIds),
  /**
   * Override the category of ONE transaction, by id, inside a single op-sqlite
   * transaction. This is the "just for this one" path: it rewrites only the
   * target row's `category` and its by-hand flag and touches nothing else — no balance, no other
   * row.
   *
   * It is DELIBERATELY different from
   * `categoryRulesRepo.applyNameRule` (category-rules.repo.ts), the "apply to
   * all similar" name rule, which writes a name→category rule that rewrites
   * every same-name row AND every future import. Here nothing propagates
   * beyond this single row, and the row is marked as picked by hand so no rule
   * and no rewrite ever replaces the pick.
   *
   * There is NO `source` gate: a synced (bank-owned) row is still freely
   * categorizable — the category is the user's, not the bank's. A later re-sync
   * never clobbers the pick: the refresh may write `category` when a rule wins at a new amount,
   * but only on a row the by-hand flag set here does not guard.
   */
  setCategory: ({ transactionId, category }: { transactionId: string; category: string }) =>
    write((databaseTransaction) =>
      databaseTransaction
        .update(transactions)
        .set({ category, categorySetByHand: true })
        .where(eq(transactions.id, transactionId)),
    ),
  /**
   * Link (or un-link) ONE transaction to a loan holding via the USER's own
   * picker — the MANUAL write path, inside a single op-sqlite transaction.
   * The matcher's own path is `setAutoLoanLinks` (`source: 'auto'`), a
   * separate function: only a manual action may ever move `loanLinkRejected`.
   *
   * - A manual LINK (`loanHoldingId` non-null) clears `loanLinkRejected`,
   *   un-rejecting a row the user had undone — a fresh manual
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
   * gap between that read and this write. `removeHolding` clears every
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
   * Upsert a batch of synced rows on the `(source, external_id)` unique index
   * and return how many of them were genuinely NEW — the number the sync reports
   * to the user as "imported". A new input first adopts its statement-import twin
   * (`adoptImportTwinsDatabaseTransaction`): that row becomes the sync's own in
   * place and is not inserted, so it is not counted, like a refresh.
   */
  addManyDedup: (inputs: NewTransaction[]) =>
    write(async (databaseTransaction) => {
      const batch = dedupByConflictKey(inputs);
      const newRows = await partitionNewRows(databaseTransaction, batch);
      const adopted = await adoptImportTwinsDatabaseTransaction(databaseTransaction, newRows);

      await upsertDedupRowsDatabaseTransaction(
        databaseTransaction,
        batch.filter((input) => !adopted.has(input)),
      );

      return newRows.length - adopted.size;
    }),
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
   * and `accountsRepo.createCashAccount` (a non-zero typed opening balance),
   * `holdingsRepo.updateWithBalanceDelta` (a balance edit whose delta is
   * non-zero, stamped at the edit's own `time`), and this function's own
   * closing-balance write below (see "The closing-balance write" further
   * down); NOT by `recordManual`, either leg of an exchange, or a
   * change-return row — those write ordinary ledger entries, not a balance
   * being SET — and (b)
   * the newest transaction from a SYNC source (`source` not in `('manual',
   * 'import')`). A sync-set balance is authoritative the same way an applied
   * closing balance is, and it survives a disconnect: `accountsRepo.disconnect`
   * clears `accounts.institution` only, so the holding keeps its
   * `monobank`/`btc_wallet`/`binance` rows and this still finds them.
   *
   * `recordManual` (and every exchange or change-return leg), `update`, and
   * `remove` do NOT read the boundary: every transaction updates its holding's
   * balance, so a manual row moves it by its full amount whatever its date, a
   * back-dated one included, and so does its edit and its delete, a row that
   * set a balance (an opening balance or a hand edit, known by its stored
   * `transactions.setsBalance` mark) included. Only this function's own
   * closing balance sets a figure outright. The mark stays for good, so such a
   * row never counts in `postClosingNet`, which would count it twice. This
   * function's closing-balance write clears `holdings.balanceSetRowId`, since
   * no row is written at a closing balance's as-of.
   *
   * `boundary` is `null` when NEITHER (a) nor (b) has ever happened for this
   * holding: every genuinely new row moves the balance regardless of its own
   * date, and a `closingBalance` is always eligible — this is the original
   * bug-fix case (an import-only holding must show the statement's
   * net/closing balance, not 0).
   *
   * With a boundary, each genuinely new row (from `insertDedupRowsDatabaseTransaction`) is
   * split by its OWN `time` against it: a row dated AT or BEFORE the boundary
   * is HISTORY — it still inserts as a real ledger row, but contributes 0 to
   * `netDelta`. A row dated STRICTLY AFTER the boundary is CURRENT and counts
   * at its full amount (`movesBalance`); a statement's rows are judged by the
   * bank's figure, which a manual write is not.
   *
   * The balance move is `base + netDelta` — the sum of only the CURRENT new
   * rows — so a re-import of an already-imported file (every row refreshed,
   * none new) leaves the balance untouched, exactly like a second identical
   * import must. UNLESS `closingBalance` is given, is in the holding's OWN
   * currency, and is AS OF a time at or after the boundary — then the
   * closing balance is written outright PLUS `postClosingNet`: the net of
   * every row dated STRICTLY AFTER the closing balance's own as-of, from
   * BOTH this import's own new rows AND every row (any source) ALREADY in
   * the ledger before this import ran, and of every MANUAL row ALREADY in
   * the ledger dated on or before the as-of, read once before this import
   * inserts anything. The rows already in the ledger matter for an out-of-order
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
   * happened before this statement's own coverage started — an out-of-band
   * transfer, or a real gap this particular statement predates (never a
   * manual row, which stays on top) — the resulting balance is correct as of
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
   * `source` — a `manual` entry that happens to represent the same
   * real-world transaction as an imported row is NOT a dedup hit; it is a
   * genuinely new `import`-sourced row, and its amount counts fully in
   * `netDelta` PROVIDED it is also dated after the boundary — exactly like
   * any other genuinely new row. Importing a statement that covers a
   * transaction the user already entered manually therefore double-counts
   * that amount in the net-delta path when both land on the current side of
   * the boundary, and in the closing-balance path whatever the manual row's
   * date (see the KNOWN LIMIT below).
   *
   * A SYNC-source row is matched instead (`dropRowsHeldBySync`): a statement
   * row with the holding's synced row's amount, dated within 60 seconds of
   * it (a date-only row: on the same local day), is that synced row — not
   * inserted, not counted. One synced row stands for one statement row. Rows a pre-fix build
   * already imported over synced ones stay; no migration removes them.
   *
   * A closing balance never absorbs a manual row (user ruling): a back-dated
   * MANUAL row dated on or before a closing balance's as-of moves the balance
   * when written (every write counts), and importing a statement with that
   * closing balance (`asOfSeconds * 1000 >= boundary`) keeps it on top of the
   * bank figure, as it keeps a row of any source dated after the as-of. Example:
   * closing 10,000 as of Oct 1 and a manual -1,000 dated Sep 20 give 9,000; the
   * same statement again keeps 9,000, a newer closing keeps the row on top, and
   * deleting the row gives 10,000. The rows that set a balance (an opening
   * balance, a hand edit) never ride on top: the closing replaces what they set.
   * KNOWN LIMIT: a manual row that duplicates a bank row of the statement counts
   * twice, in the bank figure and on top of it, until the user deletes the
   * manual row, which then lands the balance exactly on the bank figure; a first
   * closing import over a holding the user logged by hand shows it.
   *
   * An account a bank sync owns (`isSyncedAccount`) refuses the import
   * outright, before anything is written, whichever of its holdings is the
   * target: the sync already writes every row of it under its own `source`,
   * so the same rows under `import` would be a second copy. Account detail
   * offers no Import statement there; this guards a stale route into the
   * import screens. A DISCONNECTED bank imports, and the synced-row match
   * above keeps the overlap single. An imported row can be deleted
   * (`remove`), which takes its full amount back from the balance whatever its
   * date and keeps its stored key for its holding (`deleted_import_keys`). A
   * deleted row returns when the same file is imported again, its amount with
   * it: a closing balance re-sets the bank's figure, and without one the row
   * counts in full whatever its date, because its key was deleted. A row the
   * holding never had, dated on or before the boundary, stays history (0), so a
   * first import of past months never counts twice. A row matches a deleted key
   * by its `externalId` or its `aliasExternalId`, and the import deletes the
   * keys of the rows it inserts, in the same transaction (the preview deletes
   * nothing). A key is also for the CURRENT anchor only: every write that moves
   * the holding's balance anchor deletes ALL the holding's keys in that same
   * write, because the new anchor already holds what the user deleted: a closing
   * balance that applies here (`useClosingBalance`), a hand-set balance
   * (`updateWithBalanceDelta`, non-zero delta) and the bank figure of a sync
   * (`upsertByMetadataKey`). Without it a newer anchor plus an older statement
   * imported afterwards counts the deleted row twice (closing 85,000; delete
   * -5,000 gives 90,000; a newer closing 70,000; the old statement again would
   * give 65,000, not 70,000). The sync clears the keys when it sets the balance
   * but never reads them and never revives a row. The key rewrites
   * (`upgradeStoredDedupKeys`, `rezoneImportTimes`) leave the keys as they were,
   * so a key they rewrote misses, and the row then comes back at 0. A delete
   * made before the table existed left no key, so such a row comes back at 0 as
   * well.
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
  importRows: (input: ImportInput): Promise<number> =>
    write(async (databaseTransaction) => {
      const { holding, boundary, rows, existingPostClosingNetMinorUnits, revivedKeys } =
        await readImportPlanDatabaseTransaction(databaseTransaction, input);
      const newRows = await insertDedupRowsDatabaseTransaction(databaseTransaction, rows);
      const { nextBalance, balanceSetAt, balanceSetRowId } = resolveImportBalance(
        holding,
        boundary,
        newRows,
        input.closingBalance,
        existingPostClosingNetMinorUnits,
        revivedKeys,
      );

      await clearRevivedKeysDatabaseTransaction(
        databaseTransaction,
        input.holdingId,
        newRows.flatMap(
          ({ externalId }) => foldMap(maybe(externalId), (key) => revivedKeys.get(key)) ?? [],
        ),
      );

      // A closing balance that applies is the new anchor: it already holds what the
      // user deleted, so every key of the holding goes, not only the revived ones.
      if (balanceSetAt !== undefined) {
        await clearDeletedImportKeysDatabaseTransaction(databaseTransaction, input.holdingId);
      }

      if (nextBalance !== holding.balanceMinorUnits || balanceSetAt !== undefined) {
        await databaseTransaction
          .update(holdings)
          .set({ balanceMinorUnits: nextBalance, balanceSetAt, balanceSetRowId })
          .where(eq(holdings.id, input.holdingId));
      }

      return newRows.length;
    }),
  /**
   * What `importRows` would leave the target holding's balance at for the same
   * input, without writing anything: it runs the SAME reads
   * (`readImportPlanDatabaseTransaction`, refusals included), the same new-row
   * partition and the same `resolveImportBalance`, so the number a user is shown
   * before importing is the number the import then stores.
   */
  previewImportBalance: async (input: ImportInput): Promise<ImportBalancePreview> => {
    const { holding, boundary, rows, existingPostClosingNetMinorUnits, revivedKeys } =
      await readImportPlanDatabaseTransaction(database, input);
    const newRows = await partitionNewRows(database, dedupByConflictKey(rows));

    return importBalancePreviewOf(
      holding,
      resolveImportBalance(
        holding,
        boundary,
        newRows,
        input.closingBalance,
        existingPostClosingNetMinorUnits,
        revivedKeys,
      ),
      input.closingBalance,
    );
  },
} satisfies Repository;
