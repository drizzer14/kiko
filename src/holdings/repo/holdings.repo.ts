import {
  type Repository,
  id,
  database,
  write,
  accounts,
  type HoldingRow,
  holdings,
  pricePoints,
  transactions,
} from '@kiko/db';
import { match } from 'ts-pattern';
import { Money } from '@kiko/currency/money';
import { holdingInstrument } from '@kiko/prices/instrument';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  ownershipMetadata,
  withoutOwnershipChange,
  withEditedOwnershipChange,
  type OwnershipChange,
} from '../ownership';
import {
  asShareMeta,
  asPropertyMeta,
  asTermDepositMeta,
  type PropertyMeta,
  type OwnershipInput,
  type DepositContribution,
  type ExchangeMetadataField,
  type SyncedMetadataField,
  withWalkOwnedMetadataCarried,
  BINANCE_HISTORY_CURSOR_FIELD,
  withWalkOwnedMetadataResetToFloor,
} from '../holding-metadata';
import { isSyncedHolding } from '../deletable';
import { isCurrencyAllowedForHoldingType } from '../holding-currency';

// The next free grid slot for a new holding under one account: one past that
// account's current highest `sortOrder` (or 0 when it has no holdings yet), so
// a freshly created holding appends to the end of that account's grid. Scoped
// per account because each account renders its own holdings grid. Read inside
// the write transaction so a concurrent create cannot observe a stale maximum.
const nextSortOrder = async (
  databaseTransaction: typeof database,
  accountId: string,
): Promise<number> => {
  const rows = await databaseTransaction
    .select({ value: sql<number>`coalesce(max(${holdings.sortOrder}), -1)` })
    .from(holdings)
    .where(eq(holdings.accountId, accountId));

  return (rows.at(0)?.value ?? -1) + 1;
};

type NewHoldingBase = Pick<HoldingRow, 'accountId' | 'name' | 'type' | 'currency'> &
  Partial<Pick<HoldingRow, 'metadata' | 'sortOrder' | 'color'>>;

// `holdingsRepo.create`'s own input: the identity fields above, plus an
// OPTIONAL opening balance as `Money` (kiko-domain "Money at the boundary")
// — converted to minor units, and currency-checked against `currency`,
// inside the write itself, never by the caller.
type NewHolding = NewHoldingBase & {
  openingBalance?: Money;
  // A priced holding's (property_item) first manual price point,
  // written on the holding's own `holding:<id>` instrument in the SAME
  // transaction as the insert (kiko-domain's PriceBook) — so it never reads
  // as "no price yet" the instant it is created. `day`/`price` follow the
  // same `price_points` convention every other write to that table uses
  // (`dayKeyOf`-normalized day, a decimal-string price).
  firstPricePoint?: { day: number; price: string };
};

// The sync upserts below (`upsertMonobank(Many)` / `upsertExchange(Many)`)
// write a RAW provider-given balance straight through every run — never a
// typed opening balance a user entered — so this base stays a plain
// minor-units number, not `Money`.
type SyncBalanceHolding = NewHoldingBase & {
  balanceMinorUnits?: number;
};

/**
 * A synced holding carries its source key in `metadata[metadataField]`:
 * `monobankId` for a Monobank card/jar, `walletAddress` / `binanceAsset` for a
 * balance provider. Upserts match on that key so a re-sync updates the balance
 * in place instead of duplicating the holding.
 */
type SyncedHolding = SyncBalanceHolding & {
  metadataField: SyncedMetadataField;
  metadataKey: string;
  // One-time transition rename: rewrite an EXISTING matched holding's name to
  // `name` ONLY IF its current name still equals this exact old default (a
  // user-edited name never matches). See `renameFromDefault` in provider.ts.
  renameFromDefault?: string;
};

export type MonobankHolding = SyncBalanceHolding & { monobankId: string };

export type ExchangeHolding = SyncBalanceHolding & {
  metadataField: ExchangeMetadataField;
  metadataKey: string;
  renameFromDefault?: string;
};

/**
 * The price-point write a loan EDIT may need on its own `holding:<id>`
 * manual series, alongside the metadata patch — the two must
 * commit in the SAME transaction or the series can drift from what the
 * detail screen reads). `'none'`: no write needed. `'upsert'`: a schedule
 * change into `'none'` writes today's outstanding so the debt never silently
 * reads as 0. `'move'`: a `'none'` loan's principal/start-date edit relocates
 * its start-day point, leaving any later correction alone. `'delete'`: a
 * `'none'` loan moving to a schedule drops its start-day point, which would
 * otherwise anchor the schedule as a correction. See `kiko-domain`'s "Loan
 * form + detail" for the full ruling.
 */
export type LoanPricePointOp =
  | { kind: 'none' }
  | { kind: 'delete'; day: number }
  | { kind: 'upsert'; day: number; price: string; currency: HoldingRow['currency'] }
  | {
      kind: 'move';
      oldDay: number;
      newDay: number;
      price: string;
      currency: HoldingRow['currency'];
    };

type ManualPricePoint = { day: number; price: string; currency: HoldingRow['currency'] };

// Runs on the caller's own write so the point commits with the holding patch
// it belongs to, never apart from it.
const upsertManualPricePoint = (
  databaseTransaction: typeof database,
  holdingId: string,
  point: ManualPricePoint,
) =>
  databaseTransaction
    .insert(pricePoints)
    .values({
      instrument: holdingInstrument(holdingId),
      day: point.day,
      price: point.price,
      currency: point.currency,
      source: 'manual',
    })
    .onConflictDoUpdate({
      target: [pricePoints.instrument, pricePoints.day],
      set: {
        price: sql`excluded.price`,
        currency: sql`excluded.currency`,
        source: sql`excluded.source`,
      },
    });

// Match on `json_extract(metadata, '$.<field>') = key`, scoped to the account;
// update balance + metadata in place on a hit, insert with a fresh sortOrder on
// a miss. The JSON path is bound as a parameter (json_extract takes any text
// expression), so this one helper serves every synced field. The holding's
// name is written on insert and otherwise preserved on update — a user rename
// survives a re-sync — with ONE exception: the transition rename, applied only
// when the stored name still equals `renameFromDefault` (see provider.ts).
//
// The update branch also reads the row's OWN stored metadata (not just
// `id`/`name`) so `withWalkOwnedMetadataCarried` can carry a walk-owned key
// (currently only the Binance history cursor) over the caller's `merged`
// object — a routine balance sync's `metadata: { syncedAt }` would otherwise
// wipe it every run, since `merged` is built from the CALLER-supplied
// `metadata` alone, never the stored row.
const upsertByMetadataKey = async (
  databaseTransaction: typeof database,
  { metadataField, metadataKey, metadata, renameFromDefault, ...rest }: SyncedHolding,
): Promise<void> => {
  const merged = { ...(metadata as Record<string, unknown> | null), [metadataField]: metadataKey };
  const keyMatch = sql`json_extract(${holdings.metadata}, ${`$.${metadataField}`}) = ${metadataKey}`;
  const existing = await databaseTransaction
    .select({ id: holdings.id, name: holdings.name, metadata: holdings.metadata })
    .from(holdings)
    .where(and(eq(holdings.accountId, rest.accountId), keyMatch))
    .limit(1);
  const current = existing.at(0);

  if (current) {
    // Name is preserved on update (a user rename survives a re-sync), EXCEPT the
    // one-time transition rename: rewrite it only when the stored name still
    // equals the exact old default `renameFromDefault` names.
    const rename = renameFromDefault !== undefined && current.name === renameFromDefault;
    await databaseTransaction
      .update(holdings)
      .set({
        balanceMinorUnits: rest.balanceMinorUnits ?? 0,
        metadata: withWalkOwnedMetadataCarried(merged, current.metadata),
        ...(rename ? { name: rest.name } : {}),
      })
      .where(eq(holdings.id, current.id));

    return;
  }

  const sortOrder = rest.sortOrder ?? (await nextSortOrder(databaseTransaction, rest.accountId));
  await databaseTransaction
    .insert(holdings)
    .values({ id: id(), ...rest, metadata: merged, sortOrder });
};

// Append one contribution to a term deposit and rewrite its metadata, operating
// on an EXISTING transaction handle so a caller (e.g. `recordExchange`) can run
// it inside a larger single transaction. `appendDepositContribution` wraps this
// in its own `write(...)`. Throws on a non-deposit or invalid/absent metadata.
export const appendDepositContributionDatabaseTransaction = async (
  databaseTransaction: typeof database,
  holdingId: string,
  contribution: DepositContribution,
): Promise<void> => {
  const rows = await databaseTransaction.select().from(holdings).where(eq(holdings.id, holdingId));
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

  await databaseTransaction
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

export type ShareQuoteCurrencyUpdate = { holdingId: string; symbol: string; quoteCurrency: string };

/**
 * Records the price unit the share price refresh resolved for an EODHD share
 * that had none, inside that refresh's own `write()`. The metadata is re-read
 * there: a lot added while the refresh was on the network is kept, and a share
 * whose symbol was edited meanwhile never takes the old symbol's unit.
 */
export const setShareQuoteCurrencyDatabaseTransaction = async (
  databaseTransaction: typeof database,
  { holdingId, symbol, quoteCurrency }: ShareQuoteCurrencyUpdate,
): Promise<void> => {
  const rows = await databaseTransaction
    .select({ metadata: holdings.metadata })
    .from(holdings)
    .where(eq(holdings.id, holdingId));
  const meta = asShareMeta(rows.at(0)?.metadata);

  if (meta?.quoteSource !== 'eodhd' || meta.symbol !== symbol || meta.quoteCurrency !== undefined) {
    return;
  }

  const metadata = { ...meta, quoteCurrency };

  if (asShareMeta(metadata) === null) {
    return;
  }

  await databaseTransaction.update(holdings).set({ metadata }).where(eq(holdings.id, holdingId));
};

// Clears `loanHoldingId`/`loanLinkSource` on every transaction row that
// still points at one of `holdingIds`. A shared Tx helper (not private to
// `holdingsRepo.remove`) so `accountsRepo.remove` runs the SAME cascade for
// every holding a deleted debt account owned, in the SAME transaction as
// the account delete — a loan holding removed either way never leaves a
// dangling link on another holding's payment rows. A no-op when
// `holdingIds` is empty or names no loan holding.
export const clearLoanLinksForHoldingsDatabaseTransaction = async (
  databaseTransaction: typeof database,
  holdingIds: string[],
): Promise<void> => {
  if (holdingIds.length === 0) {
    return;
  }

  await databaseTransaction
    .update(transactions)
    .set({ loanHoldingId: null, loanLinkSource: null })
    .where(inArray(transactions.loanHoldingId, holdingIds));
};

type OwnershipRewrite = (meta: PropertyMeta) => {
  changes: OwnershipChange[];
  input: OwnershipInput;
};

// Reads the ownership list from the row stored at the time of the write, never
// from a screen's cached copy, so a change another write removed is not put
// back. The metadata is rebuilt from the parsed meta, the same clean shape the
// property form saves.
const rewriteOwnership = (holdingId: string, rewrite: OwnershipRewrite) =>
  write(async (databaseTransaction) => {
    const rows = await databaseTransaction
      .select()
      .from(holdings)
      .where(eq(holdings.id, holdingId));
    const row = rows.at(0);

    if (row?.type !== 'property_item') {
      throw new Error('rewriteOwnership: not a property');
    }

    const meta = asPropertyMeta(row.metadata);

    if (meta === null) {
      throw new Error('rewriteOwnership: invalid property metadata');
    }

    const { changes, input } = rewrite(meta);

    await databaseTransaction
      .update(holdings)
      .set({
        metadata: {
          category: meta.category,
          lots: meta.lots,
          ...ownershipMetadata(changes, input),
        },
      })
      .where(eq(holdings.id, holdingId));
  });

// Skip the write entirely when the synced balance already matches —
// `selectCardsToFetch` already skips a card whose bank-reported balance is
// unchanged, but the daily full fetch still calls `setSyncedBalance` for
// EVERY held card. Without this, that unconditional write fired the
// `holdings` reactive-query hook for every subscriber, on every sync, for
// every card, even though nothing changed. `IS NOT` (not `!=`), since a
// never-synced-through holding's marker starts NULL and SQL's `!=` against
// NULL is never true. Exported so
// `holdings.repo.synced-balance-no-op.test.ts` can build the exact same
// UPDATE statement Drizzle would, instead of hand-transcribing its SQL.
export const syncedBalanceUpdateWhere = (holdingId: string, minorUnits: number) =>
  and(eq(holdings.id, holdingId), sql`${holdings.syncedBalanceMinorUnits} IS NOT ${minorUnits}`);

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
   * The DISTINCT currencies among ACTIVE holdings — open (no `closedAt`) AND
   * whose parent account is not archived, the same "counts toward net worth"
   * definition `activeHoldings` (`src/rates/active-holdings/`) applies
   * elsewhere. The one cheap gate query a rate/price refresh reads before
   * deciding whether it needs to run at all (kiko-architecture: app-open and
   * refresh work is gated on data presence). A caller derives BOTH gates from
   * this single read: the fiat leg needs a live rate only when some currency
   * here differs from the base (display) currency; the crypto leg needs
   * CoinGecko only when the result, filtered to `cryptoCurrencyOptions`, is
   * non-empty (and, filtered further, names exactly which coins to fetch —
   * never one nobody holds). One `SELECT DISTINCT` with a join, never a
   * per-holding loop.
   */
  openCurrenciesQuery: () =>
    database
      .selectDistinct({ currency: holdings.currency })
      .from(holdings)
      .innerJoin(accounts, eq(holdings.accountId, accounts.id))
      .where(and(isNull(holdings.closedAt), isNull(accounts.archivedAt))),
  /**
   * The DISTINCT currencies among EVERY holding, open AND closed — the
   * history currency gate's own input (`historyCurrencies`,
   * `open-currencies-gate.ts`): a closed holding still needs its own
   * `X:UAH` history rows for the net-worth line's past buckets, so this
   * query has no `closedAt`/archived-account filter at all, unlike
   * `openCurrenciesQuery` above.
   */
  historyCurrenciesQuery: () =>
    database.selectDistinct({ currency: holdings.currency }).from(holdings),
  /**
   * The share price refresh's gate: every share that counts toward net worth
   * (open, under an unarchived account). A closed share keeps the prices it
   * already has, since every refresh spends the user's scarce EODHD calls.
   */
  activeSharesQuery: () =>
    database
      .select({ id: holdings.id, currency: holdings.currency, metadata: holdings.metadata })
      .from(holdings)
      .innerJoin(accounts, eq(holdings.accountId, accounts.id))
      .where(
        and(eq(holdings.type, 'share'), isNull(holdings.closedAt), isNull(accounts.archivedAt)),
      ),
  /**
   * Every OPEN loan holding — the loan-payment matcher's own gate query
   * (`src/loans/payment-matcher/`, `src/loans/use-loan-auto-link/`): it reads
   * this FIRST and returns early when it is empty, so a user with no debts
   * never pays for the (larger) transaction-candidate query the matcher would
   * otherwise run next (P-NOWORK). A CLOSED loan is excluded: a closed loan
   * has nothing left to backfill, mirroring `buildLoanOptions`'s own
   * (transaction-form) closed-holding exclusion.
   */
  loanHoldingsQuery: () =>
    database
      .select()
      .from(holdings)
      .where(and(eq(holdings.type, 'loan'), isNull(holdings.closedAt))),
  /**
   * Converts a stored row's raw `balanceMinorUnits` column into `Money`, in
   * the row's own currency — kiko-domain's "Money at the boundary" (a repo
   * is the only place that conversion may happen). Every non-repo reader
   * that needs a holding's CURRENT stored balance as a value goes through
   * this, never `row.balanceMinorUnits` directly.
   */
  balanceOf: (row: Pick<HoldingRow, 'currency' | 'balanceMinorUnits'>): Money =>
    Money.of(row.currency, row.balanceMinorUnits),
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
   * it, `createHoldingValuer` (statistics/holding-value-at/holding-value-at.ts)
   * back-derives an opening balance out of `balance - sum(transactions)` that
   * no row accounts for, and the historical net-worth series carries an
   * unexplained step.
   * The row is inserted directly rather than through
   * `transactionsRepo.recordManual`, which would add the amount to the balance
   * this insert has already set. It is the SYNC upserts (`upsertMonobank` /
   * `upsertExchange`), not this function, that write a provider-owned balance,
   * so no sync path is affected.
   *
   * The same non-zero opening balance also stamps `holdings.balanceSetAt` —
   * `transactionsRepo.importRows`'s own doc comment is the full statement of
   * why. `accountsRepo.createCashAccount` (a cash account's first holding)
   * stamps it too, for the same reason: a typed starting balance IS a
   * hand-set balance, whichever create path writes it. Its row carries
   * `transactions.setsBalance` and is the holding's `balanceSetRowId`.
   */
  create: ({ firstPricePoint, openingBalance, ...input }: NewHolding): Promise<string> =>
    write(async (databaseTransaction) => {
      if (openingBalance !== undefined && openingBalance.currency !== input.currency) {
        throw new Error(
          'holdingsRepo.create: opening balance currency does not match the holding currency',
        );
      }

      if (!isCurrencyAllowedForHoldingType(input.type, input.currency)) {
        throw new Error(
          `holdingsRepo.create: a ${input.type} holding cannot hold ${input.currency}`,
        );
      }

      const holdingId = id();
      const openingRowId = id();
      const sortOrder =
        input.sortOrder ?? (await nextSortOrder(databaseTransaction, input.accountId));
      const openingBalanceMinorUnits = openingBalance?.minorUnits ?? 0;
      const now = Date.now();

      await databaseTransaction.insert(holdings).values({
        id: holdingId,
        ...input,
        balanceMinorUnits: openingBalanceMinorUnits,
        sortOrder,
        balanceSetAt: openingBalanceMinorUnits !== 0 ? now : null,
        balanceSetRowId: openingBalanceMinorUnits !== 0 ? openingRowId : null,
      });

      if (openingBalanceMinorUnits !== 0) {
        await databaseTransaction.insert(transactions).values({
          id: openingRowId,
          holdingId,
          amountMinorUnits: openingBalanceMinorUnits,
          time: now,
          description: '',
          category: null,
          source: 'manual',
          setsBalance: true,
        });
      }

      if (firstPricePoint) {
        await databaseTransaction.insert(pricePoints).values({
          instrument: holdingInstrument(holdingId),
          day: firstPricePoint.day,
          price: firstPricePoint.price,
          currency: input.currency,
          source: 'manual',
        });
      }

      return holdingId;
    }),
  updateName: (holdingId: string, name: string) =>
    write((databaseTransaction) =>
      databaseTransaction.update(holdings).set({ name }).where(eq(holdings.id, holdingId)),
    ),
  /**
   * Generic partial update for a holding row (name, color, metadata), mirroring
   * `accountsRepo.update`. The icon routes through `setIcon` instead (so a
   * cleared icon persists an explicit null), the same split the create form
   * uses.
   *
   * A patch that touches the balance belongs on `updateWithBalanceDelta`
   * below, NOT here: this bare `set(patch)` moves a balance with no ledger
   * row to explain it, which breaks the kiko-domain invariant. `update` stays
   * bare on purpose for the non-balance callers (`setIcon`/`setColor`-style
   * field writes, the sync's own writes, reorder), which must never start
   * emitting transactions.
   */
  update: (holdingId: string, patch: Partial<HoldingRow>) =>
    write((databaseTransaction) =>
      databaseTransaction.update(holdings).set(patch).where(eq(holdings.id, holdingId)),
    ),
  /**
   * A ledgerless holding's EDIT whose metadata keeps a key another write can
   * add while the form is open (the register refresh's kept bond schedule):
   * the metadata is built from the row stored at the time of the write, never
   * the form's seed, so Save cannot write the seed back over it. Never
   * touches the balance, so no ledger row either.
   */
  updateMetadataFromStored: (
    holdingId: string,
    patch: Pick<HoldingRow, 'name' | 'color'>,
    buildMetadata: (storedMetadata: unknown) => Record<string, unknown>,
  ) =>
    write(async (databaseTransaction) => {
      const rows = await databaseTransaction
        .select({ metadata: holdings.metadata })
        .from(holdings)
        .where(eq(holdings.id, holdingId));

      await databaseTransaction
        .update(holdings)
        .set({ ...patch, metadata: buildMetadata(rows.at(0)?.metadata) })
        .where(eq(holdings.id, holdingId));
    }),
  /**
   * Update a holding's editable fields and, when `balance` (`Money`) is part
   * of the patch and differs in minor units from what is stored, write the
   * DIFFERENCE as a `manual` transaction — both in ONE op-sqlite transaction,
   * so the balance and the ledger row can never desync on a partial failure.
   * Throws when `balance.currency` disagrees with the holding's own stored
   * currency (never fires for a valid caller, which always builds it in the
   * holding's own, locked-in-the-form currency).
   *
   * WHY: kiko-domain's invariant is that a manual balance adjustment always
   * writes a manual transaction, so a holding's balance history stays derivable
   * from its transactions. `createHoldingValuer`
   * (statistics/holding-value-at/holding-value-at.ts) back-derives each
   * holding's opening balance as
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
   *
   * A non-zero delta also stamps `holdings.balanceSetAt` at this edit's own
   * `time`, in the SAME `.set(...)` as `patch` — `transactionsRepo.importRows`'s
   * own doc comment is the full statement of why — and points
   * `holdings.balanceSetRowId` at the new row, which carries
   * `transactions.setsBalance`: this edit is now the holding's current set.
   * An older set's row keeps its mark, so its re-date or delete never moves
   * the balance either.
   */
  updateWithBalanceDelta: (
    holdingId: string,
    patch: Omit<Partial<HoldingRow>, 'balanceMinorUnits'> & { balance?: Money },
    time: number,
  ) =>
    write(async (databaseTransaction) => {
      const { balance, ...rest } = patch;
      const rows = await databaseTransaction
        .select({ currency: holdings.currency, balanceMinorUnits: holdings.balanceMinorUnits })
        .from(holdings)
        .where(eq(holdings.id, holdingId))
        .limit(1);
      const row = rows.at(0);

      if (balance !== undefined && row !== undefined && balance.currency !== row.currency) {
        throw new Error(
          'holdingsRepo.updateWithBalanceDelta: balance currency does not match the holding currency',
        );
      }

      const stored = row?.balanceMinorUnits;
      const nextBalanceMinorUnits = balance?.minorUnits;
      const delta =
        nextBalanceMinorUnits !== undefined && stored !== undefined
          ? nextBalanceMinorUnits - stored
          : 0;
      const adjustmentRowId = id();

      await databaseTransaction
        .update(holdings)
        .set({
          ...rest,
          ...(nextBalanceMinorUnits !== undefined
            ? { balanceMinorUnits: nextBalanceMinorUnits }
            : {}),
          balanceSetAt: delta !== 0 ? time : undefined,
          balanceSetRowId: delta !== 0 ? adjustmentRowId : undefined,
        })
        .where(eq(holdings.id, holdingId));

      if (delta === 0) {
        return;
      }

      await databaseTransaction.insert(transactions).values({
        id: adjustmentRowId,
        holdingId,
        amountMinorUnits: delta,
        time,
        description: '',
        category: null,
        source: 'manual',
        setsBalance: true,
      });
    }),
  /**
   * A loan EDIT's metadata patch plus its `LoanPricePointOp`, in ONE
   * transaction — a loan is ledgerless, so this never touches
   * `balanceMinorUnits`/`transactions` the way `updateWithBalanceDelta` does;
   * it exists instead of reusing that function because a loan's manual
   * `holding:<id>` series has to stay consistent with the SAME edit that
   * changes the metadata, or the two can drift on a partial failure. See
   * `LoanPricePointOp`'s own doc comment for what each op writes.
   *
   * `clearAutoLinks` (default `false` so the 3-arg call every other caller
   * still uses is unaffected) clears ONLY this loan's own AUTO links
   * (`loanLinkSource = 'auto'`) in the SAME transaction — a manual link or a
   * rejected row is untouched. The caller (`use-loan-fields.ts`'s
   * `saveEdit`) passes `true` when the edit changed the loan's own
   * amortization schedule (`loanEditInvalidatesAutoLinks`'s installment
   * comparison) or one of rule 3's own signals (`paymentHoldingId`,
   * `lenderIban`, `lenderName`): a previously-linked AUTO row proved rules
   * 1/2 against the OLD schedule, and left in place it would count as
   * "taken" (`installmentIsTaken`, `payment-matcher.ts`) under that stale
   * schedule forever, even once it no longer corresponds to any real
   * installment of the NEW one. Clearing it here, before the fire-and-forget
   * matcher re-run that follows a loan edit, lets that re-run recompute
   * cleanly against the new schedule.
   */
  updateLoan: (
    holdingId: string,
    patch: Partial<HoldingRow>,
    pricePointOp: LoanPricePointOp,
    clearAutoLinks = false,
  ) =>
    write(async (databaseTransaction) => {
      await databaseTransaction.update(holdings).set(patch).where(eq(holdings.id, holdingId));

      if (clearAutoLinks) {
        await databaseTransaction
          .update(transactions)
          .set({ loanHoldingId: null, loanLinkSource: null })
          .where(
            and(eq(transactions.loanHoldingId, holdingId), eq(transactions.loanLinkSource, 'auto')),
          );
      }

      const deletePointOn = (day: number) =>
        databaseTransaction
          .delete(pricePoints)
          .where(
            and(eq(pricePoints.instrument, holdingInstrument(holdingId)), eq(pricePoints.day, day)),
          );

      const point = await match(pricePointOp)
        .with({ kind: 'none' }, () => null)
        .with({ kind: 'delete' }, async (operation) => {
          await deletePointOn(operation.day);

          return null;
        })
        .with({ kind: 'upsert' }, (operation) => ({
          day: operation.day,
          price: operation.price,
          currency: operation.currency,
        }))
        .with({ kind: 'move' }, async (operation) => {
          await deletePointOn(operation.oldDay);

          return { day: operation.newDay, price: operation.price, currency: operation.currency };
        })
        .exhaustive();

      if (point === null) {
        return;
      }

      await upsertManualPricePoint(databaseTransaction, holdingId, point);
    }),
  /**
   * A holding EDIT's patch plus, when `point` is set, one point on the
   * holding's own `holding:<id>` manual series, in ONE transaction. A share
   * switched from EODHD to manual carries its last EODHD price over this
   * way, so its value never drops to cost basis between the two series.
   */
  updateWithManualPricePoint: (
    holdingId: string,
    patch: Partial<HoldingRow>,
    point: ManualPricePoint | null,
  ) =>
    write(async (databaseTransaction) => {
      await databaseTransaction.update(holdings).set(patch).where(eq(holdings.id, holdingId));

      if (point !== null) {
        await upsertManualPricePoint(databaseTransaction, holdingId, point);
      }
    }),
  /**
   * Sets the holding's icon (an SF Symbol name) or, with `null`, clears it back
   * to no custom icon. The display layer falls back to a type-derived default
   * when the stored icon is null.
   */
  setIcon: (holdingId: string, icon: string | null) =>
    write((databaseTransaction) =>
      databaseTransaction.update(holdings).set({ icon }).where(eq(holdings.id, holdingId)),
    ),
  /**
   * Sets the holding's color (an entity-color hex) or, with `null`, clears it
   * back to no custom color. The display layer falls back to a type-derived
   * default when the stored color is null — the same fallback the icon uses.
   * Mirrors `setIcon` so the detail header can edit the color exactly as the
   * create form does.
   */
  setColor: (holdingId: string, color: string | null) =>
    write((databaseTransaction) =>
      databaseTransaction.update(holdings).set({ color }).where(eq(holdings.id, holdingId)),
    ),
  /**
   * Appends one contribution to a term deposit and rewrites its metadata in a
   * single transaction. Metadata is rebuilt cleanly from the parsed meta, so
   * any legacy `principalMinorUnits`/`startDate` keys are dropped rather than
   * carried forward. Contributions are kept sorted by date ascending.
   */
  appendDepositContribution: (holdingId: string, contribution: DepositContribution) =>
    write((databaseTransaction) =>
      appendDepositContributionDatabaseTransaction(databaseTransaction, holdingId, contribution),
    ),
  /**
   * Replaces a property's ownership change on `fromDay` with `change`, typed
   * as `input` (`withEditedOwnershipChange`). Takes the day key, not a row:
   * the list is re-read inside the write.
   */
  editOwnershipChange: (
    holdingId: string,
    fromDay: number,
    change: OwnershipChange,
    input: OwnershipInput,
  ) =>
    rewriteOwnership(holdingId, (meta) => ({
      changes: withEditedOwnershipChange(meta.ownership ?? [], fromDay, change),
      input,
    })),
  /**
   * Removes a property's ownership change on `day`; removing the last one
   * leaves the whole asset. The list is re-read inside the write.
   */
  removeOwnershipChange: (holdingId: string, day: number) =>
    rewriteOwnership(holdingId, (meta) => ({
      changes: withoutOwnershipChange(meta.ownership ?? [], day),
      input: meta.ownershipInput ?? 'percent',
    })),
  /**
   * Deletes a manual holding and all of its transactions in one transaction.
   * Refuses a holding whose balance is owned by a LIVE sync, so a synced row is
   * left untouched. That ownership is read from the holding's ACCOUNT (its
   * `institution`, fetched inside the same transaction) as well as the
   * holding's own sync key — a disconnected account keeps its holdings' keys so
   * a reconnect re-adopts them, and those rows are deletable again.
   */
  remove: (holdingId: string) =>
    write(async (databaseTransaction) => {
      const rows = await databaseTransaction
        .select()
        .from(holdings)
        .where(eq(holdings.id, holdingId));
      const row = rows.at(0);

      if (!row) {
        return;
      }
      const accountRows = await databaseTransaction
        .select({ institution: accounts.institution })
        .from(accounts)
        .where(eq(accounts.id, row.accountId));

      if (isSyncedHolding(row, accountRows.at(0))) {
        throw new Error('remove: cannot delete a synced holding');
      }
      await databaseTransaction.delete(transactions).where(eq(transactions.holdingId, holdingId));
      // A loan holding is ledgerless, but OTHER holdings' payment rows can
      // point back at it via `loanHoldingId`. Clear those links in the SAME
      // transaction — never leaving a dangling id — so a previously-linked
      // payment reverts to counting as normal spending. A no-op for every
      // non-loan holding, since nothing ever points a `loanHoldingId` at one.
      await clearLoanLinksForHoldingsDatabaseTransaction(databaseTransaction, [holdingId]);
      // A priced holding (property_item) has no transactions, but it may
      // have its own price series on `holding:<id>` — cleared here, inline on
      // `tx` (not through `pricePointsRepo.removeInstrument`, which would open
      // its own transaction), so a deleted holding never leaves an orphaned
      // series behind.
      await databaseTransaction
        .delete(pricePoints)
        .where(eq(pricePoints.instrument, holdingInstrument(holdingId)));
      await databaseTransaction.delete(holdings).where(eq(holdings.id, holdingId));
    }),
  /**
   * Close a set of holdings (stamp `closedAt` with the current time) in ONE
   * transaction, so a bulk close commits all-or-nothing and fires the reactive
   * `holdings` callback once rather than once per row (kiko-architecture: one
   * transaction for a bulk write). The Monobank sync's stale-holding
   * reconciliation calls this for a card/jar the snapshot no longer returns, so
   * a closed card stops counting toward net worth (kiko-domain). An empty set is
   * a no-op.
   */
  closeMany: (holdingIds: string[]) =>
    write(async (databaseTransaction) => {
      if (holdingIds.length === 0) {
        return;
      }
      await databaseTransaction
        .update(holdings)
        .set({ closedAt: sql`(unixepoch() * 1000)` })
        .where(inArray(holdings.id, holdingIds));
    }),
  upsertMonobank: ({ monobankId, ...rest }: MonobankHolding) =>
    write((databaseTransaction) =>
      upsertByMetadataKey(databaseTransaction, {
        ...rest,
        metadataField: 'monobankId',
        metadataKey: monobankId,
      }),
    ),
  /**
   * Upsert every Monobank card/jar of ONE client-info snapshot in a SINGLE
   * transaction, so the reactive `holdings` callback fires ONCE for the whole
   * fast phase instead of once per card. The per-card `upsertMonobank` loop the
   * sync used before fanned out N+M separate transactions in a tight burst at
   * sync start, and each reactive fire re-ran the Home screen's O(n) render —
   * starving the JS thread and stuttering the pull spinner. Atomic is also
   * strictly better: the balance snapshot lands all-or-nothing.
   */
  upsertMonobankMany: (holdings: MonobankHolding[]) =>
    write(async (databaseTransaction) => {
      for (const { monobankId, ...rest } of holdings) {
        await upsertByMetadataKey(databaseTransaction, {
          ...rest,
          metadataField: 'monobankId',
          metadataKey: monobankId,
        });
      }
    }),
  /**
   * Reset the Binance history-walk cursor to `floorMs` on every holding of one
   * account — called on a Binance disconnect so a stale, FORWARD watermark
   * cannot leak into a reconnected DIFFERENT Binance account's fresh walk
   * (which would otherwise fall back to `latestTransactionTime` and skip that
   * account's own older history). Every OTHER metadata key (`binanceAsset`
   * among them) is untouched, so a same-account reconnect still re-adopts the
   * row and simply re-walks from the floor (idempotent). A holding that never
   * carried the key is skipped entirely — no redundant write, no reactive
   * `holdings` fire for it.
   */
  resetBinanceHistoryCursor: (accountId: string, floorMs: number) =>
    write(async (databaseTransaction) => {
      const rows = await databaseTransaction
        .select({ id: holdings.id, metadata: holdings.metadata })
        .from(holdings)
        .where(eq(holdings.accountId, accountId));

      for (const row of rows) {
        const reset = withWalkOwnedMetadataResetToFloor(row.metadata, floorMs);

        if (reset === undefined) {
          continue;
        }

        await databaseTransaction
          .update(holdings)
          .set({ metadata: reset })
          .where(eq(holdings.id, row.id));
      }
    }),
  /**
   * Advance the Binance history-walk cursor on one holding's metadata,
   * merging it into whatever is currently stored rather than replacing the
   * whole object — the write-side counterpart of `withWalkOwnedMetadataCarried`,
   * which only stops a DIFFERENT write (a balance sync) from wiping this value;
   * this is the one call that actually sets it. A walk holds the account's
   * credentials for its whole run, so a disconnect can commit WHILE a walk is
   * still in flight; the read-then-write below checks, inside the SAME write,
   * that the holding's account is STILL `institution = 'binance'` and is a
   * no-op otherwise — a late-arriving window commit from a walk started
   * before the disconnect must never resurrect a watermark on an
   * already-disconnected account (undoing `resetBinanceHistoryCursor`'s own
   * floor write, which runs as part of that same disconnect).
   */
  setBinanceHistoryCursor: (holdingId: string, cursorMs: number) =>
    write(async (databaseTransaction) => {
      const rows = await databaseTransaction
        .select({ metadata: holdings.metadata, institution: accounts.institution })
        .from(holdings)
        .innerJoin(accounts, eq(holdings.accountId, accounts.id))
        .where(eq(holdings.id, holdingId));
      const row = rows.at(0);

      if (row === undefined || row.institution !== 'binance') {
        return;
      }

      const stored = (row.metadata as Record<string, unknown> | null) ?? {};

      await databaseTransaction
        .update(holdings)
        .set({ metadata: { ...stored, [BINANCE_HISTORY_CURSOR_FIELD]: cursorMs } })
        .where(eq(holdings.id, holdingId));
    }),
  /**
   * Advance the crash-safe statement-import marker (`syncedBalanceMinorUnits`,
   * see db/schema.ts) for one Monobank card to the balance whose statements the
   * sync just imported. The sync calls this ONLY after a card's statement
   * fetch+upsert commits, so an interrupted run leaves the marker behind and the
   * next run re-imports the card rather than skipping it on an unchanged display
   * balance. A bare field write — it moves no money and emits no ledger row, so
   * it stays off `updateWithBalanceDelta`. Distinct from `balanceMinorUnits`,
   * which `upsertMonobank` writes up front from /client-info every run.
   * Throws when `balance.currency` disagrees with the holding's own stored
   * currency — never fires for a valid caller (the Monobank sync always
   * builds it in the card's own currency).
   */
  setSyncedBalance: (holdingId: string, balance: Money) =>
    write(async (databaseTransaction) => {
      const rows = await databaseTransaction
        .select({ currency: holdings.currency })
        .from(holdings)
        .where(eq(holdings.id, holdingId))
        .limit(1);
      const row = rows.at(0);

      if (row !== undefined && balance.currency !== row.currency) {
        throw new Error(
          'holdingsRepo.setSyncedBalance: balance currency does not match the holding currency',
        );
      }

      await databaseTransaction
        .update(holdings)
        .set({ syncedBalanceMinorUnits: balance.minorUnits })
        .where(syncedBalanceUpdateWhere(holdingId, balance.minorUnits));
    }),
  /**
   * Balance-provider counterpart of `upsertMonobank`: one live balance snapshot
   * per holding, matched on `walletAddress` / `binanceAsset`. A provider may
   * write MORE than one — Binance splits into a Spot, a Funding and an Earn
   * holding, each its own `binanceAsset` match key (see `binance.provider.ts`);
   * a wallet writes one. No transaction import — a wallet or exchange gives a
   * number, not a statement.
   */
  upsertExchange: (holding: ExchangeHolding) =>
    write((databaseTransaction) => upsertByMetadataKey(databaseTransaction, holding)),
  /**
   * Upsert EVERY balance-provider snapshot from ONE sync run in a SINGLE
   * transaction, mirroring `upsertMonobankMany` — the per-balance
   * `upsertExchange` loop the crypto sync used before fired N separate
   * transactions in a tight burst (one per returned balance: a wallet writes
   * one, but Binance's Spot/Funding/Earn split writes several), each its own
   * reactive `holdings` fire. Atomic is also strictly better: a sync's whole
   * balance snapshot lands all-or-nothing.
   */
  upsertExchangeMany: (holdingsList: ExchangeHolding[]) =>
    write(async (databaseTransaction) => {
      for (const holding of holdingsList) {
        await upsertByMetadataKey(databaseTransaction, holding);
      }
    }),
  /**
   * Persist a drag-and-drop reorder of one account's holdings grid.
   * `orderedIds` is the full new front-to-back order of that account's visible
   * holdings; each row's `sortOrder` is rewritten to its 0-based index in one
   * transaction so the `listByAccountQuery` ordering matches the grid the user
   * just arranged. Only the passed holdings are touched, so other accounts'
   * holdings are unaffected.
   */
  reorder: (orderedIds: string[]) =>
    write(async (databaseTransaction) => {
      for (let index = 0; index < orderedIds.length; index += 1) {
        await databaseTransaction
          .update(holdings)
          .set({ sortOrder: index })
          .where(eq(holdings.id, orderedIds[index]));
      }
    }),
} satisfies Repository;
