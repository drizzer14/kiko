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

/** What a walk that writes Funding records reads and writes them through. */
export type BybitFundingSourceDeps = {
  writeFundingSources: (records: FundingMatchRow[]) => Promise<void>;
  removeFundingSources: (accountId: string, recordKeys: readonly string[]) => Promise<void>;
};

export const defaultBybitFundingSourceDeps: BybitFundingSourceDeps = {
  writeFundingSources: (records) =>
    write((databaseTransaction) =>
      bybitFundingMatchRepo.upsertDatabaseTransaction(databaseTransaction, records),
    ),
  removeFundingSources: (accountId, recordKeys) =>
    write((databaseTransaction) =>
      bybitFundingMatchRepo.removeDatabaseTransaction(databaseTransaction, accountId, 'source', [
        ...recordKeys,
      ]),
    ),
};

type PlacedSource = { externalId: string; funding?: FundingSourcePlan };

const withoutFunding = <Placed extends PlacedSource>(placed: Placed): Omit<Placed, 'funding'> => {
  const { funding: _funding, ...row } = placed;

  return row;
};

type FundingSourceContext = { accountId: string; deps: BybitFundingSourceDeps };

/**
 * Write the records of the placed rows, then the rows (`addRows` gets them with no record plan).
 * A crash between the two leaves a record whose row is not written, never a row with no record,
 * and the marks have not moved, so the next run writes both again. A record that outlives its
 * row only ever pairs a ledger row with a source (a lost row, the safe reading of rule 51), and a
 * row with no record would list it too (a double count).
 */
export const addWithFundingSources = async <Placed extends PlacedSource>(
  context: FundingSourceContext,
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

  if (records.length > 0) {
    await context.deps.writeFundingSources(records);
  }

  return addRows(placed.map(withoutFunding));
};

/** Take back the rows of the given keys, then their records: the record outlives the row. */
export const removeWithFundingSources = async (
  context: FundingSourceContext,
  externalIds: readonly string[],
  removeRows: (externalIds: readonly string[]) => Promise<number>,
): Promise<number> => {
  const removed = await removeRows(externalIds);

  await context.deps.removeFundingSources(context.accountId, externalIds);

  return removed;
};
