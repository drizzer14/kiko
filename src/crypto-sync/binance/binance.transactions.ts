import { Money } from '../../currency/money';
import type { HoldingRow } from '../../db/schema';
import { createRequestGate, type RequestGate } from '../../monobank/throttle';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { transactionsRepo } from '../../repositories/transactions.repo';

import {
  type BinanceDeposit,
  type BinanceWithdrawal,
  type FetchAccountOptions,
  fetchDepositHistory,
  fetchWithdrawHistory,
  HISTORY_PAGE_LIMIT,
  type HistoryWindow,
} from './binance.client';
import { type BinanceCredentials, readCredentials } from './binance.credentials';

const BINANCE_ASSET = 'BTC';

/**
 * The `metadata.binanceAsset` match key of the Spot holding. Deposits and
 * withdrawals are ACCOUNT-level on-chain movements that land in / leave the Spot
 * wallet, so every imported transaction attaches to the Spot holding — the one
 * keyed with the legacy 'BTC' key (see `binance.provider.ts`).
 */
const SPOT_KEY = BINANCE_ASSET;

/** Binance's own settled states: a credited deposit, a completed withdrawal. */
const DEPOSIT_STATUS_SUCCESS = 1;
const WITHDRAW_STATUS_COMPLETED = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One history window's span. Binance rejects a `startTime`/`endTime` gap of 90
 * days or more, so the walk uses 89 days to stay strictly under the cap.
 */
const WINDOW_MS = 89 * DAY_MS;

/**
 * On a re-sync, the window start is widened this far behind the newest imported
 * record. A withdrawal's `applyTime` is when it was REQUESTED; it only becomes
 * settled (status 6, importable) later, so its timestamp can sit slightly behind
 * the cursor. A small overlap re-scans that boundary; the `(source, external_id)`
 * upsert makes the re-scan idempotent.
 */
const RESYNC_OVERLAP_MS = DAY_MS;

/**
 * The first-sync floor: Binance opened to the public in July 2017, so no BTC
 * deposit predates this. A first sync (no imported record yet) walks from here
 * to now; later syncs start from the cursor instead. Exported for the walk test.
 */
export const HISTORY_FLOOR_MS = Date.UTC(2017, 6, 14);

/** Safety stop on the window walk, so a bad clock cannot spin an unbounded loop. */
const MAX_WINDOWS = 80;

/** Safety stop on offset paging within one window (1000 rows/page × 50 = 50k). */
const MAX_PAGES_PER_WINDOW = 50;

/**
 * The inter-request pacing interval for the transaction-history walk. A first
 * sync fans out many 89-day windows × two endpoints; fired back-to-back they can
 * trip a Binance weight-429. One gate per invocation (built from `now`/`sleep`,
 * mirroring Monobank's per-token gate) spaces every request this far apart, which
 * keeps even a wide first sync well under the weight limit. Small — a background
 * import, not the 60s Monobank statement limit.
 */
export const BINANCE_REQUEST_INTERVAL_MS = 350;

/**
 * The imported-transaction shape the sync hands to `transactionsRepo.addManyDedup`.
 * `source: 'binance'` + `externalId` is the `(source, external_id)` unique key
 * the upsert dedupes on, so a re-sync refreshes rather than duplicates.
 */
export type BinanceTransactionRow = {
  holdingId: string;
  amountMinorUnits: number;
  time: number;
  source: 'binance';
  externalId: string;
  description: string;
};

/**
 * The injectable seams of the Binance transaction sync: the two history reads,
 * the credential + holding reads, the newest-imported-time cursor read, and the
 * deduping import. Mirrors `BinanceDeps` in `binance.provider.ts`.
 */
export type BinanceTxSyncDeps = {
  now: () => number;
  /** Delay primitive for the per-invocation request gate; injected so tests pace instantly. */
  sleep: (milliseconds: number) => Promise<void>;
  fetchImpl: typeof fetch;
  readCredentials: () => Promise<BinanceCredentials | undefined>;
  listHoldings: (accountId: string) => Promise<HoldingRow[]>;
  latestTransactionTime: (holdingId: string) => Promise<number | undefined>;
  addTransactions: (rows: BinanceTransactionRow[]) => Promise<number>;
  fetchDepositHistory: (
    apiKey: string,
    secret: string,
    window: HistoryWindow,
    options?: FetchAccountOptions,
  ) => Promise<BinanceDeposit[]>;
  fetchWithdrawHistory: (
    apiKey: string,
    secret: string,
    window: HistoryWindow,
    options?: FetchAccountOptions,
  ) => Promise<BinanceWithdrawal[]>;
};

const defaultBinanceTxDeps: BinanceTxSyncDeps = {
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  fetchImpl: fetch,
  readCredentials,
  listHoldings: async (accountId) => holdingsRepo.listByAccountQuery(accountId),
  latestTransactionTime: async (holdingId) =>
    (await transactionsRepo.latestSyncedTimeQuery(holdingId, 'binance')).at(0)?.time,
  addTransactions: (rows) => transactionsRepo.addManyDedup(rows),
  fetchDepositHistory,
  fetchWithdrawHistory,
};

/**
 * A Binance `applyTime` is a UTC datetime STRING ("2019-10-12 11:12:02"), not
 * epoch ms. A bare `Date.parse` of that reads it in the DEVICE's local zone,
 * shifting every withdrawal by the local offset; inserting 'T' and 'Z' pins it
 * to UTC. A value already numeric (a future API change) passes through.
 */
export const parseWithdrawTime = (applyTime: string | number): number => {
  if (typeof applyTime === 'number') {
    return applyTime;
  }

  return Date.parse(`${applyTime.replace(' ', 'T')}Z`);
};

/** BTC decimal string -> satoshis, or `null` when the value is not finite. */
const toSatoshis = (amount: string): number | null => {
  const value = Number(amount);

  if (!Number.isFinite(value)) {
    return null;
  }

  return Money.fromMajor(BINANCE_ASSET, value).minorUnits;
};

/** Binance's own record id, falling back to the on-chain tx id, or '' if neither. */
const recordKey = (record: { id: string; txId: string }): string => record.id || record.txId || '';

/**
 * Map one settled deposit to a positive Spot transaction, or `null` when it is
 * not settled, carries no id, or holds a non-finite amount/time.
 */
const depositRow = (holdingId: string, record: BinanceDeposit): BinanceTransactionRow | null => {
  if (record.status !== DEPOSIT_STATUS_SUCCESS) {
    return null;
  }

  const key = recordKey(record);
  const satoshis = toSatoshis(record.amount);

  if (key === '' || satoshis === null || !Number.isFinite(record.insertTime)) {
    return null;
  }

  return {
    holdingId,
    amountMinorUnits: satoshis,
    time: record.insertTime,
    source: 'binance',
    externalId: `deposit:${key}`,
    description: '',
  };
};

/**
 * Map one completed withdrawal to a negative Spot transaction, or `null` when it
 * is not completed, carries no id, or holds a non-finite amount/time. The
 * network fee (`transactionFee`) is not part of the ledger line — the row shows
 * the amount the user sent.
 */
const withdrawalRow = (
  holdingId: string,
  record: BinanceWithdrawal,
): BinanceTransactionRow | null => {
  if (record.status !== WITHDRAW_STATUS_COMPLETED) {
    return null;
  }

  const key = recordKey(record);
  const satoshis = toSatoshis(record.amount);
  const time = parseWithdrawTime(record.applyTime);

  if (key === '' || satoshis === null || !Number.isFinite(time)) {
    return null;
  }

  return {
    holdingId,
    amountMinorUnits: -satoshis,
    time,
    source: 'binance',
    externalId: `withdraw:${key}`,
    description: '',
  };
};

/**
 * The window start for this run. A first sync (no imported record) walks from
 * the floor; a re-sync always re-scans at least the last window AND everything
 * back to the cursor (minus the overlap), so a late-settling record within the
 * window is still caught. The start never predates the floor.
 */
const resolveStartTime = (latest: number | undefined, endTime: number): number => {
  if (latest === undefined) {
    return HISTORY_FLOOR_MS;
  }

  const cursorStart = Math.min(latest - RESYNC_OVERLAP_MS, endTime - WINDOW_MS);

  return Math.max(HISTORY_FLOOR_MS, cursorStart);
};

/** Split [startTime, endTime] into contiguous windows of at most `WINDOW_MS`. */
const buildWindows = (startTime: number, endTime: number): { start: number; end: number }[] => {
  const windows: { start: number; end: number }[] = [];
  let cursor = startTime;

  for (let count = 0; count < MAX_WINDOWS && cursor < endTime; count += 1) {
    const end = Math.min(cursor + WINDOW_MS, endTime);
    windows.push({ start: cursor, end });
    cursor = end;
  }

  return windows;
};

/**
 * Offset-page one window of one endpoint until a page shorter than the limit.
 * Every request first passes the shared `gate`, so a wide walk's requests are
 * spaced (see `BINANCE_REQUEST_INTERVAL_MS`) rather than fired back-to-back.
 */
const fetchAllInWindow = async <Row>(
  gate: RequestGate,
  fetchPage: (window: HistoryWindow) => Promise<Row[]>,
  start: number,
  end: number,
): Promise<Row[]> => {
  const rows: Row[] = [];

  for (let page = 0; page < MAX_PAGES_PER_WINDOW; page += 1) {
    await gate.wait();
    const pageRows = await fetchPage({
      startTime: start,
      endTime: end,
      offset: page * HISTORY_PAGE_LIMIT,
    });
    rows.push(...pageRows);

    if (pageRows.length < HISTORY_PAGE_LIMIT) {
      break;
    }
  }

  return rows;
};

type WindowContext = {
  deps: BinanceTxSyncDeps;
  gate: RequestGate;
  apiKey: string;
  secret: string;
  options: FetchAccountOptions;
  spotId: string;
};

/** Collect and map every settled deposit + withdrawal in one window. */
const windowRows = async (
  context: WindowContext,
  window: { start: number; end: number },
): Promise<BinanceTransactionRow[]> => {
  const { deps, gate, apiKey, secret, options, spotId } = context;
  const deposits = await fetchAllInWindow(
    gate,
    (page) => deps.fetchDepositHistory(apiKey, secret, page, options),
    window.start,
    window.end,
  );
  const withdrawals = await fetchAllInWindow(
    gate,
    (page) => deps.fetchWithdrawHistory(apiKey, secret, page, options),
    window.start,
    window.end,
  );

  return [
    ...deposits.map((record) => depositRow(spotId, record)),
    ...withdrawals.map((record) => withdrawalRow(spotId, record)),
  ].filter((row): row is BinanceTransactionRow => row !== null);
};

/** The `metadata.binanceAsset` key stored on a holding, if any. */
const binanceKeyOf = (holding: HoldingRow): string | undefined => {
  const key = (holding.metadata as { binanceAsset?: unknown } | null)?.binanceAsset;

  return typeof key === 'string' ? key : undefined;
};

const runSync = async (
  deps: BinanceTxSyncDeps,
  accountId: string,
): Promise<{ imported: number }> => {
  const holdings = await deps.listHoldings(accountId);
  const spot = holdings.find((holding) => binanceKeyOf(holding) === SPOT_KEY);
  const credentials = await deps.readCredentials();

  if (spot === undefined || credentials === undefined) {
    return { imported: 0 };
  }

  const { apiKey, secret } = credentials;
  const options: FetchAccountOptions = { fetchImpl: deps.fetchImpl, now: deps.now };
  const endTime = deps.now();
  const latest = await deps.latestTransactionTime(spot.id);
  const windows = buildWindows(resolveStartTime(latest, endTime), endTime);
  // ONE gate per invocation, threaded through every deposit/withdraw request so
  // the whole run stays under the Binance weight limit — mirrors the per-token
  // gate `runSync` builds in `src/monobank/sync.ts`.
  const gate = createRequestGate({
    intervalMs: BINANCE_REQUEST_INTERVAL_MS,
    now: deps.now,
    sleep: deps.sleep,
  });
  const context: WindowContext = { deps, gate, apiKey, secret, options, spotId: spot.id };
  const rows: BinanceTransactionRow[] = [];

  for (const window of windows) {
    rows.push(...(await windowRows(context, window)));
  }

  if (rows.length === 0) {
    return { imported: 0 };
  }

  return { imported: await deps.addTransactions(rows) };
};

/**
 * Fetch BTC deposit + withdrawal history from Binance and import it as
 * transactions for the account's Spot holding, idempotently. Runs AFTER the
 * balance sync (which creates/updates the Spot holding), so the holding it
 * attaches to already exists. A missing Spot holding or missing credentials is a
 * no-op; a history request failure rejects, so the caller can log it without
 * failing the balance sync.
 */
export const syncBinanceTransactions = (
  request: { targetAccountId: string },
  overrides: Partial<BinanceTxSyncDeps> = {},
): Promise<{ imported: number }> =>
  runSync({ ...defaultBinanceTxDeps, ...overrides }, request.targetAccountId);
