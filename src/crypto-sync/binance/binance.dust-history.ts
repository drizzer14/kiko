import { rethrow } from 'fnts';
import { match } from 'ts-pattern';
import {
  BinanceWalkStop,
  type ExchangeStateDeps,
  exchangeStateDepsOf,
  historyListWriterOf,
  logWalkStop,
  placeWalletRows,
  rowMinorUnits,
} from '@kiko/crypto-sync/exchange/walk';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { bifoldMap, eitherSync } from 'fnts/either';
import type { Currency } from '@kiko/currency/currency';
import { transactionsRepo } from '@kiko/transactions/repo';
import { type ExchangeHolding, holdingsRepo } from '@kiko/holdings/repo';
import { untrackedAssetCode } from '@kiko/transactions/untracked-counterpart';

import {
  type BinanceDustEntry,
  type BinanceDustRecord,
  type DustHistoryPage,
  fetchDustHistory,
} from './binance.history-client';
import { holdingKeyOf } from './binance.holding-keys';
import { BINANCE_WALK_CONFIG } from './binance.walk-config';
import { isTrackedBinanceAsset } from './binance.tracked-coin';
import type { BinanceTransactionRow } from './binance.transactions';
import { type BinanceCredentials, readCredentials } from './binance.credentials';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';
import { BinanceRateLimitError, type FetchAccountOptions } from './binance.client';
import { type BinanceHistoryRun, COSTS, recordFailedCall } from './binance.history-budget';

/** The stop of an entry the rules cannot read, and of a page record the client could not read. */
const DUST_ROW_UNREADABLE = 'dust-row-unreadable';

const DUST_AMOUNT_INVALID = 'dust-amount-invalid';

/** The stop of rows whose holding the placement cannot find even after it creates a missing one. */
const DUST_HOLDING_MISSING = 'dust-holding-missing';

/** The one coin Binance converts dust into: an entry that names another is not read. */
const DUST_TARGET: Currency = 'BNB';

/**
 * A row mapped from a dust entry, before its wallets are turned into holdings: `wallet` is the key
 * of the coin's Spot holding, `counterpartWallet` the other leg's. A lone BNB leg (the coin is not
 * tracked) has `untrackedCounterpart` instead of a counterpart and a pair id.
 */
type PlannedDustRow = {
  wallet: string;
  counterpartWallet?: string;
  amountMinorUnits: number;
  time: number;
  externalId: string;
  exchangePairId?: string;
  untrackedCounterpart?: string;
  description: string;
  operation: 'dust';
};

/**
 * What one entry of a record comes to: its rows with the ticker of a coin Kiko does not track
 * (`rows`), a stop the entry owes a log line (`stopped`, with the coin when its amount was past
 * the safe integer), or nothing at all (`none`, an entry that comes to 0 units).
 */
export type DustEntryOutcome =
  | { kind: 'rows'; rows: PlannedDustRow[]; untracked: string[] }
  | { kind: 'stopped'; code: string; oversizedTicker?: string }
  | { kind: 'none' };

const NONE: DustEntryOutcome = { kind: 'none' };

const unitsOf = (currency: Currency, amountText: string | undefined): number => {
  if (amountText === undefined) {
    throw new BinanceWalkStop(DUST_ROW_UNREADABLE);
  }

  const units = rowMinorUnits(currency, amountText);

  if (units < 0) {
    throw new BinanceWalkStop(DUST_AMOUNT_INVALID);
  }

  return units;
};

/**
 * The identity of an entry is settled before any amount is read: the coin it converts must be one
 * and only one entry of the record (two entries of a coin would share a pair id, and neither is
 * the right one), and it must be converted into BNB. A record is read again while it is among the
 * newest 100 and none of this changes, so an entry that fails it is left out, not owed.
 */
const readableFromAsset = (record: BinanceDustRecord, entry: BinanceDustEntry): string => {
  const { fromAsset = '', targetAsset } = entry;
  const isRepeated = record.entries.filter((other) => other.fromAsset === fromAsset).length > 1;

  if (fromAsset === '' || fromAsset === DUST_TARGET || targetAsset !== DUST_TARGET || isRepeated) {
    throw new BinanceWalkStop(DUST_ROW_UNREADABLE);
  }

  return fromAsset;
};

/**
 * The rows of one entry, or a `BinanceWalkStop`. A coin Kiko tracks pairs with BNB on Spot; one it
 * does not track leaves the BNB leg alone, marked with the coin, and its amount is never read.
 */
const rowsOfEntry = (
  accountId: string,
  record: BinanceDustRecord,
  entry: BinanceDustEntry,
): DustEntryOutcome => {
  const fromAsset = readableFromAsset(record, entry);
  const pairId = `${accountId}:dust:${record.transId}:${fromAsset}`;
  const keyOf = (coin: Currency): string => holdingKeyOf(coin, 'spot');
  const legOf = (coin: Currency, amountMinorUnits: number) => ({
    wallet: keyOf(coin),
    amountMinorUnits,
    time: record.operateTime,
    externalId: `${pairId}:${keyOf(coin)}`,
    description: '',
    operation: 'dust' as const,
  });

  return match(fromAsset)
    .returnType<DustEntryOutcome>()
    .when(isTrackedBinanceAsset, (coin) => {
      const given = unitsOf(coin, entry.amount);
      const received = unitsOf(DUST_TARGET, entry.transferedAmount);

      if (given === 0 || received === 0) {
        return NONE;
      }

      return {
        kind: 'rows',
        untracked: [],
        rows: [
          {
            ...legOf(coin, -given),
            counterpartWallet: keyOf(DUST_TARGET),
            exchangePairId: pairId,
          },
          {
            ...legOf(DUST_TARGET, received),
            counterpartWallet: keyOf(coin),
            exchangePairId: pairId,
          },
        ],
      };
    })
    .otherwise((ticker) => {
      const untrackedCounterpart = untrackedAssetCode(ticker);

      if (untrackedCounterpart === undefined) {
        throw new BinanceWalkStop(DUST_ROW_UNREADABLE);
      }

      const received = unitsOf(DUST_TARGET, entry.transferedAmount);

      return received === 0
        ? NONE
        : {
            kind: 'rows',
            untracked: [ticker],
            rows: [{ ...legOf(DUST_TARGET, received), untrackedCounterpart }],
          };
    });
};

/**
 * What each entry of a dust record comes to, on its own: an entry the rules cannot read, or whose
 * amount the parser refuses, is a `stopped` outcome with its code and never throws past the record,
 * so its sibling entries still map. An entry whose amounts come to 0 units gives nothing (`none`).
 * The record's own `transId` and `operateTime` are already usable: the client leaves a record
 * without them out of the page.
 */
export const dustRowsOf = (input: {
  accountId: string;
  record: BinanceDustRecord;
}): DustEntryOutcome[] => {
  const { accountId, record } = input;

  return record.entries.map((entry) =>
    bifoldMap(
      eitherSync<unknown, DustEntryOutcome>(() => rowsOfEntry(accountId, record, entry)),
      (error): DustEntryOutcome => {
        if (!(error instanceof BinanceWalkStop)) {
          throw error;
        }

        return {
          kind: 'stopped',
          code: error.code,
          ...foldMap(maybe(error.oversizedTicker), (ticker) => ({ oversizedTicker: ticker })),
        };
      },
      (outcome) => outcome,
    ),
  );
};

/** The imported-transaction shape the dust read hands to `transactionsRepo.addManyDedup`. */
type BinanceDustRow = BinanceTransactionRow & {
  exchangeCounterpartHoldingId?: string;
  exchangePairId?: string;
  untrackedCounterpart?: string;
  operation: 'dust';
};

/**
 * The injectable seams of the dust read: the credential and holding reads, the dust read, the
 * insert-only holding creation, the deduping import, and the state write of the coin lists. Pacing
 * and the weight budget come from the run.
 */
export type BinanceDustHistoryDeps = ExchangeStateDeps & {
  now: () => number;
  fetchImpl: typeof fetch;
  readCredentials: (accountId: string) => Promise<BinanceCredentials | undefined>;
  listHoldings: (accountId: string) => Promise<HoldingRow[]>;
  fetchDustHistory: (
    apiKey: string,
    secret: string,
    options?: FetchAccountOptions,
  ) => Promise<DustHistoryPage>;
  ensureHoldings: (holdings: ExchangeHolding[]) => Promise<void>;
  addTransactions: (rows: BinanceDustRow[]) => Promise<number>;
};

const defaultDustHistoryDeps: BinanceDustHistoryDeps = {
  ...exchangeStateDepsOf('binance'),
  now: () => Date.now(),
  fetchImpl: fetch,
  readCredentials,
  listHoldings: async (accountId) => holdingsRepo.listByAccountQuery(accountId),
  fetchDustHistory,
  ensureHoldings: (holdings) => holdingsRepo.ensureExchangeHoldings(holdings),
  addTransactions: (rows) => transactionsRepo.addManyDedup(rows),
};

const NOTHING_IMPORTED = { imported: 0 };

/**
 * The one request of the run. `undefined` is a clean stop: Binance rate-limited, so the account is
 * on its shared cooldown until the walks after this read skip it too. Every other failure rejects.
 */
const fetchPage = async (
  deps: BinanceDustHistoryDeps,
  run: BinanceHistoryRun,
  accountId: string,
  credentials: BinanceCredentials,
): Promise<DustHistoryPage | undefined> => {
  try {
    await run.gate.wait();
    const page = await deps
      .fetchDustHistory(credentials.apiKey, credentials.secret, {
        fetchImpl: deps.fetchImpl,
        now: deps.now,
      })
      .catch(rethrow(() => recordFailedCall(run, 'dust')));
    run.budget.record('dust', page);

    return page;
  } catch (error) {
    if (!(error instanceof BinanceRateLimitError)) {
      throw error;
    }

    setBinanceCooldownUntil(accountId, deps.now() + error.retryAfterMs);

    return undefined;
  }
};

/** What a page comes to: the rows to import, the tickers and codes its entries name. */
type PageParts = {
  rows: PlannedDustRow[];
  untracked: string[];
  oversized: string[];
  codes: string[];
};

const partsOfOutcome = (outcome: DustEntryOutcome): PageParts =>
  match(outcome)
    .returnType<PageParts>()
    .with({ kind: 'rows' }, ({ rows, untracked }) => ({
      rows,
      untracked,
      oversized: [],
      codes: [],
    }))
    .with({ kind: 'stopped' }, ({ code, oversizedTicker }) => ({
      rows: [],
      untracked: [],
      oversized: foldMap(maybe(oversizedTicker), (ticker) => [ticker]) ?? [],
      codes: [code],
    }))
    .with({ kind: 'none' }, () => ({ rows: [], untracked: [], oversized: [], codes: [] }))
    .exhaustive();

const partsOfPage = (accountId: string, page: DustHistoryPage): PageParts => {
  const parts = page.rows
    .flatMap((record) => dustRowsOf({ accountId, record }))
    .map(partsOfOutcome);

  return {
    rows: parts.flatMap((part) => part.rows),
    untracked: [...new Set(parts.flatMap((part) => part.untracked))],
    oversized: [...new Set(parts.flatMap((part) => part.oversized))],
    codes: [
      ...parts.flatMap((part) => part.codes),
      ...page.unreadable.map(() => DUST_ROW_UNREADABLE),
    ],
  };
};

/**
 * Place the rows on the Spot holdings, creating a missing one at zero. Rows that cannot be placed
 * are no one entry's stop: none of the read is written, and the next run reads the records again.
 */
const placedRowsOf = async (
  deps: BinanceDustHistoryDeps,
  accountId: string,
  planned: PlannedDustRow[],
): Promise<BinanceDustRow[] | undefined> => {
  try {
    return await placeWalletRows({
      accountId,
      planned,
      config: BINANCE_WALK_CONFIG,
      listHoldings: deps.listHoldings,
      ensureHoldings: deps.ensureHoldings,
      missingCode: DUST_HOLDING_MISSING,
    });
  } catch (error) {
    if (!(error instanceof BinanceWalkStop)) {
      throw error;
    }

    logWalkStop(error.code);

    return undefined;
  }
};

const runSync = async (
  deps: BinanceDustHistoryDeps,
  accountId: string,
  run: BinanceHistoryRun,
): Promise<{ imported: number }> => {
  if (isBinanceCoolingDown(accountId, deps.now())) {
    return NOTHING_IMPORTED;
  }

  const credentials = await deps.readCredentials(accountId);

  if (credentials === undefined || !run.budget.canAfford('dust', COSTS.dust)) {
    return NOTHING_IMPORTED;
  }

  const page = await fetchPage(deps, run, accountId, credentials);

  if (page === undefined) {
    return NOTHING_IMPORTED;
  }

  const parts = partsOfPage(accountId, page);

  // Before any row, as an amount past the safe integer is met again on every run until its
  // record leaves the newest 100, and would never be listed if the write waited for the rows.
  if (parts.oversized.length > 0) {
    await historyListWriterOf(deps, accountId, 'oversizedCoins')(parts.oversized);
  }

  for (const code of new Set(parts.codes)) {
    logWalkStop(code);
  }

  const placed = await placedRowsOf(deps, accountId, parts.rows);

  if (placed === undefined) {
    return NOTHING_IMPORTED;
  }

  const imported = placed.length > 0 ? await deps.addTransactions(placed) : 0;

  // After its rows: a crash between the two reads the records again, which imports nothing new.
  if (parts.untracked.length > 0) {
    await historyListWriterOf(deps, accountId, 'untrackedCoins')(parts.untracked);
  }

  return { imported };
};

/**
 * Import the user's Binance dust conversions as transactions on the Spot holdings: one request per
 * run for the newest 100 records, no cursor and no walk entry. A record is read again while it is
 * among the newest 100, and its keys dedupe, so a run imports only the records it has not seen.
 * An entry the rules cannot import is logged and left out, and the others still import; a rate
 * limit sets the account's cooldown and ends the read cleanly, and any other failure rejects, so
 * the caller can log it without failing the balance sync.
 */
export const syncBinanceDustHistory = (
  request: { targetAccountId: string; run: BinanceHistoryRun },
  overrides: Partial<BinanceDustHistoryDeps> = {},
): Promise<{ imported: number }> =>
  runSync({ ...defaultDustHistoryDeps, ...overrides }, request.targetAccountId, request.run);
