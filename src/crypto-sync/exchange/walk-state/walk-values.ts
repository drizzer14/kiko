import maybe, { foldMap } from 'fnts/maybe';
import { isRecord } from '@kiko/type-guards';

/**
 * One entry of a walk's list of owed ground: a range, or a point when tagged `kind: 'point'`. A
 * point is the ground one record the walk could not trust owes; it is never told from a range by
 * its length, and an entry with no tag is a range, which is how a list stored before the tag
 * existed reads. A walk that reads several series (the Transfer types) stores the series its
 * record was read under on a point (`series`): the point is read in that series only, and leaves
 * the list only for a record of it. A range with a `series` is owed in that series alone (the
 * ground one series left unread, or skipped at the edge of its depth) and leaves the list once a
 * read of it in that series has committed; a range with none is owed in every series. A point
 * also carries `since`, the wall-clock time (epoch ms) of the run that first owed it, which every
 * later run keeps: the history caption reads it to tell a point that has stayed owed for long from
 * one that every sync reads again. A point stored without one (by a build before it) is quiet
 * until a run owes it again and stamps it; a range never carries one. An entry with a `scope` is
 * owed to that read alone (the backfill of the coins a walk did not read before its first
 * multi-coin run), and the window that reads it skips the coin the walk already holds for that
 * ground; an entry with none is owed to a read of every coin. A point found in a window of a scope
 * carries it.
 */
export type BinancePendingRange = {
  start: number;
  end: number;
  kind?: 'point';
  series?: string;
  since?: number;
  scope?: BinancePendingScope;
};

const pendingScopes = ['backfill'] as const;

type BinancePendingScope = (typeof pendingScopes)[number];

/**
 * What a run keeps of a POINT window it left after some spans of it committed (the other passes
 * keep their progress in their cursor, their list and their re-scan mark): `from` is where the
 * next span starts (the hint's `end` is where it ends); `returned` the points of the records the
 * committed spans returned, trusted or not, and `stuck` the ground the records among them that
 * could not be trusted owe. Both are folded into the read of the window that finishes it in a
 * later run, so the window takes its point off the list once, as one read of it would have.
 * `series` is the series the window was read in: a window of other series does not take it. `scope`
 * is the scope the window was read in, and a window of another scope does not take it either.
 */
export type BinanceSpanResume = {
  from: number;
  returned: BinancePendingRange[];
  stuck: BinancePendingRange[];
  series?: string[];
  scope?: BinancePendingScope;
};

/**
 * Where a run left a window it could not finish: the narrowest span it asked for, which starts
 * where the window starts, when no span of it committed. The next run that reads a window with
 * that start begins with this span, so a chain of halvings longer than one run's calls goes on
 * from where it stopped instead of starting over. A point window that committed some spans
 * leaves a `resume` as well: its span starts at `resume.from`, after the ground already read, and
 * `start` stays the start of the window, which is what finds the hint. A hint can only narrow a
 * read.
 */
export type BinanceSpanHint = { start: number; end: number; resume?: BinanceSpanResume };

/** The passes a run reads, and the points among them: each keeps its own hints. */
const binanceSpanHintPasses = ['forward', 'pending', 'rescan', 'point'] as const;

export type BinanceSpanHintPass = (typeof binanceSpanHintPasses)[number];

export type BinanceSpanHints = Record<BinanceSpanHintPass, BinanceSpanHint[]>;

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** A stored cursor, or `null` when none is stored or the value is no finite number. */
export const finiteNumberOrNull = (stored: unknown): number | null =>
  isNumber(stored) ? stored : null;

const isSeries = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

const isScope = (value: unknown): value is BinancePendingScope =>
  pendingScopes.some((scope) => scope === value);

const isSince = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * The time a point was first owed, when the stored one is a time. A `since` that is not one is
 * read as none, and never as a malformed list: it only decides what the caption shows, so a bad
 * one must not have the walk repair (and re-read) every owed range.
 */
const sinceOf = (since: unknown): { since?: number } => (isSince(since) ? { since } : {});

const asPendingRange = (value: unknown): BinancePendingRange | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const { start, end, kind, series, scope, since } = value;

  if (!isNumber(start) || !isNumber(end) || start >= end) {
    return undefined;
  }

  if (kind !== undefined && kind !== 'point') {
    return undefined;
  }

  if (series !== undefined && !isSeries(series)) {
    return undefined;
  }

  if (scope !== undefined && !isScope(scope)) {
    return undefined;
  }

  return {
    start,
    end,
    ...foldMap(maybe(kind), () => ({ kind: 'point' as const })),
    ...foldMap(maybe(series), (name) => ({ series: name })),
    ...foldMap(maybe(kind), () => sinceOf(since)),
    ...foldMap(maybe(scope), (name) => ({ scope: name })),
  };
};

const asPendingRanges = (value: unknown): BinancePendingRange[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const ranges = value.map(asPendingRange);

  return ranges.every((range): range is BinancePendingRange => range !== undefined)
    ? ranges
    : undefined;
};

/**
 * One walk's stored pending ranges, `[]` when none is stored (`stored` is `undefined`),
 * `undefined` when a value is stored but is not a list of well-formed ranges (`readPendingMark`
 * logs a fixed code and repairs it: all the ground before the cursor is owed once, and stored at
 * once; a parse failure must never fail a balance sync). A stored JSON null is a stored value.
 */
export const binanceWalkPendingValueOf = (stored: unknown): BinancePendingRange[] | undefined => {
  if (stored === undefined) {
    return [];
  }

  return asPendingRanges(stored);
};

/**
 * A stored round-robin cursor (a walk's point cursor or range cursor): `null` when none is stored
 * (`stored` is `undefined`), `undefined` when a value is stored but is no finite number (the walk
 * logs a fixed code and starts at the oldest; a parse failure must never fail a balance sync). A
 * stored JSON null is a stored value.
 */
export const binanceWalkRoundRobinValueOf = (stored: unknown): number | null | undefined => {
  if (stored === undefined) {
    return null;
  }

  return isNumber(stored) ? stored : undefined;
};

const isSeriesList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every(isSeries);

/**
 * The resume of a point hint of `span`: where its next span starts, in the window and before the
 * end of the span, and the two lists it holds. The lists are always stored, so one that is left
 * out is as malformed as one that is no list.
 */
const asSpanResume = (value: unknown, span: BinanceSpanHint): BinanceSpanResume | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const { from, returned, stuck, series, scope } = value;
  const returnedRanges = asPendingRanges(returned);
  const stuckRanges = asPendingRanges(stuck);

  if (
    !isNumber(from) ||
    from < span.start ||
    from >= span.end ||
    returnedRanges === undefined ||
    stuckRanges === undefined ||
    (scope !== undefined && !isScope(scope))
  ) {
    return undefined;
  }

  const kept = {
    from,
    returned: returnedRanges,
    stuck: stuckRanges,
    ...foldMap(maybe(scope), (name) => ({ scope: name })),
  };

  if (series === undefined) {
    return kept;
  }

  return isSeriesList(series) ? { ...kept, series } : undefined;
};

/**
 * One stored hint. A resume belongs to the point list only (`withResume`): a hint of any other
 * pass keeps its span and loses a resume it was given, because a resume would skip ground in a
 * pass that keeps its progress elsewhere.
 */
const asSpanHint = (value: unknown, withResume: boolean): BinanceSpanHint | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const { start, end, resume } = value;

  if (!isNumber(start) || !isNumber(end) || start >= end) {
    return undefined;
  }

  if (!withResume || resume === undefined) {
    return { start, end };
  }

  return foldMap(maybe(asSpanResume(resume, { start, end })), (kept) => ({
    start,
    end,
    resume: kept,
  }));
};

const asSpanHintList = (value: unknown, withResume = false): BinanceSpanHint[] | undefined => {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const hints = value.map((entry) => asSpanHint(entry, withResume));

  return hints.every((hint): hint is BinanceSpanHint => hint !== undefined) ? hints : undefined;
};

/**
 * One walk's stored span hints: none for each pass when nothing is stored (`stored` is
 * `undefined`), `undefined` when a value is stored but is not a record of well-formed lists (the
 * walk logs a fixed code and stores no hint at once; a parse failure must never fail a balance
 * sync). A stored JSON null is a stored value.
 */
export const binanceWalkSpanHintsValueOf = (stored: unknown): BinanceSpanHints | undefined => {
  if (stored === undefined) {
    return { forward: [], pending: [], rescan: [], point: [] };
  }

  if (!isRecord(stored)) {
    return undefined;
  }

  const forward = asSpanHintList(stored.forward);
  const pending = asSpanHintList(stored.pending);
  const rescan = asSpanHintList(stored.rescan);
  const point = asSpanHintList(stored.point, true);

  return forward === undefined ||
    pending === undefined ||
    rescan === undefined ||
    point === undefined
    ? undefined
    : { forward, pending, rescan, point };
};
