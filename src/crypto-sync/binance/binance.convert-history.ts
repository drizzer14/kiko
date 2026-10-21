import { DAY_MS } from '@kiko/dates';
import { match, P } from 'ts-pattern';
import {
  advanceWalkMarks,
  AMOUNT_STOP_CODES,
  BinanceWalkStop,
  commitSettledSpan,
  dropReadPoints,
  type ExchangeStateDeps,
  exchangeStateDepsOf,
  halfOf,
  historyListWriterOf,
  instantAt,
  joinSettled,
  notImportedWriterOf,
  placeWalletRows,
  planWalkPasses,
  readPendingMark,
  readWalkMarks,
  readWalkRoundRobins,
  roundRobinHooksOf,
  rowMinorUnits,
  runWalkPlan,
  type SettledSpan,
  type SpanCommit,
  type SpanRead,
  settleRecords,
  settleUnreadable,
  type WalkMarkWriter,
  type WalkMarks,
  type WalkPass,
  type WalkPlan,
  type WalkResult,
  type WalkWindow,
  walkMarkWriterOf,
  walkSpans,
} from '@kiko/crypto-sync/exchange/walk';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import type { Currency } from '@kiko/currency/currency';
import { transactionsRepo } from '@kiko/transactions/repo';
import { notImportedEntry } from '@kiko/crypto-sync/exchange/walk-state';
import { type ExchangeHolding, holdingsRepo } from '@kiko/holdings/repo';
import { untrackedAssetCode } from '@kiko/transactions/untracked-counterpart';

import {
  type BinanceTransactionRow,
  HISTORY_FLOOR_MS,
  RESYNC_OVERLAP_MS,
} from './binance.transactions';
import {
  type BinanceConvertRecord,
  type ConvertHistoryPage,
  fetchConvertHistory,
} from './binance.history-client';
import { BINANCE_WALK_CONFIG } from './binance.walk-config';
import { isTrackedBinanceAsset } from './binance.tracked-coin';
import { type BinanceHistoryRun, COSTS } from './binance.history-budget';
import { type BinanceWallet, holdingKeyOf } from './binance.holding-keys';
import { type BinanceCredentials, readCredentials } from './binance.credentials';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';
import { BinanceRateLimitError, type FetchAccountOptions } from './binance.client';

/** The stop of a conversion that waits on Binance: its point is owed until it settles. */
const CONVERT_NOT_SETTLED = 'convert-not-settled';

/**
 * The stop of a settled conversion that lacks an amount, of a code to mark a lone leg, and of a
 * page row the client could not read, such as one with no quoteId.
 */
const CONVERT_ROW_UNREADABLE = 'convert-row-unreadable';

const CONVERT_AMOUNT_INVALID = 'convert-amount-invalid';

/**
 * The stops of one conversion that the forward pass owes and goes past: the conversion stays owed
 * at its own point until it settles or the floor drops it, and holding the cursor behind it would
 * keep every newer conversion from importing. Like Transfer, it applies only to a conversion with
 * a usable time; a stop that is no one conversion's is not in this list.
 */
export const CONVERT_FORWARD_OWES: readonly string[] = [
  CONVERT_NOT_SETTLED,
  CONVERT_ROW_UNREADABLE,
  CONVERT_AMOUNT_INVALID,
  ...AMOUNT_STOP_CODES,
];

/**
 * A row mapped from a conversion, before its wallets are turned into holdings: `wallet` is the key
 * of the coin's holding it sits on, `counterpartWallet` the other leg's. A lone leg (the other coin
 * is not tracked) has `untrackedCounterpart` instead of a counterpart and a pair id.
 */
type PlannedConvertRow = {
  wallet: string;
  counterpartWallet?: string;
  amountMinorUnits: number;
  time: number;
  externalId: string;
  exchangePairId?: string;
  untrackedCounterpart?: string;
  description: string;
  operation: 'convert';
};

/**
 * What one conversion comes to: its rows with the tickers of the coins Kiko does not track
 * (`rows`, none when neither side is tracked), the entry of a record a rule refuses for good
 * (`refused`), or nothing at all (`none`, a conversion that failed).
 */
type ConvertOutcome =
  | { kind: 'rows'; rows: PlannedConvertRow[]; untracked: string[] }
  | { kind: 'refused'; entry: string }
  | { kind: 'none' };

type ConvertSide = { asset: string; amountText: string | undefined; sign: 1 | -1 };

type TrackedSide = ConvertSide & { asset: Currency };

type ConvertLeg = TrackedSide & { units: number };

const refusedOutcomeOf = (record: BinanceConvertRecord): ConvertOutcome => ({
  kind: 'refused',
  entry: notImportedEntry('convert-unrecognized', record.recordId, record.createTime),
});

const walletOf = (walletType: string | undefined): BinanceWallet | undefined =>
  match(walletType)
    .returnType<BinanceWallet | undefined>()
    .with('FUNDING', () => 'funding')
    .with('SPOT', () => 'spot')
    .otherwise(() => undefined);

const isTracked = (side: ConvertSide): side is TrackedSide => isTrackedBinanceAsset(side.asset);

const legOf = (side: TrackedSide): ConvertLeg => {
  if (side.amountText === undefined) {
    throw new BinanceWalkStop(CONVERT_ROW_UNREADABLE);
  }

  const units = rowMinorUnits(side.asset, side.amountText);

  if (units <= 0) {
    throw new BinanceWalkStop(CONVERT_AMOUNT_INVALID);
  }

  return { ...side, units };
};

const settledOutcomeOf = (accountId: string, record: BinanceConvertRecord): ConvertOutcome => {
  const wallet = walletOf(record.walletType);

  if (wallet === undefined) {
    return refusedOutcomeOf(record);
  }

  // The client keeps '' for a ticker that trims to nothing, so a blank one reads like an absent
  // one; neither changes on a re-read, so the record is refused for good rather than owed.
  const fromAsset = record.fromAsset ?? '';
  const toAsset = record.toAsset ?? '';

  if (fromAsset === '' || toAsset === '' || fromAsset === toAsset) {
    return refusedOutcomeOf(record);
  }

  const sides: ConvertSide[] = [
    { asset: fromAsset, amountText: record.fromAmount, sign: -1 },
    { asset: toAsset, amountText: record.toAmount, sign: 1 },
  ];
  const legs = sides.filter(isTracked).map(legOf);
  const untracked = sides.filter((side) => !isTracked(side)).map(({ asset }) => asset);
  const pairId = `${accountId}:convert:${record.recordId}`;
  const keyOf = (leg: ConvertLeg): string => holdingKeyOf(leg.asset, wallet);
  const baseOf = (leg: ConvertLeg) => ({
    wallet: keyOf(leg),
    amountMinorUnits: leg.sign * leg.units,
    time: record.createTime,
    externalId: `${pairId}:${keyOf(leg)}`,
    description: '',
    operation: 'convert' as const,
  });
  const pairedLegOf = (leg: ConvertLeg, other: ConvertLeg): PlannedConvertRow => ({
    ...baseOf(leg),
    counterpartWallet: keyOf(other),
    exchangePairId: pairId,
  });
  const [otherTicker = ''] = untracked;

  const rows = match(legs)
    .returnType<PlannedConvertRow[]>()
    .with([P._, P._], ([first, second]) => [pairedLegOf(first, second), pairedLegOf(second, first)])
    .with([P._], ([only]) => {
      const untrackedCounterpart = untrackedAssetCode(otherTicker);

      if (untrackedCounterpart === undefined) {
        throw new BinanceWalkStop(CONVERT_ROW_UNREADABLE);
      }

      return [{ ...baseOf(only), untrackedCounterpart }];
    })
    .otherwise(() => []);

  return { kind: 'rows', rows, untracked };
};

/**
 * What one Convert record comes to, decided in the order the status, the wallet, the coins (spec
 * "Convert"). `FAIL` is nothing; a conversion that waits on Binance, or one the walk cannot trust
 * (an amount missing or not above zero on a tracked side), throws a `BinanceWalkStop` and owes its
 * point, because a skipped one would be silent loss; a status or wallet outside the allowlist, a
 * blank coin, and a conversion of a coin into itself, are refused for good into one entry. A side
 * whose coin is not tracked is never read for its amount: the tracked leg stands alone, marked with
 * the other coin, and a conversion of two such coins gives no row.
 */
export const convertOutcomeOf = (input: {
  accountId: string;
  record: BinanceConvertRecord;
}): ConvertOutcome => {
  const { accountId, record } = input;

  return match(record.orderStatus)
    .returnType<ConvertOutcome>()
    .with('SUCCESS', () => settledOutcomeOf(accountId, record))
    .with('PROCESS', 'ACCEPT_SUCCESS', () => {
      throw new BinanceWalkStop(CONVERT_NOT_SETTLED);
    })
    .with('FAIL', () => ({ kind: 'none' }))
    .otherwise(() => refusedOutcomeOf(record));
};

/** Binance rejects a Convert `startTime`/`endTime` gap of more than 30 days. */
export const CONVERT_WINDOW_MS = 30 * DAY_MS;

/**
 * Safety stop on the plan of a run: the lane reads 20 windows at most in a run, so a plan holds no
 * more than that.
 */
const CONVERT_MAX_WINDOWS = 20;

/** The stop of a span that is still full at one millisecond, which may hold more than it shows. */
const CONVERT_PAGE_STUCK = 'convert-page-stuck';

const CONVERT_HOLDING_MISSING = 'convert-holding-missing';

/** The imported-transaction shape the Convert walk hands to `transactionsRepo.addManyDedup`. */
type BinanceConvertRow = BinanceTransactionRow & {
  exchangeCounterpartHoldingId?: string;
  exchangePairId?: string;
  untrackedCounterpart?: string;
  operation: 'convert';
};

/**
 * The injectable seams of the Convert walk: the credential and holding reads, the Convert read,
 * the insert-only holding creation, the deduping import, and the walk state read and write. Pacing
 * and the weight budget come from the run.
 */
export type BinanceConvertHistoryDeps = ExchangeStateDeps & {
  now: () => number;
  fetchImpl: typeof fetch;
  readCredentials: (accountId: string) => Promise<BinanceCredentials | undefined>;
  listHoldings: (accountId: string) => Promise<HoldingRow[]>;
  fetchConvertHistory: (
    apiKey: string,
    secret: string,
    query: { startTime: number; endTime: number },
    options?: FetchAccountOptions,
  ) => Promise<ConvertHistoryPage>;
  ensureHoldings: (holdings: ExchangeHolding[]) => Promise<void>;
  addTransactions: (rows: BinanceConvertRow[]) => Promise<number>;
};

const defaultConvertHistoryDeps: BinanceConvertHistoryDeps = {
  ...exchangeStateDepsOf('binance'),
  now: () => Date.now(),
  fetchImpl: fetch,
  readCredentials,
  listHoldings: async (accountId) => holdingsRepo.listByAccountQuery(accountId),
  fetchConvertHistory,
  ensureHoldings: (holdings) => holdingsRepo.ensureExchangeHoldings(holdings),
  addTransactions: (rows) => transactionsRepo.addManyDedup(rows),
};

type ConvertContext = {
  deps: BinanceConvertHistoryDeps;
  run: BinanceHistoryRun;
  accountId: string;
  apiKey: string;
  secret: string;
  options: FetchAccountOptions;
  marks: WalkMarks;
  plan: WalkPlan;
  write: WalkMarkWriter;
};

/** Whether `error` is Binance's rate limit, which also puts the account on its shared cooldown. */
const stopOnRateLimit = (
  context: Pick<ConvertContext, 'deps' | 'accountId'>,
  error: unknown,
): boolean => {
  if (!(error instanceof BinanceRateLimitError)) {
    return false;
  }

  setBinanceCooldownUntil(context.accountId, context.deps.now() + error.retryAfterMs);

  return true;
};

/**
 * One request for the span. `undefined` is a clean stop: the call budget ran out (each request
 * records a call on the lane, so its per-run cap ends the walk), or Binance rate-limited. `keep`
 * calls stay unspent for the passes that come later in the run.
 */
const fetchSpan = async (
  context: ConvertContext,
  span: WalkWindow,
  keep: number,
): Promise<ConvertHistoryPage | undefined> => {
  const { deps, run, apiKey, secret, options } = context;

  if (!run.budget.canAfford('convert', COSTS.convert, keep)) {
    return undefined;
  }

  try {
    await run.gate.wait();
    const page = await deps.fetchConvertHistory(
      apiKey,
      secret,
      { startTime: span.start, endTime: span.end },
      options,
    );
    run.budget.record('convert', page);

    return page;
  } catch (error) {
    if (stopOnRateLimit(context, error)) {
      return undefined;
    }

    throw error;
  }
};

/**
 * What one read of `span` gave: a page that is not full is the whole of its span whatever order
 * Binance sorts in, so a page with `moreData` is answered with the half to read instead. A span of
 * one millisecond that still has more data is committed as it is, and stops the walk there.
 */
const readOf = (span: WalkWindow, page: ConvertHistoryPage): SpanRead<ConvertHistoryPage> => {
  const half = halfOf(span);

  return page.moreData && half !== undefined ? { kind: 'split', half } : { kind: 'page', page };
};

const readSpan = async (
  context: ConvertContext,
  span: WalkWindow,
  keep: number,
): Promise<SpanRead<ConvertHistoryPage> | undefined> =>
  foldMap(maybe(await fetchSpan(context, span, keep)), (found) => readOf(span, found));

/** What one conversion adds to its span: its rows, the tickers it names, and its refusal entry. */
type OutcomeParts = { rows: PlannedConvertRow[]; untracked: string[]; notImported: string[] };

const partsOf = (outcome: ConvertOutcome): OutcomeParts =>
  match(outcome)
    .returnType<OutcomeParts>()
    .with({ kind: 'rows' }, ({ rows, untracked }) => ({ rows, untracked, notImported: [] }))
    .with({ kind: 'refused' }, ({ entry }) => ({ rows: [], untracked: [], notImported: [entry] }))
    .with({ kind: 'none' }, () => ({ rows: [], untracked: [], notImported: [] }))
    .exhaustive();

/**
 * The records of one span, each on its own (see `settleRecords`): a conversion the walk cannot
 * trust, or a row the client could not read, owes its own point and the others still import. A
 * conversion a rule refuses for good is listed once it is settled, and the tickers of the coins the
 * walk does not track are named. A page that is still full once its span cannot be halved may hold
 * more conversions than it shows: that is no one record's stop, so the whole span is owed.
 */
const settledConversionsOf = (
  context: ConvertContext,
  span: WalkWindow,
  page: ConvertHistoryPage,
): SettledSpan<PlannedConvertRow> => {
  const settled = settleRecords<BinanceConvertRecord, ConvertOutcome>({
    span,
    records: page.rows,
    rowsOf: (record) => [convertOutcomeOf({ accountId: context.accountId, record })],
    extentOf: (record) => instantAt(record.createTime),
  });
  const parts = settled.rows.map(partsOf);

  return joinSettled<PlannedConvertRow>([
    ...(page.moreData
      ? [{ rows: [], codes: [CONVERT_PAGE_STUCK], owed: [span], returned: [] }]
      : []),
    {
      ...settled,
      rows: parts.flatMap((part) => part.rows),
      untracked: parts.flatMap((part) => part.untracked),
      notImported: parts.flatMap((part) => part.notImported),
    },
    settleUnreadable({
      span,
      unreadable: page.unreadable,
      code: CONVERT_ROW_UNREADABLE,
      extentOf: (row) => foldMap(maybe(row.time), (time) => instantAt(Number(time))),
    }),
  ]);
};

/**
 * Commit one span's page: place and write the rows of the conversions the walk can trust, then
 * move the walk's marks past the span that was asked for (see `commitSettledSpan`: rows first,
 * marks second, so a crash between the two just re-imports idempotently).
 */
const commitSpan = (
  context: ConvertContext,
  span: WalkWindow,
  page: ConvertHistoryPage,
  pass: WalkPass,
): Promise<SpanCommit | undefined> => {
  const { deps, accountId, plan, marks, write } = context;

  return commitSettledSpan({
    pass,
    span,
    settled: settledConversionsOf(context, span, page),
    place: (planned) =>
      placeWalletRows({
        accountId,
        planned,
        config: BINANCE_WALK_CONFIG,
        listHoldings: deps.listHoldings,
        ensureHoldings: deps.ensureHoldings,
        missingCode: CONVERT_HOLDING_MISSING,
      }),
    add: deps.addTransactions,
    writeOversized: historyListWriterOf(deps, accountId, 'oversizedCoins'),
    writeUntracked: historyListWriterOf(deps, accountId, 'untrackedCoins'),
    writeNotImported: notImportedWriterOf(deps, accountId),
    forwardOwes: CONVERT_FORWARD_OWES,
    advance: ({ owed }) =>
      advanceWalkMarks({
        pass,
        span,
        // No `series`: a window is never narrowed to some series, so a span reads all of it.
        series: undefined,
        owed,
        plan,
        marks,
        restartMs: HISTORY_FLOOR_MS,
        write,
      }),
  });
};

const runSync = async (
  deps: BinanceConvertHistoryDeps,
  accountId: string,
  run: BinanceHistoryRun,
): Promise<WalkResult> => {
  if (isBinanceCoolingDown(accountId, deps.now())) {
    return { imported: 0, complete: false };
  }

  const credentials = await deps.readCredentials(accountId);

  if (credentials === undefined) {
    return { imported: 0, complete: true };
  }

  const stored = await readWalkMarks(deps, accountId, 'convert');
  const { cursor, rescan: rescanCursor } = stored;
  const write = walkMarkWriterOf(deps, accountId, 'convert');
  const roundRobins = await readWalkRoundRobins({ stored, write });
  const pending = await readPendingMark({
    stored: stored.pending,
    owedIfUnreadable: { start: HISTORY_FLOOR_MS, end: cursor ?? HISTORY_FLOOR_MS },
    write,
  });
  const endTime = deps.now();
  const plan = planWalkPasses({
    cursor,
    rescanCursor,
    pointCursor: roundRobins.pointCursor,
    rangeCursor: roundRobins.rangeCursor,
    pending,
    floorMs: HISTORY_FLOOR_MS,
    endTime,
    windowMs: CONVERT_WINDOW_MS,
    overlapMs: RESYNC_OVERLAP_MS,
    maxWindows: CONVERT_MAX_WINDOWS,
  });

  if (plan.forward.length === 0 && plan.rescan.length === 0) {
    return { imported: 0, complete: false };
  }

  const context: ConvertContext = {
    deps,
    run,
    accountId,
    ...credentials,
    options: { fetchImpl: deps.fetchImpl, now: deps.now },
    marks: { cursor, rescanCursor, ...roundRobins, pending },
    plan,
    write,
  };

  const result = await runWalkPlan({
    plan,
    canAfford: (keep) =>
      run.budget.canAfford('convert', COSTS.convert, keep) &&
      !isBinanceCoolingDown(accountId, deps.now()),
    runWindow: (window, pass, keep, hint) =>
      walkSpans({
        window,
        read: (span, keepCalls) => readSpan(context, span, keepCalls),
        commit: (span, page) => commitSpan(context, span, page, pass),
        keep,
        hint,
        onComplete: (read) => dropReadPoints({ pass, window, read, marks: context.marks, write }),
      }),
    ...roundRobinHooksOf({ marks: context.marks, write }),
  });
  const lastWindowEnd = plan.forward.at(-1)?.end;

  // A plan holds `CONVERT_MAX_WINDOWS` windows at most, so one that ends before now has more
  // history behind it than the windows it read.
  return {
    ...result,
    complete: result.complete && (lastWindowEnd === undefined || lastWindowEnd >= endTime),
  };
};

/**
 * Import the user's Binance Convert history as transactions on the wallet each conversion names
 * (Funding or Spot), committing a window's rows before advancing the mark past it. The walk reads
 * 30-day windows forward from the history floor, empty ones too, because Binance has no refusal to
 * the floor to stop at; a run reads at most the lane's 20 windows, so the first walk takes
 * several runs. A start Binance refuses as older than it keeps rejects the run, and the refused
 * span moves no mark, as Pay does. `complete: false` means history, owed ground or the re-scan
 * remains and a later run resumes from the stored marks; a failure other than a rate limit
 * rejects, so the caller can log it without failing the balance sync.
 */
export const syncBinanceConvertHistory = (
  request: { targetAccountId: string; run: BinanceHistoryRun },
  overrides: Partial<BinanceConvertHistoryDeps> = {},
): Promise<WalkResult> =>
  runSync({ ...defaultConvertHistoryDeps, ...overrides }, request.targetAccountId, request.run);
