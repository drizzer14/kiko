import {
  addManyDedupDatabaseTransaction,
  removeSyncedRowsDatabaseTransaction,
  transactionsRepo,
} from '@kiko/transactions/repo';
import { bifoldMap } from 'fnts/either';
import {
  BinanceWalkStop,
  EXCHANGE_STATE_MALFORMED,
  type ExchangeStateDeps,
  exchangeStateDepsOf,
} from '@kiko/crypto-sync/exchange/walk';
import { holdingsRepo } from '@kiko/holdings/repo';
import { type FundingMatchRow, write } from '@kiko/db';
import type { Currency } from '@kiko/currency/currency';
import { exchangeMinorUnits } from '@kiko/crypto-sync/exchange/amounts';
import { FUNDING_LEDGER_CODE } from '@kiko/transactions/untracked-counterpart';
import { type ParsedWalkMarks, parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';

import {
  FUNDING_MATCH_HOLD_MS,
  FUNDING_MATCH_WINDOW_MS,
  type FundingEarnClause,
  type FundingMatchInput,
  type FundingVerdict,
  type FundingWalkMarks,
  matchFundingLedger,
} from './bybit.funding-match';
import { holdingKeyOf } from './bybit.holding-keys';
import { isTrackedBybitAsset } from './bybit.tracked-coin';
import { bybitFundingMatchRepo } from './bybit.funding-match.repo';
import { type BybitRowWalkDeps, historyFloorOf, placeBybitRows } from './bybit.walk-run';

/** The `untracked_counterpart` code of a listed Funding ledger row: it stays out of spending. */
const FUNDING_LEDGER_MARKER = FUNDING_LEDGER_CODE;

const FUNDING_HOLDING_MISSING = 'funding-holding-missing';

const FUNDING_MARKS_UNREADABLE = 'funding-marks-unreadable';

/**
 * Earn is not read, so the shipped copy says Earn money is outside the total (clause "E2 and E4"):
 * a stake or a redemption is a move out of what Kiko counts, and its row lists.
 */
const SHIPPED_EARN_CLAUSE: FundingEarnClause = 'notCounted';

/** The verdicts that take a listed row back; `waiting` is not one, a doubt removes nothing. */
const REMOVING_VERDICTS: readonly FundingVerdict[] = ['explained', 'held', 'earnMove'];

type NewRow = Parameters<typeof addManyDedupDatabaseTransaction>[1][number];

type PlannedLedgerRow = Pick<
  NewRow,
  'amountMinorUnits' | 'time' | 'description' | 'untrackedCounterpart'
> & { wallet: string; externalId: string };

type PlacedLedgerRow = Omit<PlannedLedgerRow, 'wallet'> & { holdingId: string; source: 'bybit' };

/** What one reconcile writes, in one transaction: the rows, the rows to take back, the prune. */
type Difference = { add: PlacedLedgerRow[]; removeKeys: string[]; pruneBefore: number };

export type BybitFundingReconcileDeps = ExchangeStateDeps &
  Pick<BybitRowWalkDeps<never>, 'now' | 'listHoldings' | 'ensureHoldings'> & {
    earnClause: FundingEarnClause;
    /** Every stored ledger row and source of the account (`funding_match_rows`). */
    readStoredSet: (accountId: string) => Promise<FundingMatchRow[]>;
    /** The keys of the account's rows that carry the marker of a listed Funding ledger row. */
    readWrittenKeys: (accountId: string) => Promise<ReadonlySet<string>>;
    applyDifference: (accountId: string, difference: Difference) => Promise<void>;
  };

const defaultBybitFundingReconcileDeps: BybitFundingReconcileDeps = {
  ...exchangeStateDepsOf('bybit'),
  now: () => Date.now(),
  listHoldings: async (accountId) => holdingsRepo.listByAccountQuery(accountId),
  ensureHoldings: (holdings) => holdingsRepo.ensureExchangeHoldings(holdings),
  earnClause: SHIPPED_EARN_CLAUSE,
  readStoredSet: (accountId) => bybitFundingMatchRepo.readByAccount(accountId),
  readWrittenKeys: (accountId) =>
    transactionsRepo.markedExternalIdsQuery(accountId, 'bybit', FUNDING_LEDGER_MARKER),
  applyDifference: (accountId, { add, removeKeys, pruneBefore }) =>
    write(async (databaseTransaction) => {
      if (add.length > 0) {
        await addManyDedupDatabaseTransaction(databaseTransaction, add);
      }

      if (removeKeys.length > 0) {
        await removeSyncedRowsDatabaseTransaction(databaseTransaction, 'bybit', removeKeys);
      }

      await bybitFundingMatchRepo.pruneDatabaseTransaction(
        databaseTransaction,
        accountId,
        pruneBefore,
      );
    }),
};

const walkMarksOf = (walk: ParsedWalkMarks): FundingWalkMarks => {
  if (walk.pending === undefined) {
    throw new BinanceWalkStop(FUNDING_MARKS_UNREADABLE);
  }

  return { cursor: walk.cursor, pending: walk.pending };
};

type StateReading = { marks: FundingMatchInput['marks']; heldCount: number };

/**
 * The marks of the three source walks and the count of held rows the state stores. A state no
 * build reads, or a pending list of a source walk that is stored but unreadable, rejects: a
 * verdict taken on a guess about what is owed could list a row that a source still owes a partner.
 */
const stateReadingOf = (text: string | null): StateReading => {
  const state = parseExchangeState(text);

  if (state.kind === 'malformed') {
    throw new BinanceWalkStop(EXCHANGE_STATE_MALFORMED);
  }

  return {
    marks: {
      capital: walkMarksOf(state.walks.capital),
      transfer: walkMarksOf(state.walks.transfer),
      convert: walkMarksOf(state.walks.convert),
    },
    heldCount: state.fundingHeld,
  };
};

/** A text that is no amount the coin can hold, or rounds to nothing, gives no units. */
const unitsOf = (coin: Currency, amount: string): number =>
  bifoldMap(
    exchangeMinorUnits(coin, amount, 'rounded-row'),
    () => 0,
    (units) => units,
  );

/**
 * The row a listed ledger record becomes, on the Funding holding of its coin, signed by its
 * direction. A record that rounds to no units, or is too large to hold, makes no row and stays
 * stored for pairing.
 */
const plannedRowsOf = (ledger: FundingMatchRow): PlannedLedgerRow[] => {
  const { coin } = ledger;

  if (!isTrackedBybitAsset(coin)) {
    return [];
  }

  const units = unitsOf(coin, ledger.amount);

  if (units === 0) {
    return [];
  }

  return [
    {
      wallet: holdingKeyOf(coin, 'fund'),
      amountMinorUnits: ledger.direction === 'O' ? -units : units,
      time: ledger.timeStart,
      externalId: ledger.recordKey,
      description: '',
      untrackedCounterpart: FUNDING_LEDGER_MARKER,
    },
  ];
};

/**
 * Only the difference against the rows already written is written, and a removal names only the
 * key of a stored ledger record: a removal also takes the user's note and category, with no
 * trace, so a verdict in doubt (`waiting`) and a row whose record a reconnect, a partly read set
 * or a prune left out must never reach it. A holding it cannot find rejects before any write, so
 * the caller's log names the stop and the next run starts from the same stored set.
 */
export const reconcileBybitFundingLedger = async (
  request: { targetAccountId: string },
  overrides: Partial<BybitFundingReconcileDeps> = {},
): Promise<void> => {
  const deps = { ...defaultBybitFundingReconcileDeps, ...overrides };
  const accountId = request.targetAccountId;
  const { marks, heldCount } = stateReadingOf(await deps.readExchangeState(accountId));
  const now = deps.now();
  const rows = await deps.readStoredSet(accountId);
  const verdicts = matchFundingLedger({
    rows,
    marks,
    earnClause: deps.earnClause,
    now,
    windowMs: FUNDING_MATCH_WINDOW_MS,
    holdMs: FUNDING_MATCH_HOLD_MS,
  });
  const written = await deps.readWrittenKeys(accountId);
  const placed = await placeBybitRows(
    { accountId, deps },
    rows
      .filter((row) => verdicts.get(row.recordKey) === 'listed' && !written.has(row.recordKey))
      .flatMap(plannedRowsOf),
    FUNDING_HOLDING_MISSING,
  );

  await deps.applyDifference(accountId, {
    add: placed,
    removeKeys: [...verdicts]
      .filter(([key, verdict]) => REMOVING_VERDICTS.includes(verdict) && written.has(key))
      .map(([key]) => key),
    // A record that ends two windows before the walks' floor has no partner the walks can still
    // read, so it can move no verdict, and the table would otherwise grow for good.
    pruneBefore: historyFloorOf(now) - 2 * FUNDING_MATCH_WINDOW_MS,
  });

  const held = [...verdicts.values()].filter((verdict) => verdict === 'held').length;

  if (held !== heldCount) {
    await deps.patchExchangeState(accountId, [{ kind: 'fundingHeld', count: held }]);
  }
};
