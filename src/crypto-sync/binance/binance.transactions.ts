import type { HoldingRow } from '@kiko/db';
import { Money } from '@kiko/currency/money';
import { holdingsRepo } from '@kiko/holdings/repo';
import { transactionsRepo } from '@kiko/transactions/repo';
import { binanceHistoryCursorOf } from '@kiko/holdings/holding-metadata';
import { createRequestGate, type RequestGate } from '@kiko/monobank/throttle';

import {
  type BinanceDeposit,
  BinanceRateLimitError,
  type BinanceWithdrawal,
  type FetchAccountOptions,
  fetchDepositHistory,
  fetchWithdrawHistory,
  HISTORY_PAGE_LIMIT,
  type HistoryWindow,
  type WithdrawHistoryPage,
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
 * At most this many withdraw-history calls per run when Binance's own weight
 * header (`X-SAPI-USED-UID-WEIGHT-1M`) is unavailable — the safety net a
 * first-sync's wide window walk relies on so one run never trips the weight
 * limit even without ever seeing the header.
 */
export const WITHDRAW_CALLS_PER_RUN_FALLBACK = 9;

/** The SAPI weight one withdraw-history call costs, per Binance's own documented weight table. */
export const WITHDRAW_UID_WEIGHT = 18_000;

/** Binance's own per-minute UID weight ceiling — what `X-SAPI-USED-UID-WEIGHT-1M` is measured against. */
export const UID_WEIGHT_BUDGET_1M = 180_000;

/**
 * Per-account cooldown set by a 429/418, so a resumed run makes ZERO Binance
 * requests until `Retry-After` passes. Module-level (not a `SyncDeps` seam),
 * because it must survive across SEPARATE `syncBinanceTransactions`
 * invocations within this app process — the same reason Monobank's request
 * gate lives outside `SyncDeps` (`src/monobank/`). No exported reset (no test
 * code in `src/`): a test uses a distinct account id per case.
 */
const cooldownUntilByAccount = new Map<string, number>();

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
export type BinanceTransactionSyncDeps = {
  now: () => number;
  /** Delay primitive for the per-invocation request gate; injected so tests pace instantly. */
  sleep: (milliseconds: number) => Promise<void>;
  fetchImpl: typeof fetch;
  readCredentials: (accountId: string) => Promise<BinanceCredentials | undefined>;
  listHoldings: (accountId: string) => Promise<HoldingRow[]>;
  /** The legacy fallback cursor: only consulted when the holding carries no watermark yet. */
  latestTransactionTime: (holdingId: string) => Promise<number | undefined>;
  addTransactions: (rows: BinanceTransactionRow[]) => Promise<number>;
  /** Advances the walk's own watermark once a window's rows have committed. */
  writeHistoryCursor: (holdingId: string, cursorMs: number) => Promise<void>;
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
  ) => Promise<WithdrawHistoryPage>;
};

const defaultBinanceTransactionDeps: BinanceTransactionSyncDeps = {
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  fetchImpl: fetch,
  readCredentials,
  listHoldings: async (accountId) => holdingsRepo.listByAccountQuery(accountId),
  latestTransactionTime: async (holdingId) =>
    (await transactionsRepo.latestSyncedTimeQuery(holdingId, 'binance')).at(0)?.time,
  addTransactions: (rows) => transactionsRepo.addManyDedup(rows),
  writeHistoryCursor: (holdingId, cursorMs) =>
    holdingsRepo.setBinanceHistoryCursor(holdingId, cursorMs),
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
const depositRow = (
  holdingId: string,
  accountId: string,
  record: BinanceDeposit,
): BinanceTransactionRow | null => {
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
    externalId: `${accountId}:deposit:${key}`,
    // The stable, non-localized asset ticker, NOT a t(...) call. A blank
    // description normalizes to '' so the category-apply sheet is skipped for a
    // crypto row (item 12); a stable ticker gives the name rule something to
    // match, so the sheet appears with parity to a Monobank merchant row. It
    // must stay non-localized — a localized label would change under a language
    // switch and break name matching.
    description: BINANCE_ASSET,
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
  accountId: string,
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
    externalId: `${accountId}:withdraw:${key}`,
    // See depositRow: the stable, non-localized asset ticker so the row groups
    // under the category-apply sheet (item 12).
    description: BINANCE_ASSET,
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
  deps: BinanceTransactionSyncDeps;
  gate: RequestGate;
  apiKey: string;
  secret: string;
  options: FetchAccountOptions;
};

/** The withdraw-history call budget spent so far this run. */
type WithdrawBudget = { callsUsed: number; lastUsedWeight: number | undefined };

const NO_WITHDRAW_CALLS_YET: WithdrawBudget = { callsUsed: 0, lastUsedWeight: undefined };

/**
 * Whether one more withdraw-history call is affordable: under the fallback
 * call count, AND (the header's last-reported weight is unknown, OR spending
 * one more call's weight still stays under Binance's per-minute ceiling).
 */
const canAffordOneWithdrawCall = (budget: WithdrawBudget): boolean =>
  budget.callsUsed < WITHDRAW_CALLS_PER_RUN_FALLBACK &&
  (budget.lastUsedWeight === undefined ||
    budget.lastUsedWeight + WITHDRAW_UID_WEIGHT <= UID_WEIGHT_BUDGET_1M);

type WithdrawWindowResult = {
  rows: BinanceWithdrawal[];
  budget: WithdrawBudget;
  /** `true` when the budget ran out before a short (final) page was reached. */
  exhausted: boolean;
};

/**
 * Offset-page one window's withdrawals, spending the run's shared budget one
 * call at a time and refreshing it from each response's own reported weight.
 * Stops (`exhausted: true`) the instant the NEXT page is unaffordable, rather
 * than fetching partial data the caller must not commit.
 */
const fetchWithdrawalsInWindow = async (
  context: WindowContext,
  window: { start: number; end: number },
  startingBudget: WithdrawBudget,
): Promise<WithdrawWindowResult> => {
  const { deps, gate, apiKey, secret, options } = context;
  const rows: BinanceWithdrawal[] = [];
  let budget = startingBudget;

  for (let pageIndex = 0; pageIndex < MAX_PAGES_PER_WINDOW; pageIndex += 1) {
    if (!canAffordOneWithdrawCall(budget)) {
      return { rows, budget, exhausted: true };
    }

    await gate.wait();
    const page = await deps.fetchWithdrawHistory(
      apiKey,
      secret,
      { startTime: window.start, endTime: window.end, offset: pageIndex * HISTORY_PAGE_LIMIT },
      options,
    );
    budget = {
      callsUsed: budget.callsUsed + 1,
      lastUsedWeight: page.usedUidWeight1m ?? budget.lastUsedWeight,
    };
    rows.push(...page.rows);

    if (page.rows.length < HISTORY_PAGE_LIMIT) {
      return { rows, budget, exhausted: false };
    }
  }

  return { rows, budget, exhausted: false };
};

/** The `metadata.binanceAsset` key stored on a holding, if any. */
const binanceKeyOf = (holding: HoldingRow): string | undefined => {
  const key = (holding.metadata as { binanceAsset?: unknown } | null)?.binanceAsset;

  return typeof key === 'string' ? key : undefined;
};

/** One window's outcome: committed (rows durable, watermark advanced) or a clean stop. */
type WindowOutcome =
  | { kind: 'committed'; imported: number; budget: WithdrawBudget }
  | { kind: 'stop'; budget: WithdrawBudget };

/**
 * Run one window: fetch deposits (unbounded) + withdrawals (budgeted), then
 * either commit (rows first, watermark second — crash-safe: a crash between
 * the two just re-imports idempotently next run) or stop cleanly without
 * committing. A `BinanceRateLimitError` sets the account's cooldown and stops;
 * any other error rethrows, leaving every EARLIER window's commit in place.
 */
const runOneWindow = async (
  context: WindowContext,
  accountId: string,
  spot: HoldingRow,
  window: { start: number; end: number },
  budget: WithdrawBudget,
): Promise<WindowOutcome> => {
  const { deps, gate, apiKey, secret, options } = context;
  let deposits: BinanceDeposit[];
  let withdrawn: WithdrawWindowResult;

  try {
    deposits = await fetchAllInWindow(
      gate,
      (page) => deps.fetchDepositHistory(apiKey, secret, page, options),
      window.start,
      window.end,
    );
    withdrawn = await fetchWithdrawalsInWindow(context, window, budget);
  } catch (error) {
    if (error instanceof BinanceRateLimitError) {
      cooldownUntilByAccount.set(accountId, deps.now() + error.retryAfterMs);

      return { kind: 'stop', budget };
    }

    throw error;
  }

  if (withdrawn.exhausted) {
    // Not committed and not marked — the next run redoes this window from the
    // SAME (unmoved) cursor.
    return { kind: 'stop', budget: withdrawn.budget };
  }

  const rows = [
    ...deposits.map((record) => depositRow(spot.id, accountId, record)),
    ...withdrawn.rows.map((record) => withdrawalRow(spot.id, accountId, record)),
  ].filter((row): row is BinanceTransactionRow => row !== null);
  let imported = 0;

  if (rows.length > 0) {
    imported = await deps.addTransactions(rows);
  }

  await deps.writeHistoryCursor(spot.id, window.end);

  return { kind: 'committed', imported, budget: withdrawn.budget };
};

const runSync = async (
  deps: BinanceTransactionSyncDeps,
  accountId: string,
): Promise<{ imported: number; complete: boolean }> => {
  const now = deps.now();
  const cooldownUntil = cooldownUntilByAccount.get(accountId);

  if (cooldownUntil !== undefined && now < cooldownUntil) {
    return { imported: 0, complete: false };
  }

  const holdings = await deps.listHoldings(accountId);
  const spot = holdings.find((holding) => binanceKeyOf(holding) === SPOT_KEY);
  const credentials = await deps.readCredentials(accountId);

  if (spot === undefined || credentials === undefined) {
    return { imported: 0, complete: true };
  }

  const { apiKey, secret } = credentials;
  const options: FetchAccountOptions = { fetchImpl: deps.fetchImpl, now: deps.now };
  const endTime = now;
  // The watermark takes priority; a holding that never had one (legacy data,
  // or a first sync) falls back to the newest already-imported record.
  const cursor = binanceHistoryCursorOf(spot.metadata);
  const latest = await deps.latestTransactionTime(spot.id);
  const windows = buildWindows(resolveStartTime(cursor ?? latest, endTime), endTime);
  // ONE gate per invocation, threaded through every deposit/withdraw request so
  // the whole run stays under the Binance weight limit — mirrors the per-token
  // gate `runSync` builds in `src/monobank/sync.ts`.
  const gate = createRequestGate({
    intervalMs: BINANCE_REQUEST_INTERVAL_MS,
    now: deps.now,
    sleep: deps.sleep,
  });
  const context: WindowContext = { deps, gate, apiKey, secret, options };
  let imported = 0;
  let budget = NO_WITHDRAW_CALLS_YET;

  for (const window of windows) {
    if (!canAffordOneWithdrawCall(budget)) {
      return { imported, complete: false };
    }

    const outcome = await runOneWindow(context, accountId, spot, window, budget);
    budget = outcome.budget;

    if (outcome.kind === 'stop') {
      return { imported, complete: false };
    }

    imported += outcome.imported;
  }

  return { imported, complete: true };
};

/**
 * Fetch BTC deposit + withdrawal history from Binance and import it as
 * transactions for the account's Spot holding, idempotently, walking oldest
 * window first and committing each window's rows before advancing the
 * watermark past it. Runs AFTER the balance sync (which creates/updates the
 * Spot holding), so the holding it attaches to already exists. A missing Spot
 * holding, missing credentials, or an active post-429/418 cooldown is a no-op.
 * `complete: false` means history remains behind and a later run will resume
 * from the watermark; a history request failure OTHER than a rate limit
 * rejects, so the caller can log it without failing the balance sync.
 */
export const syncBinanceTransactions = (
  request: { targetAccountId: string },
  overrides: Partial<BinanceTransactionSyncDeps> = {},
): Promise<{ imported: number; complete: boolean }> =>
  runSync({ ...defaultBinanceTransactionDeps, ...overrides }, request.targetAccountId);
