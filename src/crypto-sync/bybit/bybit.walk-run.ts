import { DAY_MS } from '@kiko/dates';
import {
  type ExchangeStateDeps,
  exchangeStateDepsOf,
  isPoint,
  type OwedGround,
  type OwedWindow,
  placeWalletRows,
  planWalkPasses,
  readPendingMark,
  readWalkMarks,
  readWalkRoundRobins,
  runExchangeWalkPlan,
  type SettledSpan,
  type SpanCommit,
  type SpanRead,
  walkMarkWriterOf,
  type WalkMarkWriter,
  type WalkMarks,
  type WalkPass,
  type WalkPlan,
  type WalkResult,
  type WalkWindow,
} from '@kiko/crypto-sync/exchange/walk';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { transactionsRepo } from '@kiko/transactions/repo';
import type { WalkId } from '@kiko/crypto-sync/exchange/walk-state';
import { type ExchangeHolding, holdingsRepo } from '@kiko/holdings/repo';
import type { ExchangeCredentials } from '@kiko/crypto-sync/exchange/credentials';

import { plainHintOf } from './bybit.cursor-span';
import { BYBIT_WALK_CONFIG } from './bybit.walk-config';
import { readBybitCredentials } from './bybit.credentials';
import { BybitHistoryParseError } from './bybit.history-client';
import { BybitRateLimitError, type BybitReadOptions } from './bybit.client';
import { isBybitCoolingDown, setBybitCooldownUntil } from './bybit.cooldown';
import { type BybitHistoryRun, type BybitLane, NO_WEIGHTS } from './bybit.history-budget';

const SECOND_MS = 1_000;

/**
 * No Bybit history route states how far back it keeps records, and an empty answer proves nothing,
 * so every walk's floor trails the clock by a fixed span a little under two years.
 */
const HISTORY_DAYS = 729;

/** The oldest instant a Bybit walk reads from, for a run that starts at `now`. */
export const historyFloorOf = (now: number): number => now - HISTORY_DAYS * DAY_MS;

/** A record that settles late can sit this far behind the cursor, so the re-scan starts there. */
const OVERLAP_MS = DAY_MS;

/**
 * The overlap day is owed behind a cursor whose ground was read within one re-scan window of its
 * time, and when no clock was stored. A late record is one that the re-scan window reads, so
 * ground read long after its time holds none: a catch-up run over it owes no day.
 */
const overlapMsOf = (
  cursor: number | null,
  cursorReadAt: number | undefined,
  windowMs: number,
): number =>
  cursor === null || cursorReadAt === undefined || cursorReadAt - cursor < windowMs
    ? OVERLAP_MS
    : 0;

/** The stop of a span whose pages repeated a cursor or held a row the span cannot hold. */
export const BYBIT_PAGE_DRIFT = 'bybit-page-drift';

/** What every Bybit history walk reads and writes through, beside its own repositories. */
export type BybitWalkDeps = ExchangeStateDeps & {
  now: () => number;
  fetchImpl: typeof fetch;
  readCredentials: (accountId: string) => Promise<ExchangeCredentials | undefined>;
};

export type BybitWalkContext<Deps extends BybitWalkDeps> = {
  deps: Deps;
  run: BybitHistoryRun;
  accountId: string;
  apiKey: string;
  secret: string;
  options: BybitReadOptions;
  marks: WalkMarks;
  plan: WalkPlan;
  write: WalkMarkWriter;
  floorMs: number;
};

/** What a Bybit walk that places its rows on wallet holdings reads and writes through. */
export type BybitRowWalkDeps<Row> = BybitWalkDeps & {
  listHoldings: (accountId: string) => Promise<HoldingRow[]>;
  /** Creates a wallet holding the walk needs at zero; never touches an existing one. */
  ensureHoldings: (holdings: ExchangeHolding[]) => Promise<void>;
  addTransactions: (rows: Row[]) => Promise<number>;
};

export const defaultBybitRowWalkDeps: BybitRowWalkDeps<
  Parameters<typeof transactionsRepo.addManyDedup>[0][number]
> = {
  ...exchangeStateDepsOf('bybit'),
  now: () => Date.now(),
  fetchImpl: fetch,
  readCredentials: readBybitCredentials,
  listHoldings: async (accountId) => holdingsRepo.listByAccountQuery(accountId),
  ensureHoldings: (holdings) => holdingsRepo.ensureExchangeHoldings(holdings),
  addTransactions: (rows) => transactionsRepo.addManyDedup(rows),
};

/**
 * Turn the planned rows of a span into importable ones on the wallet holdings of the Bybit account,
 * creating a missing holding at zero first (see `placeWalletRows`). A holding that cannot be found
 * even then stops the span with `missingCode`.
 */
export const placeBybitRows = <
  Planned extends { wallet: string; counterpartWallet?: string; externalId: string },
>(
  context: Pick<BybitWalkContext<BybitRowWalkDeps<never>>, 'accountId' | 'deps'>,
  planned: Planned[],
  missingCode: string,
) =>
  placeWalletRows({
    accountId: context.accountId,
    planned,
    config: BYBIT_WALK_CONFIG,
    listHoldings: context.deps.listHoldings,
    ensureHoldings: context.deps.ensureHoldings,
    missingCode,
  });

/**
 * Bybit compares these windows at the second, so a record just before a span's start can be in it:
 * the reach of a read starts at the whole second the span starts in.
 */
export const flooredStart = (span: WalkWindow): number =>
  Math.floor(span.start / SECOND_MS) * SECOND_MS;

/**
 * Oldest first, a record with no time last, ties by key: Bybit documents no order for these
 * routes, so a span is sorted before it is settled and the rows it commits do not depend on the
 * order of its pages.
 */
export const byTimeThenKey =
  <Item>(timeOf: (item: Item) => WalkWindow | undefined, keyOf: (item: Item) => string) =>
  (left: Item, right: Item): number =>
    (timeOf(left)?.start ?? Number.POSITIVE_INFINITY) -
      (timeOf(right)?.start ?? Number.POSITIVE_INFINITY) || keyOf(left).localeCompare(keyOf(right));

/** The ground a series left owed because its pages drifted: the span, in that series alone. */
export const driftOf = (span: WalkWindow, drifted: readonly string[]): SettledSpan<never> => ({
  rows: [],
  codes: drifted.length > 0 ? [BYBIT_PAGE_DRIFT] : [],
  owed: drifted.map((series) => ({ ...span, series })),
  returned: [],
});

/**
 * The owed ground of one series of a span, as the series' own: a range carries the series, so the
 * forward pass goes past it and no other series is held back, and a point already carries it.
 */
export const taggedWith = (series: string, owed: readonly OwedGround[]): OwedGround[] =>
  owed.map((ground) => (isPoint(ground) ? ground : { ...ground, series }));

/**
 * Fetch one span of a window. `undefined` is a clean stop: the budget ran out, or Bybit
 * rate-limited (which also sets the account's cooldown). Any other error rethrows, leaving every
 * earlier span's commit in place.
 */
export const readUnderCooldown = async <Deps extends BybitWalkDeps, Page>(
  context: Pick<BybitWalkContext<Deps>, 'accountId' | 'deps'>,
  read: () => Promise<SpanRead<Page> | undefined>,
): Promise<SpanRead<Page> | undefined> => {
  try {
    return await read();
  } catch (error) {
    if (error instanceof BybitRateLimitError) {
      setBybitCooldownUntil(context.accountId, context.deps.now() + error.retryAfterMs);

      return undefined;
    }

    throw error;
  }
};

/**
 * One Bybit history walk's run, from the stored marks to the result: a cooling account and a
 * missing key make no read, and the plan reads forward from the cursor first, then owed ground,
 * the re-scan and the owed points, on what the walk's lane has left (see `planWalkPasses`).
 */
export const runBybitWalk = async <Deps extends BybitWalkDeps, Page>(input: {
  deps: Deps;
  accountId: string;
  run: BybitHistoryRun;
  walkId: WalkId;
  lane: BybitLane;
  series: readonly string[];
  windowMs: number;
  maxWindows: number;
  callsOf: (window: OwedWindow) => number;
  read: (
    context: BybitWalkContext<Deps>,
    window: OwedWindow,
    span: WalkWindow,
    keep: number,
  ) => Promise<SpanRead<Page> | undefined>;
  commit: (
    context: BybitWalkContext<Deps>,
    window: OwedWindow,
    span: WalkWindow,
    page: Page,
    pass: WalkPass,
  ) => Promise<SpanCommit | undefined>;
}): Promise<WalkResult> => {
  const { deps, accountId, run, walkId, lane } = input;
  const now = deps.now();

  if (isBybitCoolingDown(accountId, now)) {
    return { imported: 0, complete: false };
  }

  const credentials = await deps.readCredentials(accountId);

  if (credentials === undefined) {
    return { imported: 0, complete: true };
  }

  const stored = await readWalkMarks(deps, accountId, walkId);
  const { cursor, rescan: rescanCursor, cursorReadAt } = stored;
  const write = walkMarkWriterOf(deps, accountId, walkId);
  const roundRobins = await readWalkRoundRobins({ stored, write });
  const floorMs = historyFloorOf(now);
  const pending = await readPendingMark({
    stored: stored.pending,
    owedIfUnreadable: { start: floorMs, end: cursor ?? floorMs },
    knownSeries: input.series,
    write,
  });
  const plan = planWalkPasses({
    cursor,
    rescanCursor,
    pointCursor: roundRobins.pointCursor,
    rangeCursor: roundRobins.rangeCursor,
    backfillCursor: roundRobins.backfillCursor,
    pending,
    floorMs,
    endTime: now,
    windowMs: input.windowMs,
    overlapMs: overlapMsOf(cursor, cursorReadAt, input.windowMs),
    maxWindows: input.maxWindows,
  });

  // Owed ground and owed points count: a clock that stepped back can leave nothing to read forward
  // or behind while ground is still owed.
  if ([plan.forward, plan.rescan, plan.pending, plan.points].every((list) => list.length === 0)) {
    return { imported: 0, complete: false };
  }

  const context: BybitWalkContext<Deps> = {
    deps,
    run,
    accountId,
    apiKey: credentials.apiKey,
    secret: credentials.secret,
    options: { fetchImpl: deps.fetchImpl, now: deps.now },
    marks: { cursor, rescanCursor, ...roundRobins, pending },
    plan,
    write,
    floorMs,
  };

  const result = await runExchangeWalkPlan({
    context,
    lane,
    cost: NO_WEIGHTS,
    isCoolingDown: isBybitCoolingDown,
    isUnreadableWindowError: (error) => error instanceof BybitHistoryParseError,
    callsOf: input.callsOf,
    outcomeOf: plainHintOf,
    read: (window, span, keepCalls) => input.read(context, window, span, keepCalls),
    commit: (window, span, page, pass) => input.commit(context, window, span, page, pass),
  });

  // The cursor is written before this clock, so a cut between the two leaves the older clock, which
  // owes the day: that is the safe side.
  if (context.marks.cursor !== cursor) {
    await write([{ field: 'cursorReadAt', value: now }]);
  }

  const lastForwardEnd = foldMap(maybe(plan.forward.at(-1)), (window) => window.end);

  // A plan holds a capped number of windows: a forward pass that ends before now leaves history
  // behind the windows it read.
  return {
    ...result,
    complete: result.complete && (lastForwardEnd === undefined || lastForwardEnd >= now),
  };
};
