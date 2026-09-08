import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { match } from 'ts-pattern';

import { database, write } from '../db/client';
import { id } from '../db/id';
import {
  accounts,
  categoryOverrides,
  type HoldingRow,
  holdings,
  type TransactionRow,
  transactions,
} from '../db/schema';
import { isSyncedTransaction } from '../holdings/deletable';
import type { ExchangeConvertDirection } from '../holdings/exchange-convert';
import { exchangeReceivePath } from '../holdings/exchange-destination';
import type { DepositContribution } from '../holdings/holding-metadata';
import { normalizeTransactionName } from '../transactions/normalize-name';

import { appendDepositContributionTx } from './holdings.repo';
import type { Repository } from './repository';

type NewTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time' | 'source'> &
  Partial<
    Pick<
      TransactionRow,
      'description' | 'category' | 'mcc' | 'hold' | 'counterIban' | 'comment' | 'externalId'
    >
  >;

type ManualTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time'> &
  Partial<Pick<TransactionRow, 'description' | 'category' | 'exchangeCounterpartHoldingId'>>;

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

// Insert a manual transaction and adjust its holding's balance on an EXISTING
// transaction handle. The balance base is read from the DB *inside* the same
// transaction, never from a render snapshot, so concurrent writes cannot clobber
// each other with a stale read-modify-write. `recordManual` wraps this in its
// own `write(...)`; `recordExchange` calls it directly for the source leg and
// for a plain destination leg, keeping both legs in one transaction.
//
// The row carries its OWN category here — a picked category is never lost to
// a blank description or a cancelled override sheet. `upsertCategoryOverride`
// (category-overrides.repo.ts) governs a SEPARATE concern: propagating that
// pick to every OTHER same-name row, not whether this row itself is
// categorised.
const recordManualTx = async (
  tx: typeof database,
  {
    holdingId,
    amountMinorUnits,
    time,
    description,
    category,
    exchangeCounterpartHoldingId,
  }: ManualTransaction,
): Promise<void> => {
  await tx.insert(transactions).values({
    id: id(),
    holdingId,
    amountMinorUnits,
    time,
    description: description ?? '',
    category: category ?? null,
    exchangeCounterpartHoldingId: exchangeCounterpartHoldingId ?? null,
    source: 'manual',
  });

  const current = await tx
    .select({ balanceMinorUnits: holdings.balanceMinorUnits })
    .from(holdings)
    .where(eq(holdings.id, holdingId))
    .limit(1);
  const base = current.at(0)?.balanceMinorUnits ?? 0;

  await tx
    .update(holdings)
    .set({ balanceMinorUnits: base + amountMinorUnits })
    .where(eq(holdings.id, holdingId));
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
const markExistingLegTx = async (
  tx: typeof database,
  { existingTransactionId, counterpartHoldingId }: ExchangeCounterpartInput,
): Promise<void> => {
  const existingRows = await tx
    .select({ source: transactions.source })
    .from(transactions)
    .where(eq(transactions.id, existingTransactionId))
    .limit(1);

  if (existingRows.at(0)?.source !== 'manual') {
    return;
  }

  await tx
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

/**
 * How many of these rows the upsert will INSERT rather than refresh. Read inside
 * the caller's own transaction, so the count can never disagree with the write
 * it describes.
 */
const countNewRows = async (tx: typeof database, inputs: NewTransaction[]): Promise<number> => {
  const externalIds = inputs
    .map((input) => input.externalId)
    .filter((externalId): externalId is string => Boolean(externalId));

  if (externalIds.length === 0) {
    return inputs.length;
  }

  const sources = Array.from(
    new Set(inputs.filter((input) => conflictKeyOf(input) !== null).map((input) => input.source)),
  );
  // BOTH halves of the unique key are constrained, so SQLite SEARCHes
  // `transactions_source_external` on its leading `source` column; an
  // `external_id`-only predicate cannot use that index and SCANs it instead
  // (verified with EXPLAIN QUERY PLAN).
  const existing = await tx
    .select({ source: transactions.source, externalId: transactions.externalId })
    .from(transactions)
    .where(
      and(inArray(transactions.source, sources), inArray(transactions.externalId, externalIds)),
    );
  const known = new Set(existing.map((row) => `${row.source}:${row.externalId}`));

  return inputs.filter((input) => {
    const key = conflictKeyOf(input);

    return key === null || !known.has(key);
  }).length;
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
        category: transactions.category,
        accountId: accounts.id,
        accountName: accounts.name,
        holdingName: holdings.name,
        // Home reads the holding type to drop the HH:MM stamp on a
        // term_deposit/bond row (those are day-granular events).
        holdingType: holdings.type,
      })
      .from(transactions)
      .innerJoin(holdings, eq(transactions.holdingId, holdings.id))
      .innerJoin(accounts, eq(holdings.accountId, accounts.id))
      .orderBy(desc(transactions.time)),
  add: (input: NewTransaction) =>
    write((tx) => tx.insert(transactions).values({ id: id(), ...input })),
  /**
   * Record a manual transaction and adjust its holding's balance in ONE
   * op-sqlite transaction, so the ledger and the balance can never desync
   * on a partial failure. The balance base is read from the DB *inside*
   * the same transaction — not from a render snapshot — so concurrent
   * writes cannot clobber each other with a stale read-modify-write.
   */
  recordManual: (input: ManualTransaction) => write((tx) => recordManualTx(tx, input)),
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
    write(async (tx) => {
      if (input.destinationHoldingId === input.sourceHoldingId) {
        throw new Error('recordExchange: destination equals source');
      }

      await recordManualTx(tx, {
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
          recordManualTx(tx, {
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

          return appendDepositContributionTx(tx, input.destinationHoldingId, contribution);
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
   * bank owns it (see `markExistingLegTx`).
   * Balances are read INSIDE the transaction, never from a render snapshot,
   * exactly as `recordManual` does.
   */
  recordExchangeCounterpart: (input: ExchangeCounterpartInput) =>
    write(async (tx) => {
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
          recordManualTx(tx, {
            holdingId: input.counterpartHoldingId,
            amountMinorUnits: -input.amountMinorUnits,
            time: input.time,
            exchangeCounterpartHoldingId: input.existingHoldingId,
          }),
        )
        .with('record-destination', () =>
          match(exchangeReceivePath(input.counterpartType))
            .with('plain', () =>
              recordManualTx(tx, {
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

              return appendDepositContributionTx(tx, input.counterpartHoldingId, contribution);
            })
            .with('excluded', () => {
              throw new Error(
                `recordExchangeCounterpart: ${input.counterpartType} is not a valid destination`,
              );
            })
            .exhaustive(),
        )
        .exhaustive();

      await markExistingLegTx(tx, input);
    }),
  /**
   * Edit an existing MANUAL transaction and keep its holding's stored balance
   * consistent, all in ONE op-sqlite transaction. The row is re-read *inside*
   * the transaction so the balance delta is computed against the amount that is
   * actually persisted, never a stale render snapshot. Only the difference
   * (newAmount - oldAmount) moves the balance, so a description/time-only edit
   * (zero delta) leaves the balance untouched. A synced (monobank) transaction
   * is never mutated by this path — its amount is owned by the bank import — and
   * a missing id is a no-op rather than an error.
   */
  update: ({ transactionId, amountMinorUnits, time, description }: TransactionEdit) =>
    write(async (tx) => {
      const existingRows = await tx
        .select({
          holdingId: transactions.holdingId,
          amountMinorUnits: transactions.amountMinorUnits,
          source: transactions.source,
        })
        .from(transactions)
        .where(eq(transactions.id, transactionId))
        .limit(1);
      const existing = existingRows.at(0);
      if (existing?.source !== 'manual') {
        return;
      }
      await tx
        .update(transactions)
        .set({ amountMinorUnits, time, description: description ?? '' })
        .where(eq(transactions.id, transactionId));
      const delta = amountMinorUnits - existing.amountMinorUnits;
      if (delta === 0) {
        return;
      }
      const current = await tx
        .select({ balanceMinorUnits: holdings.balanceMinorUnits })
        .from(holdings)
        .where(eq(holdings.id, existing.holdingId))
        .limit(1);
      const base = current.at(0)?.balanceMinorUnits ?? 0;
      await tx
        .update(holdings)
        .set({ balanceMinorUnits: base + delta })
        .where(eq(holdings.id, existing.holdingId));
    }),
  /**
   * Delete a MANUAL transaction and reverse its effect on the holding's stored
   * balance, all in ONE op-sqlite transaction so the ledger and the balance can
   * never desync on a partial failure. The reversal is the exact inverse of
   * `recordManual`/`update`: `balance -= amountMinorUnits`, read *inside* the
   * transaction so it never clobbers a concurrent write with a stale snapshot. A
   * synced (monobank) transaction is owned by the bank import and is refused with
   * a typed error; a missing id is a no-op rather than an error.
   */
  remove: (transactionId: string) =>
    write(async (tx) => {
      const rows = await tx.select().from(transactions).where(eq(transactions.id, transactionId));
      const row = rows.at(0);
      if (!row) {
        return;
      }
      if (isSyncedTransaction(row)) {
        throw new Error('transactionsRepo.remove: cannot delete a synced transaction');
      }
      await tx.delete(transactions).where(eq(transactions.id, transactionId));
      const holdingRows = await tx.select().from(holdings).where(eq(holdings.id, row.holdingId));
      const holding = holdingRows.at(0);
      if (holding) {
        await tx
          .update(holdings)
          .set({ balanceMinorUnits: holding.balanceMinorUnits - row.amountMinorUnits })
          .where(eq(holdings.id, row.holdingId));
      }
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
    write((tx) =>
      tx.update(transactions).set({ category }).where(eq(transactions.id, transactionId)),
    ),
  /**
   * Upsert a batch of imported rows on the `(source, external_id)` unique index
   * and return how many of them were genuinely NEW — the number the sync reports
   * to the user as "imported".
   */
  addManyDedup: (inputs: NewTransaction[]) =>
    write(async (tx): Promise<number> => {
      if (inputs.length === 0) {
        return 0;
      }
      const batch = dedupByConflictKey(inputs);
      // Apply name→category override rules at insert time. Normalize each
      // incoming description in JS (never SQL) and look the rules up by exact
      // equality on the already-normalized key.
      const keys = Array.from(
        new Set(batch.map((input) => normalizeTransactionName(input.description ?? ''))),
      ).filter((key) => key !== '');
      const rules =
        keys.length > 0
          ? await tx
              .select()
              .from(categoryOverrides)
              .where(inArray(categoryOverrides.normalizedName, keys))
          : [];
      const categoryByName = new Map(rules.map((rule) => [rule.normalizedName, rule.category]));
      const withOverrides = batch.map((input) => {
        const override = categoryByName.get(normalizeTransactionName(input.description ?? ''));

        return override ? { ...input, category: override } : input;
      });
      const newRows = await countNewRows(tx, batch);
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
      await tx
        .insert(transactions)
        .values(withOverrides.map((input) => ({ id: id(), ...input })))
        .onConflictDoUpdate({
          target: [transactions.source, transactions.externalId],
          set: {
            amountMinorUnits: sql`excluded.amount_minor_units`,
            description: sql`excluded.description`,
            hold: sql`excluded.hold`,
            mcc: sql`excluded.mcc`,
            counterIban: sql`excluded.counter_iban`,
            time: sql`excluded.time`,
          },
        });

      return newRows;
    }),
} satisfies Repository;
