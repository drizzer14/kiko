import {
  addManyDedupDatabaseTransaction,
  removeSyncedRowsDatabaseTransaction,
} from '@kiko/transactions/repo';
import { maxOf } from '@kiko/numbers';
import maybe, { foldMap } from 'fnts/maybe';
import { type FundingMatchRow, write } from '@kiko/db';
import type { Currency } from '@kiko/currency/currency';
import { normalizeDecimal } from '@kiko/currency/decimal';
import type { WalkWindow } from '@kiko/crypto-sync/exchange/walk';

import type { BybitWallet } from './bybit.holding-keys';
import type { FundingSeries } from './bybit.funding-match';
import { bybitFundingMatchRepo } from './bybit.funding-match.repo';

type FundingDirection = 'I' | 'O';

/**
 * What a source row says to the Funding ledger's stored set, with no key and no account: the
 * key is the row's own `externalId`, so the record and its row leave together.
 */
export type FundingSourcePlan = Pick<
  FundingMatchRow,
  'coin' | 'amount' | 'fee' | 'tax' | 'timeStart' | 'timeEnd'
> & { series: FundingSeries; direction: FundingDirection };

type FundingSourceInput = {
  wallet: BybitWallet;
  series: FundingSeries;
  coin: Currency;
  direction: FundingDirection;
  /** The amount text of the page: a text no decimal can read gives no record. */
  amount: string;
  /** A fee or tax the parser could read, as decimal text. */
  fee?: string;
  tax?: string;
  time: WalkWindow;
  /** Every instant the series' window fields name; the extent ends at the latest of them. */
  instants?: readonly number[];
};

/**
 * The record of a source row, only for a row on the Funding wallet: a Unified row can never be
 * the partner of a Funding ledger row. The amount, fee and tax stay decimal text, never a number.
 */
export const fundingSourceOf = (input: FundingSourceInput): FundingSourcePlan | undefined => {
  const amount = normalizeDecimal(input.amount);

  if (input.wallet !== 'fund' || amount === null) {
    return undefined;
  }

  return {
    series: input.series,
    coin: input.coin,
    direction: input.direction,
    amount,
    fee: input.fee ?? null,
    tax: input.tax ?? null,
    timeStart: input.time.start,
    timeEnd: maxOf([input.time.end, ...(input.instants ?? [])]),
  };
};

/**
 * What a walk that writes Funding records writes them through: each record goes in the SAME
 * transaction as its row, so a failure of either leaves neither.
 */
export type BybitFundingSourceDeps<Row> = {
  addRowsAndFundingSources: (rows: Row[], records: FundingMatchRow[]) => Promise<number>;
  removeRowsAndFundingSources: (
    accountId: string,
    externalIds: readonly string[],
  ) => Promise<number>;
};

export const defaultBybitFundingSourceDeps: BybitFundingSourceDeps<
  Parameters<typeof addManyDedupDatabaseTransaction>[1][number]
> = {
  addRowsAndFundingSources: (rows, records) =>
    write(async (databaseTransaction) => {
      await bybitFundingMatchRepo.upsertDatabaseTransaction(databaseTransaction, records);

      return addManyDedupDatabaseTransaction(databaseTransaction, rows);
    }),
  removeRowsAndFundingSources: (accountId, externalIds) =>
    write(async (databaseTransaction) => {
      const removed = await removeSyncedRowsDatabaseTransaction(
        databaseTransaction,
        'bybit',
        externalIds,
      );

      await bybitFundingMatchRepo.removeDatabaseTransaction(
        databaseTransaction,
        accountId,
        'source',
        [...externalIds],
      );

      return removed;
    }),
};

type PlacedSource = { externalId: string; funding?: FundingSourcePlan };

const withoutFunding = <Placed extends PlacedSource>(placed: Placed): Omit<Placed, 'funding'> => {
  const { funding: _funding, ...row } = placed;

  return row;
};

type FundingSourceContext<Row> = { accountId: string; deps: BybitFundingSourceDeps<Row> };

/**
 * Write the placed rows with the records of the rows that have one, in one transaction (`addRows`
 * writes a batch that has no record). A failure of the row write takes the record back, so a
 * record never outlives its row: a row with no record would be listed as a ledger row's missing
 * partner (a double count), and the marks have not moved, so the next run writes both again.
 */
export const addWithFundingSources = async <Placed extends PlacedSource>(
  context: FundingSourceContext<Omit<Placed, 'funding'>>,
  placed: Placed[],
  addRows: (rows: Omit<Placed, 'funding'>[]) => Promise<number>,
): Promise<number> => {
  const records = placed.flatMap(
    ({ externalId, funding }) =>
      foldMap(maybe(funding), (plan): FundingMatchRow[] => [
        {
          ...plan,
          accountId: context.accountId,
          side: 'source',
          recordKey: externalId,
          earnPrincipal: false,
        },
      ]) ?? [],
  );

  const rows = placed.map(withoutFunding);

  return records.length > 0 ? context.deps.addRowsAndFundingSources(rows, records) : addRows(rows);
};
