import { desc, eq, inArray } from 'drizzle-orm';
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
      'description' | 'category' | 'mcc' | 'counterIban' | 'comment' | 'externalId'
    >
  >;

type ManualTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time'> &
  Partial<Pick<TransactionRow, 'description'>>;

type TransactionEdit = Pick<TransactionRow, 'amountMinorUnits' | 'time'> &
  Partial<Pick<TransactionRow, 'description'>> & { transactionId: string };

type ExchangeInput = {
  sourceHoldingId: string;
  sourceName: string;
  valueOutMinorUnits: number;
  destinationHoldingId: string;
  destinationName: string;
  destinationType: HoldingRow['type'];
  valueInMinorUnits: number;
  time: number;
};

type ExchangeCounterpartInput = {
  direction: ExchangeConvertDirection;
  counterpartHoldingId: string;
  counterpartType: HoldingRow['type'];
  amountMinorUnits: number;
  existingHoldingName: string;
  time: number;
};

// Insert a manual transaction and adjust its holding's balance on an EXISTING
// transaction handle. The balance base is read from the DB *inside* the same
// transaction, never from a render snapshot, so concurrent writes cannot clobber
// each other with a stale read-modify-write. `recordManual` wraps this in its
// own `write(...)`; `recordExchange` calls it directly for the source leg and
// for a plain destination leg, keeping both legs in one transaction.
const recordManualTx = async (
  tx: typeof database,
  { holdingId, amountMinorUnits, time, description }: ManualTransaction,
): Promise<void> => {
  await tx.insert(transactions).values({
    id: id(),
    holdingId,
    amountMinorUnits,
    time,
    description: description ?? '',
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
        category: transactions.category,
        accountId: accounts.id,
        accountName: accounts.name,
        holdingName: holdings.name,
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
   * only by their descriptions. The source leg subtracts Value Out (in the
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
        description: `Exchange to ${input.destinationName}`,
      });

      await match(exchangeReceivePath(input.destinationType))
        .with('plain', () =>
          recordManualTx(tx, {
            holdingId: input.destinationHoldingId,
            amountMinorUnits: input.valueInMinorUnits,
            time: input.time,
            description: `Exchange from ${input.sourceName}`,
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
   * The description is the fixed copy create-mode uses. Balances are read INSIDE
   * the transaction, never from a render snapshot, exactly as `recordManual` does.
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

      return match(input.direction)
        .with('record-source', () =>
          recordManualTx(tx, {
            holdingId: input.counterpartHoldingId,
            amountMinorUnits: -input.amountMinorUnits,
            time: input.time,
            description: `Exchange to ${input.existingHoldingName}`,
          }),
        )
        .with('record-destination', () =>
          match(exchangeReceivePath(input.counterpartType))
            .with('plain', () =>
              recordManualTx(tx, {
                holdingId: input.counterpartHoldingId,
                amountMinorUnits: input.amountMinorUnits,
                time: input.time,
                description: `Exchange from ${input.existingHoldingName}`,
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
  addManyDedup: (inputs: NewTransaction[]) =>
    write(async (tx) => {
      if (inputs.length === 0) {
        return;
      }
      // Apply name→category override rules at insert time. Normalize each
      // incoming description in JS (never SQL) and look the rules up by exact
      // equality on the already-normalized key.
      const keys = Array.from(
        new Set(inputs.map((input) => normalizeTransactionName(input.description ?? ''))),
      ).filter((key) => key !== '');
      const rules =
        keys.length > 0
          ? await tx
              .select()
              .from(categoryOverrides)
              .where(inArray(categoryOverrides.normalizedName, keys))
          : [];
      const categoryByName = new Map(rules.map((rule) => [rule.normalizedName, rule.category]));
      const withOverrides = inputs.map((input) => {
        const override = categoryByName.get(normalizeTransactionName(input.description ?? ''));

        return override ? { ...input, category: override } : input;
      });
      // Dedup re-imported statement items against the (source, external_id)
      // unique index — a repeated Monobank statement id is skipped, not
      // duplicated. Manual rows with a null externalId are never conflated.
      await tx
        .insert(transactions)
        .values(withOverrides.map((input) => ({ id: id(), ...input })))
        .onConflictDoNothing();
    }),
} satisfies Repository;
