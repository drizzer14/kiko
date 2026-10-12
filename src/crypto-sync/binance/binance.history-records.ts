import maybe, { foldMap } from 'fnts/maybe';
import { bifoldMap, type Either, eitherSync } from 'fnts/either';

import {
  BinanceWalkStop,
  holdsAll,
  logWalkStop,
  type SpanCommit,
  type WalkPass,
  type WalkWindow,
} from './binance.history-walk';

/**
 * One span's records told apart: the rows of those the walk can trust, the codes of the stops
 * of those it cannot, the ground the stuck records owe, and how many records the read returned.
 */
type SettledSpan<Row> = { rows: Row[]; codes: string[]; owed: WalkWindow[]; records: number };

/** The one millisecond a record with a time to the millisecond sits in, if it has a time. */
export const instantAt = (time: number | undefined): WalkWindow | undefined =>
  foldMap(maybe(time), (instant) => ({ start: instant, end: instant }));

/**
 * The point a stuck record owes: the milliseconds it may sit in (`extent`, with `start <= end`)
 * and one more on each side, whatever the span it was read in. Binance may leave either end of
 * a range out, and a request needs `start < end`; with the extra millisecond on both sides a
 * request for the point returns the record under any of them, and a record on the boundary of
 * two spans owes one point. A record with no time, one whose extent is not finite, or one
 * outside the span says nothing of where in the span it is, and owes the whole span.
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

  return { start: extent.start - 1, end: extent.end + 1 };
};

const settledRecord = <Row>(attempt: Either<unknown, Row[]>, owed: () => WalkWindow) =>
  bifoldMap(
    attempt,
    (error): SettledSpan<Row> => {
      if (!(error instanceof BinanceWalkStop)) {
        throw error;
      }

      return { rows: [], codes: [error.code], owed: [owed()], records: 1 };
    },
    (rows): SettledSpan<Row> => ({ rows, codes: [], owed: [], records: 1 }),
  );

const sameWindow = (left: WalkWindow, right: WalkWindow): boolean =>
  left.start === right.start && left.end === right.end;

/**
 * The settled parts of one span as one. When the whole span is owed, it is owed once and the
 * ground the span holds goes with it (a read of the span returns those records, whatever end
 * Binance leaves out); a point that reaches past the span stays, and the same point is owed
 * once.
 */
export const joinSettled = <Row>(span: WalkWindow, parts: SettledSpan<Row>[]): SettledSpan<Row> => {
  const owed = parts.flatMap((part) => part.owed);
  const wholeSpan = owed.some((window) => sameWindow(window, span));
  const rest = wholeSpan ? owed.filter((window) => !holdsAll(span, window)) : owed;

  return {
    rows: parts.flatMap((part) => part.rows),
    codes: parts.flatMap((part) => part.codes),
    owed: [...(wholeSpan ? [span] : []), ...rest].filter(
      (window, index, all) => all.findIndex((other) => sameWindow(other, window)) === index,
    ),
    records: parts.reduce((sum, part) => sum + part.records, 0),
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

    return { ...settled, rows: [], codes: [...settled.codes, error.code], owed: [span] };
  }
};

/**
 * Commit one span: place and write the rows of the records the walk can trust, then move the
 * walk's marks (`advance` gets the ground that stays owed, and whether the read returned any
 * record: a point is only taken off the list by a read that did). Rows first, marks second, so a
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
  advance: (result: { owed: WalkWindow[]; returnedRecords: boolean }) => Promise<void>;
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

  await advance({ owed: ready.owed, returnedRecords: ready.records > 0 });

  return { imported, owed: ready.owed.length > 0 };
};
