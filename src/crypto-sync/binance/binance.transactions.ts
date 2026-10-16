import { match } from 'ts-pattern';
import { DAY_MS } from '@kiko/dates';
import {
  BINANCE_HISTORY_CURSOR_FIELD,
  BINANCE_HISTORY_PENDING_OVERLAP_FIELD,
  BINANCE_HISTORY_POINT_CURSOR_FIELD,
  BINANCE_HISTORY_RANGE_CURSOR_FIELD,
  BINANCE_HISTORY_RESCAN_CURSOR_FIELD,
  BINANCE_HISTORY_SPAN_HINTS_FIELD,
  binanceWalkCursorOf,
} from '@kiko/holdings/holding-metadata';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { transactionsRepo } from '@kiko/transactions/repo';
import { type ExchangeHolding, holdingsRepo } from '@kiko/holdings/repo';

import {
  advanceWalkMarks,
  BinanceWalkStop,
  btcSatoshis,
  dropReadPoints,
  halfOf,
  planWalkPasses,
  readPendingMark,
  readWalkRoundRobins,
  resolveWalletHoldings,
  roundRobinHooksOf,
  runWalkPlan,
  type SpanCommit,
  type SpanRead,
  type WalkMarkFields,
  type WalkMarks,
  walkSpans,
  type WalkPass,
  type WalkPlan,
  type WalkResult,
  walkWritersOf,
  type WalkWindow,
} from './binance.history-walk';
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
  type UnreadableRow,
} from './binance.history-client';
import {
  commitSettledSpan,
  instantAt,
  joinSettled,
  settleRecords,
  settleUnreadable,
} from './binance.history-records';
import { type BinanceCredentials, readCredentials } from './binance.credentials';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';
import { type BinanceWalkWriteDeps, defaultWalkWriteDeps } from './binance.walk-write-deps';
import { BINANCE_ASSET, BinanceRateLimitError, type FetchAccountOptions } from './binance.client';
import { type BinanceWalletKey, binanceKeyOf, FUNDING_KEY, SPOT_KEY } from './binance.holding-keys';

/** The stop of a row the client could not read: logged by its code alone, never its content. */
const CAPITAL_ROW_UNREADABLE = 'capital-row-unreadable';

/** Binance's own settled states: a credited deposit, a completed withdrawal. */
const DEPOSIT_STATUS_SUCCESS = 1;
const WITHDRAW_STATUS_COMPLETED = 6;

/**
 * One history window's span. Binance rejects a `startTime`/`endTime` gap of 90
 * days or more, so the walk uses 89 days to stay strictly under the cap.
 */
const WINDOW_MS = 89 * DAY_MS;

/**
 * How far behind a cursor a record can still settle. A withdrawal's `applyTime` is when it
 * was REQUESTED; it only becomes settled (status 6, importable) later, so its timestamp can
 * sit slightly behind the cursor. The ground this far behind each forward start is read
 * again after the cursor has moved on (by the re-scan, or from the pending overlap list when
 * the window does not reach it); the `(source, external_id)` upsert makes that idempotent.
 * The Pay walk keeps the same slack.
 */
export const RESYNC_OVERLAP_MS = DAY_MS;

/**
 * The first-sync floor: Binance opened to the public in July 2017, so no BTC
 * deposit predates this. A first sync (no imported record yet) walks from here
 * to now; later syncs start from the cursor instead. Exported for the walk test.
 */
export const HISTORY_FLOOR_MS = Date.UTC(2017, 6, 14);

const CAPITAL_MARK_FIELDS: WalkMarkFields = {
  cursor: BINANCE_HISTORY_CURSOR_FIELD,
  rescan: BINANCE_HISTORY_RESCAN_CURSOR_FIELD,
  point: BINANCE_HISTORY_POINT_CURSOR_FIELD,
  range: BINANCE_HISTORY_RANGE_CURSOR_FIELD,
  hints: BINANCE_HISTORY_SPAN_HINTS_FIELD,
  pending: BINANCE_HISTORY_PENDING_OVERLAP_FIELD,
};

/** Safety stop on the window walk, so a bad clock cannot spin an unbounded loop. */
const MAX_WINDOWS = 80;

/** Safety stop on offset paging within one span (1000 rows/page × 50 = 50k). */
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
export type BinanceTransactionSyncDeps = BinanceWalkWriteDeps & {
  now: () => number;
  fetchImpl: typeof fetch;
  readCredentials: (accountId: string) => Promise<BinanceCredentials | undefined>;
  listHoldings: (accountId: string) => Promise<HoldingRow[]>;
  /** Creates a wallet holding the walk needs at zero; never touches an existing one. */
  ensureHoldings: (holdings: ExchangeHolding[]) => Promise<void>;
  /** Which of these external ids a stored Binance row already holds, on any holding. */
  storedExternalIds: (externalIds: string[]) => Promise<Set<string>>;
  /**
   * The legacy fallback cursor: only consulted when the holding carries no watermark yet. It
   * reads the newest row whose external id starts with one of the prefixes, the capital rows
   * alone, so a Pay, Transfer or Earn row on the same holding never moves the capital walk.
   */
  latestTransactionTime: (
    holdingId: string,
    externalIdPrefixes: string[],
  ) => Promise<number | undefined>;
  addTransactions: (rows: BinanceTransactionRow[]) => Promise<number>;
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
  ...defaultWalkWriteDeps,
  now: () => Date.now(),
  fetchImpl: fetch,
  readCredentials,
  listHoldings: async (accountId) => holdingsRepo.listByAccountQuery(accountId),
  ensureHoldings: (holdings) => holdingsRepo.ensureExchangeHoldings(holdings),
  storedExternalIds: (externalIds) =>
    transactionsRepo.storedExternalIdsQuery('binance', externalIds),
  latestTransactionTime: async (holdingId, externalIdPrefixes) =>
    (await transactionsRepo.latestSyncedTimeQuery(holdingId, 'binance', externalIdPrefixes)).at(0)
      ?.time,
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
  accountId: string;
  spot: HoldingRow;
  apiKey: string;
  secret: string;
  options: FetchAccountOptions;
  marks: WalkMarks;
  plan: WalkPlan;
};

/**
 * One endpoint's records for a span (`rows` that parsed, `unreadable` that did not), or the half
 * to ask for instead.
 */
type Paged<Row> =
  | { kind: 'rows'; rows: Row[]; unreadable: UnreadableRow[] }
  | { kind: 'split'; half: WalkWindow };

/**
 * Page one span of one endpoint, spending the run's shared budget one call at a time and
 * refreshing it from each response's own reported weight. Every request first passes the
 * shared gate, so a wide walk's requests are spaced rather than fired back-to-back.
 *
 * A first page that is full means the span may hold more records than it shows. A span
 * that can be halved (`half`) is not paged through then: it is answered with its half, so
 * a heavy span is cut down to pieces that fit one call each and commit one by one. That is
 * what lets a run make progress on an account with more records in a span than one run's
 * calls can page. Only a span of one millisecond is offset-paged until a short page.
 *
 * Returns `undefined` the instant the NEXT page is unaffordable, rather than partial data
 * the caller must not commit.
 */
const fetchAllInWindow = async <Row>(
  run: BinanceHistoryRun,
  budgeted: { lane: BudgetLane; cost: CallCost; half: WalkWindow | undefined; keep?: number },
  fetchPage: (offset: number) => Promise<HistoryPage<Row>>,
): Promise<Paged<Row> | undefined> => {
  const rows: Row[] = [];
  const unreadable: UnreadableRow[] = [];

  for (let pageIndex = 0; pageIndex < MAX_PAGES_PER_WINDOW; pageIndex += 1) {
    if (!run.budget.canAfford(budgeted.lane, budgeted.cost, budgeted.keep)) {
      return undefined;
    }

    await run.gate.wait();
    const page = await fetchPage(pageIndex * HISTORY_PAGE_LIMIT);
    run.budget.record(budgeted.lane, page);
    rows.push(...page.rows);
    unreadable.push(...page.unreadable);

    // An unreadable row fills the page as much as a row that parsed.
    if (page.rows.length + page.unreadable.length < HISTORY_PAGE_LIMIT) {
      return { kind: 'rows', rows, unreadable };
    }

    if (budgeted.half !== undefined) {
      return { kind: 'split', half: budgeted.half };
    }
  }

  return { kind: 'rows', rows, unreadable };
};

type SpanRecords = {
  deposits: BinanceDeposit[];
  withdrawals: BinanceWithdrawal[];
  unreadableDeposits: UnreadableRow[];
  unreadableWithdrawals: UnreadableRow[];
};

/**
 * Fetch one span's deposits and withdrawals. `undefined` is a clean stop: the budget ran
 * out, or Binance rate-limited (which also sets the account's cooldown). Any other error
 * rethrows, leaving every EARLIER span's commit in place.
 */
const readSpan = async (
  context: WindowContext,
  span: WalkWindow,
  keep: number,
): Promise<SpanRead<SpanRecords> | undefined> => {
  const { deps, run, accountId, apiKey, secret, options } = context;
  const half = halfOf(span);
  const pageWindow = (offset: number): HistoryWindow => ({
    startTime: span.start,
    endTime: span.end,
    offset,
  });

  try {
    const deposits = await fetchAllInWindow(
      run,
      { lane: 'capitalDeposit', cost: COSTS.deposit, half },
      (offset) => deps.fetchDepositHistory(apiKey, secret, pageWindow(offset), options),
    );

    if (deposits === undefined || deposits.kind === 'split') {
      return deposits;
    }

    const withdrawals = await fetchAllInWindow(
      run,
      { lane: 'capitalWithdraw', cost: COSTS.withdraw, half, keep },
      (offset) => deps.fetchWithdrawHistory(apiKey, secret, pageWindow(offset), options),
    );

    if (withdrawals === undefined || withdrawals.kind === 'split') {
      return withdrawals;
    }

    return {
      kind: 'page',
      page: {
        deposits: deposits.rows,
        withdrawals: withdrawals.rows,
        unreadableDeposits: deposits.unreadable,
        unreadableWithdrawals: withdrawals.unreadable,
      },
    };
  } catch (error) {
    if (error instanceof BinanceRateLimitError) {
      setBinanceCooldownUntil(accountId, deps.now() + error.retryAfterMs);

      return undefined;
    }

    throw error;
  }
};

/**
 * Turn the planned rows into importable ones, creating a missing wallet holding at
 * zero first, but only for a wallet that receives a row whose key is new. A row
 * whose key is already stored keeps its stored holding (the upsert never moves it),
 * so it must not conjure an empty holding it will never sit on; if its wallet has
 * none it travels under `spot`, which the upsert ignores. A wallet that cannot be
 * resolved even after creation stops the window.
 */
const placeRows = async (
  context: WindowContext,
  planned: PlannedRow[],
): Promise<BinanceTransactionRow[]> => {
  if (planned.length === 0) {
    return [];
  }

  const { deps, accountId, spot } = context;
  // This lookup runs outside the `addManyDedup` write. A user delete of a stored row in
  // that gap re-inserts it on the placeholder holding (`spot`), exactly as a row the
  // walk had never imported would be: nothing is lost, only the user's delete is undone.
  const stored = await deps.storedExternalIds(planned.map((row) => row.externalId));
  const newRows = planned.filter((row) => !stored.has(row.externalId));
  const holdings = await resolveWalletHoldings({
    accountId,
    keys: [...new Set(planned.map((row) => row.wallet))],
    createKeys: [...new Set(newRows.map((row) => row.wallet))],
    listHoldings: deps.listHoldings,
    ensureHoldings: deps.ensureHoldings,
  });

  return planned.map(({ wallet, ...row }) => {
    const holding = holdings.get(wallet) ?? (stored.has(row.externalId) ? spot : undefined);

    if (holding === undefined) {
      throw new BinanceWalkStop('capital-holding-missing');
    }

    return { ...row, holdingId: holding.id };
  });
};

/**
 * A withdrawal's `applyTime` has a precision of one second, and is cut or rounded to it: the
 * record sits in the second before its time or in the second after it, so the ground one stuck
 * withdrawal owes reaches a second either way (with the millisecond the point adds, 1000 ms each
 * side of the time).
 */
const APPLY_TIME_PRECISION_MS = 1_000;

type SpanRecord =
  | { kind: 'deposit'; record: BinanceDeposit }
  | { kind: 'withdraw'; record: BinanceWithdrawal };

const plannedOf = (accountId: string, entry: SpanRecord): PlannedRow[] =>
  match(entry)
    .returnType<(PlannedRow | null)[]>()
    .with({ kind: 'deposit' }, ({ record }) => [plannedDepositOf(accountId, record)])
    .with({ kind: 'withdraw' }, ({ record }) => [plannedWithdrawalOf(accountId, record)])
    .exhaustive()
    .filter((row): row is PlannedRow => row !== null);

/**
 * The milliseconds a withdrawal may sit in: every millisecond a second either side of its time
 * (which Binance may have cut or rounded to the second).
 */
const withdrawalExtentOf = (applyTime: string | number): WalkWindow => {
  const time = parseWithdrawTime(applyTime);

  return {
    start: time - (APPLY_TIME_PRECISION_MS - 1),
    end: time + (APPLY_TIME_PRECISION_MS - 1),
  };
};

/** The milliseconds a record may sit in: its time, or those of a withdrawal's second. */
const extentOf = (entry: SpanRecord): WalkWindow | undefined =>
  match(entry)
    .returnType<WalkWindow | undefined>()
    .with({ kind: 'deposit' }, ({ record }) => instantAt(record.insertTime))
    .with({ kind: 'withdraw' }, ({ record }) => withdrawalExtentOf(record.applyTime))
    .exhaustive();

/**
 * Where a row the client could not read may sit, when its own time field was usable: like a
 * deposit, the millisecond of a number; like a withdrawal, the seconds around a time that may be
 * a datetime text. A time that does not parse gives an extent that is not finite, which the walk
 * reads as no time at all.
 */
const unreadableExtentOf = (kind: SpanRecord['kind'], row: UnreadableRow): WalkWindow | undefined =>
  foldMap(maybe(row.time), (time) =>
    kind === 'deposit' ? instantAt(Number(time)) : withdrawalExtentOf(time),
  );

/**
 * Commit one span: place and write the rows of the records the walk can trust, then move the
 * walk's marks (see `commitSettledSpan`: rows first, marks second, so a crash between the two
 * just re-imports idempotently, and a record the walk cannot trust stays owed at its own point,
 * or stops the forward pass).
 */
const commitSpan = (
  context: WindowContext,
  span: WalkWindow,
  records: SpanRecords,
  pass: WalkPass,
): Promise<SpanCommit | undefined> => {
  const { deps, accountId, spot, plan, marks } = context;

  return commitSettledSpan({
    pass,
    span,
    settled: joinSettled<PlannedRow>([
      settleRecords({
        span,
        records: [
          ...records.deposits.map((record): SpanRecord => ({ kind: 'deposit', record })),
          ...records.withdrawals.map((record): SpanRecord => ({ kind: 'withdraw', record })),
        ],
        rowsOf: (entry) => plannedOf(accountId, entry),
        extentOf,
      }),
      settleUnreadable({
        span,
        unreadable: records.unreadableDeposits,
        code: CAPITAL_ROW_UNREADABLE,
        extentOf: (row) => unreadableExtentOf('deposit', row),
      }),
      settleUnreadable({
        span,
        unreadable: records.unreadableWithdrawals,
        code: CAPITAL_ROW_UNREADABLE,
        extentOf: (row) => unreadableExtentOf('withdraw', row),
      }),
    ]),
    place: (planned) => placeRows(context, planned),
    add: deps.addTransactions,
    advance: ({ owed }) =>
      advanceWalkMarks({
        pass,
        span,
        owed,
        plan,
        marks,
        restartMs: HISTORY_FLOOR_MS,
        fields: CAPITAL_MARK_FIELDS,
        write: (field, cursorMs) => deps.writeWalkCursor(spot.id, field, cursorMs),
        writePending: (field, ranges) => deps.writeWalkPending(spot.id, field, ranges),
      }),
  });
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
  // or a first sync) falls back to the newest already-imported capital record.
  const cursor = binanceWalkCursorOf(CAPITAL_MARK_FIELDS.cursor, spot.metadata);
  const rescanCursor = binanceWalkCursorOf(CAPITAL_MARK_FIELDS.rescan, spot.metadata);
  const writers = walkWritersOf(spot.id, deps);
  const roundRobins = await readWalkRoundRobins({
    fields: CAPITAL_MARK_FIELDS,
    metadata: spot.metadata,
    ...writers,
  });
  // An account with no capital row falls back to nothing, and so starts at the floor.
  const latest = await deps.latestTransactionTime(spot.id, [
    `${accountId}:deposit:`,
    `${accountId}:withdraw:`,
  ]);
  const planCursor = cursor ?? latest ?? null;
  const pending = await readPendingMark({
    field: CAPITAL_MARK_FIELDS.pending,
    metadata: spot.metadata,
    owedIfUnreadable: { start: HISTORY_FLOOR_MS, end: planCursor ?? HISTORY_FLOOR_MS },
    write: (field, ranges) => deps.writeWalkPending(spot.id, field, ranges),
  });
  const plan = planWalkPasses({
    cursor: planCursor,
    rescanCursor,
    pointCursor: roundRobins.pointCursor,
    rangeCursor: roundRobins.rangeCursor,
    pending,
    floorMs: HISTORY_FLOOR_MS,
    endTime: now,
    windowMs: WINDOW_MS,
    overlapMs: RESYNC_OVERLAP_MS,
    maxWindows: MAX_WINDOWS,
  });
  const context: WindowContext = {
    deps,
    run,
    accountId,
    spot,
    apiKey,
    secret,
    options,
    marks: { cursor, rescanCursor, ...roundRobins, pending },
    plan,
  };

  return runWalkPlan({
    plan,
    canAfford: (keep) =>
      run.budget.canAfford('capitalWithdraw', COSTS.withdraw, keep) &&
      !isBinanceCoolingDown(accountId, deps.now()),
    runWindow: (window, pass, keep, hint) =>
      walkSpans({
        window,
        read: (span, keepCalls) => readSpan(context, span, keepCalls),
        commit: (span, records) => commitSpan(context, span, records, pass),
        keep,
        hint,
        onComplete: (read) =>
          dropReadPoints({
            pass,
            window,
            read,
            marks: context.marks,
            fields: CAPITAL_MARK_FIELDS,
            writePending: (field, ranges) => deps.writeWalkPending(spot.id, field, ranges),
          }),
      }),
    ...roundRobinHooksOf({ marks: context.marks, fields: CAPITAL_MARK_FIELDS, ...writers }),
  });
};

/**
 * Fetch BTC deposit + withdrawal history from Binance and import it as
 * transactions on the wallet holding each movement names (Spot, or Funding for
 * `walletType` 1), idempotently, committing each span's rows before advancing the
 * mark past it. A run goes forward from the watermark first, then reads the overlap ground
 * earlier runs left owed, then re-scans the last window behind the watermark, each on what
 * budget is left (see `planWalkPasses`). Runs AFTER the balance
 * sync (which creates/updates the Spot holding), so the Spot holding it anchors on
 * already exists. A missing Spot holding, missing credentials, or an active
 * post-429/418 cooldown is a no-op. `complete: false` means history, owed ground or the
 * re-scan remains and a later run will resume from the stored marks; a history request failure
 * OTHER than a rate limit rejects, so the caller can log it without failing the balance
 * sync.
 */
export const syncBinanceTransactions = (
  request: { targetAccountId: string; run: BinanceHistoryRun },
  overrides: Partial<BinanceTransactionSyncDeps> = {},
): Promise<WalkResult> =>
  runSync({ ...defaultBinanceTransactionDeps, ...overrides }, request.targetAccountId, request.run);
