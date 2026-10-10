import { match } from 'ts-pattern';
import { DAY_MS } from '@kiko/dates';
import {
  BINANCE_HISTORY_CURSOR_FIELD,
  binanceWalkCursorOf,
  type BinanceWalkCursorField,
} from '@kiko/holdings/holding-metadata';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { transactionsRepo } from '@kiko/transactions/repo';
import { type ExchangeHolding, holdingsRepo } from '@kiko/holdings/repo';

import {
  BinanceWalkStop,
  btcSatoshis,
  buildWalkWindows,
  logWalkNotice,
  logWalkStop,
  resolveWalkStart,
  resolveWalletHoldings,
  type WalkResult,
  type WalkWindow,
} from './binance.history-walk';
import {
  createMovementLedger,
  type MovementLedger,
  type StoredMovementRow,
  twinsOf,
} from './binance.overlap-guard';
import {
  type BinanceHistoryRun,
  type BudgetLane,
  type CallCost,
  COSTS,
} from './binance.history-budget';
import {
  type BinanceDeposit,
  type BinanceWithdrawal,
  fetchDepositHistory,
  fetchWithdrawHistory,
  HISTORY_PAGE_LIMIT,
  type HistoryPage,
  type HistoryWindow,
} from './binance.history-client';
import { type BinanceCredentials, readCredentials } from './binance.credentials';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';
import { BINANCE_ASSET, BinanceRateLimitError, type FetchAccountOptions } from './binance.client';
import { type BinanceWalletKey, binanceKeyOf, FUNDING_KEY, SPOT_KEY } from './binance.holding-keys';

/** Binance's own settled states: a credited deposit, a completed withdrawal. */
const DEPOSIT_STATUS_SUCCESS = 1;
const WITHDRAW_STATUS_COMPLETED = 6;

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
 * upsert makes the re-scan idempotent. The Pay walk keeps the same slack.
 */
export const RESYNC_OVERLAP_MS = DAY_MS;

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
 * The injectable seams of the capital history walk: the two history reads, the
 * credential + holding reads, the holding creation and walk-cursor writes, the
 * newest-imported-time cursor read, and the deduping import. Mirrors `BinanceDeps`
 * in `binance.provider.ts`. Pacing and the weight budget come from the run.
 */
export type BinanceTransactionSyncDeps = {
  now: () => number;
  fetchImpl: typeof fetch;
  readCredentials: (accountId: string) => Promise<BinanceCredentials | undefined>;
  listHoldings: (accountId: string) => Promise<HoldingRow[]>;
  /** Creates a wallet holding the walk needs at zero; never touches an existing one. */
  ensureHoldings: (holdings: ExchangeHolding[]) => Promise<void>;
  /** Which of these external ids a stored Binance row already holds, on any holding. */
  storedExternalIds: (externalIds: string[]) => Promise<Set<string>>;
  /** The legacy fallback cursor: only consulted when the holding carries no watermark yet. */
  latestTransactionTime: (holdingId: string) => Promise<number | undefined>;
  /** The rows already on a holding, for the guard against a Pay row that repeats a record. */
  listHoldingTransactions: (holdingId: string) => Promise<StoredMovementRow[]>;
  addTransactions: (rows: BinanceTransactionRow[]) => Promise<number>;
  /** Advances one walk's own watermark once a window's rows have committed. */
  writeWalkCursor: (
    holdingId: string,
    field: BinanceWalkCursorField,
    cursorMs: number,
  ) => Promise<void>;
  fetchDepositHistory: (
    apiKey: string,
    secret: string,
    window: HistoryWindow,
    options?: FetchAccountOptions,
  ) => Promise<HistoryPage<BinanceDeposit>>;
  fetchWithdrawHistory: (
    apiKey: string,
    secret: string,
    window: HistoryWindow,
    options?: FetchAccountOptions,
  ) => Promise<HistoryPage<BinanceWithdrawal>>;
};

const defaultBinanceTransactionDeps: BinanceTransactionSyncDeps = {
  now: () => Date.now(),
  fetchImpl: fetch,
  readCredentials,
  listHoldings: async (accountId) => holdingsRepo.listByAccountQuery(accountId),
  ensureHoldings: (holdings) => holdingsRepo.ensureExchangeHoldings(holdings),
  storedExternalIds: (externalIds) =>
    transactionsRepo.storedExternalIdsQuery('binance', externalIds),
  latestTransactionTime: async (holdingId) =>
    (await transactionsRepo.latestSyncedTimeQuery(holdingId, 'binance')).at(0)?.time,
  listHoldingTransactions: async (holdingId) => transactionsRepo.listByHoldingQuery(holdingId),
  addTransactions: (rows) => transactionsRepo.addManyDedup(rows),
  writeWalkCursor: (holdingId, field, cursorMs) =>
    holdingsRepo.setBinanceWalkCursor(holdingId, field, cursorMs),
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

/** Binance's own record id, falling back to the on-chain tx id, or '' if neither. */
const recordKey = (record: { id: string; txId: string }): string => record.id || record.txId || '';

/**
 * A capital movement lands on the wallet Binance names: `walletType` 0 is Spot, 1
 * is Funding, and an absent one is Spot (the field is not sent on every account).
 * Any other value is a wallet this walk does not know, and guessing would put a
 * row on the wrong holding.
 */
const walletOf = (walletType: number | undefined): BinanceWalletKey =>
  match(walletType)
    .returnType<BinanceWalletKey>()
    .with(undefined, 0, () => SPOT_KEY)
    .with(1, () => FUNDING_KEY)
    .otherwise(() => {
      throw new BinanceWalkStop('capital-wallet-unknown');
    });

/** A row mapped from a settled record, before its wallet is turned into a holding. */
type PlannedRow = Omit<BinanceTransactionRow, 'holdingId'> & { wallet: BinanceWalletKey };

/**
 * Map one SETTLED record to a row. A record the walk cannot trust (no id, a
 * non-numeric amount, an unreadable time, an unknown wallet) stops the window: a
 * skipped row would be silent loss.
 */
const plannedRowOf = (input: {
  accountId: string;
  kind: 'deposit' | 'withdraw';
  direction: 1 | -1;
  record: { id: string; txId: string; amount: string; walletType: number | undefined };
  time: number;
}): PlannedRow => {
  const { accountId, kind, direction, record, time } = input;
  const key = recordKey(record);

  if (key === '') {
    throw new BinanceWalkStop('capital-id-missing');
  }

  const satoshis = btcSatoshis(record.amount);

  if (satoshis === null) {
    throw new BinanceWalkStop('capital-amount-invalid');
  }

  if (!Number.isFinite(time)) {
    throw new BinanceWalkStop('capital-time-invalid');
  }

  return {
    wallet: walletOf(record.walletType),
    amountMinorUnits: direction * satoshis,
    time,
    source: 'binance',
    externalId: `${accountId}:${kind}:${key}`,
    // The stable, non-localized asset ticker, NOT a t(...) call. A blank
    // description normalizes to '' so the category-apply sheet is skipped for a
    // crypto row; a stable ticker gives the name rule something to
    // match, so the sheet appears with parity to a Monobank merchant row. It
    // must stay non-localized — a localized label would change under a language
    // switch and break name matching.
    description: BINANCE_ASSET,
  };
};

/** The row of a deposit, or `null` while it is not settled. */
const plannedDepositOf = (accountId: string, record: BinanceDeposit): PlannedRow | null => {
  if (record.status !== DEPOSIT_STATUS_SUCCESS) {
    return null;
  }

  return plannedRowOf({
    accountId,
    kind: 'deposit',
    direction: 1,
    record,
    time: record.insertTime,
  });
};

/**
 * The row of a withdrawal, or `null` while it is not completed. The network fee
 * (`transactionFee`) is not part of the ledger line — the row shows the amount the
 * user sent.
 */
const plannedWithdrawalOf = (accountId: string, record: BinanceWithdrawal): PlannedRow | null => {
  if (record.status !== WITHDRAW_STATUS_COMPLETED) {
    return null;
  }

  return plannedRowOf({
    accountId,
    kind: 'withdraw',
    direction: -1,
    record,
    time: parseWithdrawTime(record.applyTime),
  });
};

type WindowContext = {
  deps: BinanceTransactionSyncDeps;
  run: BinanceHistoryRun;
  apiKey: string;
  secret: string;
  options: FetchAccountOptions;
  ledger: MovementLedger;
};

/**
 * Offset-page one window of one endpoint until a page shorter than the limit,
 * spending the run's shared budget one call at a time and refreshing it from each
 * response's own reported weight. Every request first passes the shared gate, so a
 * wide walk's requests are spaced rather than fired back-to-back. Returns
 * `undefined` the instant the NEXT page is unaffordable, rather than partial data
 * the caller must not commit.
 */
const fetchAllInWindow = async <Row>(
  run: BinanceHistoryRun,
  budgeted: { lane: BudgetLane; cost: CallCost },
  fetchPage: (offset: number) => Promise<HistoryPage<Row>>,
): Promise<Row[] | undefined> => {
  const rows: Row[] = [];

  for (let pageIndex = 0; pageIndex < MAX_PAGES_PER_WINDOW; pageIndex += 1) {
    if (!run.budget.canAfford(budgeted.lane, budgeted.cost)) {
      return undefined;
    }

    await run.gate.wait();
    // Known limit: the budget resets each RUN, not each window, so a window
    // needing more pages than its lane cap (over 9,000 withdrawals in one 89-day
    // span) would stop on every run and never complete — unrealistic for a
    // personal account.
    const page = await fetchPage(pageIndex * HISTORY_PAGE_LIMIT);
    run.budget.record(budgeted.lane, page);
    rows.push(...page.rows);

    if (page.rows.length < HISTORY_PAGE_LIMIT) {
      return rows;
    }
  }

  return rows;
};

type WindowRecords = { deposits: BinanceDeposit[]; withdrawals: BinanceWithdrawal[] };

/**
 * Fetch one window's deposits and withdrawals. `undefined` is a clean stop: the
 * budget ran out, or Binance rate-limited (which also sets the account's
 * cooldown). Any other error rethrows, leaving every EARLIER window's commit in place.
 */
const fetchWindowRecords = async (
  context: WindowContext,
  accountId: string,
  window: WalkWindow,
): Promise<WindowRecords | undefined> => {
  const { deps, run, apiKey, secret, options } = context;
  const pageWindow = (offset: number): HistoryWindow => ({
    startTime: window.start,
    endTime: window.end,
    offset,
  });

  try {
    const deposits = await fetchAllInWindow(
      run,
      { lane: 'capitalDeposit', cost: COSTS.deposit },
      (offset) => deps.fetchDepositHistory(apiKey, secret, pageWindow(offset), options),
    );

    if (deposits === undefined) {
      return undefined;
    }

    const withdrawals = await fetchAllInWindow(
      run,
      { lane: 'capitalWithdraw', cost: COSTS.withdraw },
      (offset) => deps.fetchWithdrawHistory(apiKey, secret, pageWindow(offset), options),
    );

    return foldMap(maybe(withdrawals), (rows) => ({ deposits, withdrawals: rows }));
  } catch (error) {
    if (error instanceof BinanceRateLimitError) {
      setBinanceCooldownUntil(accountId, deps.now() + error.retryAfterMs);

      return undefined;
    }

    throw error;
  }
};

/**
 * The new rows that are the twin of a Pay row already stored on any Binance BTC holding of
 * the account. The Pay walk judges its rows against stored capital rows, but a capital
 * record that settles late is imported behind the capital watermark after a Pay row for the
 * same movement, so this walk checks the other way round. Nothing is read when no row is new.
 */
const twinsOfStoredPayRows = async (
  ledger: MovementLedger,
  newRows: PlannedRow[],
): Promise<Set<string>> => {
  if (newRows.length === 0) {
    return new Set();
  }

  const stored = await ledger.read();

  return twinsOf({
    kind: 'capital',
    candidates: newRows,
    sameKind: stored.capital,
    otherKind: stored.pay,
  });
};

/**
 * Turn the planned rows into importable ones, creating a missing wallet holding at
 * zero first, but only for a wallet that receives a row whose key is new. A row
 * whose key is already stored keeps its stored holding (the upsert never moves it),
 * so it must not conjure an empty holding it will never sit on; if its wallet has
 * none it travels under `spot`, which the upsert ignores. A new row that is the twin of a
 * stored Pay row is left out. A wallet that cannot be resolved even after creation stops
 * the window.
 */
const placeRows = async (
  context: WindowContext,
  accountId: string,
  spot: HoldingRow,
  planned: PlannedRow[],
): Promise<BinanceTransactionRow[]> => {
  if (planned.length === 0) {
    return [];
  }

  const { deps, ledger } = context;
  // This lookup runs outside the `addManyDedup` write. A user delete of a stored row in
  // that gap re-inserts it on the placeholder holding (`spot`), exactly as a row the
  // walk had never imported would be: nothing is lost, only the user's delete is undone.
  const stored = await deps.storedExternalIds(planned.map((row) => row.externalId));
  const twins = await twinsOfStoredPayRows(
    ledger,
    planned.filter((row) => !stored.has(row.externalId)),
  );

  if (twins.size > 0) {
    logWalkNotice('capital-overlap-skip');
  }

  const kept = planned.filter((row) => !twins.has(row.externalId));
  const newRows = kept.filter((row) => !stored.has(row.externalId));
  const holdings = await resolveWalletHoldings({
    accountId,
    keys: [...new Set(kept.map((row) => row.wallet))],
    createKeys: [...new Set(newRows.map((row) => row.wallet))],
    listHoldings: deps.listHoldings,
    ensureHoldings: deps.ensureHoldings,
  });

  return kept.map(({ wallet, ...row }) => {
    const holding = holdings.get(wallet) ?? (stored.has(row.externalId) ? spot : undefined);

    if (holding === undefined) {
      throw new BinanceWalkStop('capital-holding-missing');
    }

    return { ...row, holdingId: holding.id };
  });
};

/** One window's outcome: committed (rows durable, watermark advanced) or a clean stop. */
type WindowOutcome = { kind: 'committed'; imported: number } | { kind: 'stop' };

/**
 * Run one window: fetch deposits + withdrawals, then either commit (rows first,
 * watermark second — crash-safe: a crash between the two just re-imports
 * idempotently next run) or stop cleanly without committing.
 */
const runOneWindow = async (
  context: WindowContext,
  accountId: string,
  spot: HoldingRow,
  window: WalkWindow,
): Promise<WindowOutcome> => {
  const { deps } = context;
  const records = await fetchWindowRecords(context, accountId, window);

  if (records === undefined) {
    // Not committed and not marked — the next run redoes this window from the
    // SAME (unmoved) cursor.
    return { kind: 'stop' };
  }

  let rows: BinanceTransactionRow[];

  try {
    const planned = [
      ...records.deposits.map((record) => plannedDepositOf(accountId, record)),
      ...records.withdrawals.map((record) => plannedWithdrawalOf(accountId, record)),
    ].filter((row): row is PlannedRow => row !== null);

    rows = await placeRows(context, accountId, spot, planned);
  } catch (error) {
    if (error instanceof BinanceWalkStop) {
      logWalkStop(error.code);

      return { kind: 'stop' };
    }

    throw error;
  }

  let imported = 0;

  if (rows.length > 0) {
    imported = await deps.addTransactions(rows);
    context.ledger.remember(rows);
  }

  await deps.writeWalkCursor(spot.id, BINANCE_HISTORY_CURSOR_FIELD, window.end);

  return { kind: 'committed', imported };
};

const runSync = async (
  deps: BinanceTransactionSyncDeps,
  accountId: string,
  run: BinanceHistoryRun,
): Promise<WalkResult> => {
  const now = deps.now();

  if (isBinanceCoolingDown(accountId, now)) {
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
  // The watermark takes priority; a holding that never had one (legacy data,
  // or a first sync) falls back to the newest already-imported record.
  const cursor = binanceWalkCursorOf(BINANCE_HISTORY_CURSOR_FIELD, spot.metadata);
  const latest = await deps.latestTransactionTime(spot.id);
  const windows = buildWalkWindows(
    resolveWalkStart({
      cursor: cursor ?? latest ?? null,
      floorMs: HISTORY_FLOOR_MS,
      endTime: now,
      windowMs: WINDOW_MS,
      overlapMs: RESYNC_OVERLAP_MS,
    }),
    now,
    WINDOW_MS,
    MAX_WINDOWS,
  );
  const context: WindowContext = {
    deps,
    run,
    apiKey,
    secret,
    options,
    ledger: createMovementLedger({
      accountId,
      listHoldings: deps.listHoldings,
      listHoldingTransactions: deps.listHoldingTransactions,
    }),
  };
  let imported = 0;

  for (const window of windows) {
    if (!run.budget.canAfford('capitalWithdraw', COSTS.withdraw)) {
      return { imported, complete: false };
    }

    const outcome = await runOneWindow(context, accountId, spot, window);

    if (outcome.kind === 'stop') {
      return { imported, complete: false };
    }

    imported += outcome.imported;
  }

  return { imported, complete: true };
};

/**
 * Fetch BTC deposit + withdrawal history from Binance and import it as
 * transactions on the wallet holding each movement names (Spot, or Funding for
 * `walletType` 1), idempotently, walking oldest window first and committing each
 * window's rows before advancing the watermark past it. Runs AFTER the balance
 * sync (which creates/updates the Spot holding), so the Spot holding it anchors on
 * already exists. A missing Spot holding, missing credentials, or an active
 * post-429/418 cooldown is a no-op. `complete: false` means history remains behind
 * and a later run will resume from the watermark; a history request failure OTHER
 * than a rate limit rejects, so the caller can log it without failing the balance
 * sync.
 */
export const syncBinanceTransactions = (
  request: { targetAccountId: string; run: BinanceHistoryRun },
  overrides: Partial<BinanceTransactionSyncDeps> = {},
): Promise<WalkResult> =>
  runSync({ ...defaultBinanceTransactionDeps, ...overrides }, request.targetAccountId, request.run);
