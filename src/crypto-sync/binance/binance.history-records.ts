import maybe, { foldMap } from 'fnts/maybe';
import { bifoldMap, type Either, eitherSync } from 'fnts/either';

import {
  BinanceWalkStop,
  logWalkStop,
  type SpanCommit,
  type WalkPass,
  type WalkWindow,
} from './binance.history-walk';

/**
 * One span's records told apart: the rows of those the walk can trust, the codes of the stops
 * of those it cannot, and the ground the stuck records owe.
 */
type SettledSpan<Row> = { rows: Row[]; codes: string[]; owed: WalkWindow[] };

/** The one millisecond a record with a time to the millisecond sits in, if it has a time. */
export const instantAt = (time: number | undefined): WalkWindow | undefined =>
  foldMap(maybe(time), (instant) => ({ start: instant, end: instant }));

const holdsAll = (outer: WalkWindow, inner: WalkWindow): boolean =>
  outer.start <= inner.start && inner.end <= outer.end;

/**
 * The ground a stuck record owes inside `span`: the milliseconds it may sit in (`extent`, with
 * `start <= end`), cut to the span. A read holds both its ends, so a request for it returns the
 * record; a request needs `start < end`, so one millisecond becomes two (the one before when
 * the record sits on the last millisecond of the span). A record with no time, or one outside
 * the span, says nothing of where in the span it is, and owes the whole span.
 */
const owedBy = (span: WalkWindow, extent: WalkWindow | undefined): WalkWindow => {
  if (
    extent === undefined ||
    !Number.isFinite(extent.start) ||
    !Number.isFinite(extent.end) ||
    extent.end < span.start ||
    extent.start > span.end
  ) {
    return span;
  }

  const start = Math.max(span.start, extent.start);
  const end = Math.min(span.end, extent.end);

  if (start < end) {
    return { start, end };
  }

  return end < span.end ? { start, end: end + 1 } : { start: start - 1, end };
};

const settledRecord = <Row>(attempt: Either<unknown, Row[]>, owed: () => WalkWindow) =>
  bifoldMap(
    attempt,
    (error): SettledSpan<Row> => {
      if (!(error instanceof BinanceWalkStop)) {
        throw error;
      }

      return { rows: [], codes: [error.code], owed: [owed()] };
    },
    (rows): SettledSpan<Row> => ({ rows, codes: [], owed: [] }),
  );

/**
 * The settled parts of one span as one: when a stuck record owes the whole span, the span is
 * owed once, and the same point is owed once.
 */
export const joinSettled = <Row>(span: WalkWindow, parts: SettledSpan<Row>[]): SettledSpan<Row> => {
  const owed = parts.flatMap((part) => part.owed);

  return {
    rows: parts.flatMap((part) => part.rows),
    codes: parts.flatMap((part) => part.codes),
    owed: owed.some((window) => holdsAll(window, span))
      ? [span]
      : owed.filter(
          (window, index) =>
            owed.findIndex((other) => other.start === window.start && other.end === window.end) ===
            index,
        ),
  };
};

/**
 * The records of one span, each on its own: a record the walk cannot trust (its `rowsOf` throws
 * a `BinanceWalkStop`) owes only the ground it sits in (`extentOf`, see `owedBy`) and holds
 * back nothing else, so the rows of the others are still imported.
 */
export const settleRecords = <Record, Row>(input: {
  span: WalkWindow;
  records: Record[];
  rowsOf: (record: Record) => Row[];
  extentOf: (record: Record) => WalkWindow | undefined;
}): SettledSpan<Row> => {
  const { span, records, rowsOf, extentOf } = input;

  return joinSettled(
    span,
    records.map((record) =>
      settledRecord(
        eitherSync<unknown, Row[]>(() => rowsOf(record)),
        () => owedBy(span, extentOf(record)),
      ),
    ),
  );
};

/** A span that cannot be trusted as a whole, and no record of it can: it owes all of itself. */
export const stuckSpanOf = <Row>(span: WalkWindow, code: string): SettledSpan<Row> => ({
  rows: [],
  codes: [code],
  owed: [span],
});

const logCodes = (codes: string[]): void => {
  for (const code of new Set(codes)) {
    logWalkStop(code);
  }
};

/**
 * Place the rows of a settled span. Rows that cannot be placed (a wallet holding that cannot
 * be found) are not one record's stop: nothing of the span is committed and the whole span is
 * owed.
 */
const placed = async <Planned, Row>(input: {
  span: WalkWindow;
  settled: SettledSpan<Planned>;
  place: (planned: Planned[]) => Promise<Row[]>;
}): Promise<SettledSpan<Row>> => {
  const { span, settled, place } = input;

  try {
    return { ...settled, rows: await place(settled.rows) };
  } catch (error) {
    if (!(error instanceof BinanceWalkStop)) {
      throw error;
    }

    return { rows: [], codes: [...settled.codes, error.code], owed: [span] };
  }
};

/**
 * Commit one span: place and write the rows of the records the walk can trust, then move the
 * walk's marks (`advance` gets the ground that stays owed). Rows first, marks second, so a
 * crash between the two only has the next run read the span again, which imports nothing new.
 * The forward pass moves a cursor that must not pass a record it could not trust, so a stop of
 * any kind leaves its span uncommitted (`undefined`, before anything is written); in the other
 * passes the stuck records stay owed and everything else commits.
 */
export const commitSettledSpan = async <Planned, Row>(input: {
  pass: WalkPass;
  span: WalkWindow;
  settled: SettledSpan<Planned>;
  place: (planned: Planned[]) => Promise<Row[]>;
  add: (rows: Row[]) => Promise<number>;
  advance: (owed: WalkWindow[]) => Promise<void>;
}): Promise<SpanCommit | undefined> => {
  const { pass, span, settled, add, advance } = input;
  const stopsRun = pass === 'forward';

  if (stopsRun && settled.codes.length > 0) {
    logCodes(settled.codes);

    return undefined;
  }

  const ready = await placed({ span, settled, place: input.place });

  logCodes(ready.codes);

  if (stopsRun && ready.codes.length > 0) {
    return undefined;
  }

  const imported = ready.rows.length > 0 ? await add(ready.rows) : 0;

  await advance(ready.owed);

  return { imported, owed: ready.owed.length > 0 };
};
