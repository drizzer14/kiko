import maybe, { foldMap } from 'fnts/maybe';
import { bifoldMap, type Either, eitherSync } from 'fnts/either';

import {
  BinanceWalkStop,
  distinctGround,
  logWalkStop,
  type OwedGround,
  type SpanCommit,
  type WalkPass,
  type WalkWindow,
} from './binance.history-walk';
import type { UnreadableRow } from './binance.history-client';

/**
 * One span's records told apart: the rows of those the walk can trust, the codes of the stops
 * of those it cannot, the ground the stuck records owe, and the point of every record the read
 * returned, trusted or not (`returned`): the walk takes a point off its list only for one of
 * those.
 */
type SettledSpan<Row> = {
  rows: Row[];
  codes: string[];
  owed: OwedGround[];
  returned: WalkWindow[];
};

/** The one millisecond a record with a time to the millisecond sits in, if it has a time. */
export const instantAt = (time: number | undefined): WalkWindow | undefined =>
  foldMap(maybe(time), (instant) => ({ start: instant, end: instant }));

/**
 * The point a record read in `span` owes: the milliseconds it may sit in (`extent`, with
 * `start <= end`) and one more on each side, whatever the span it was read in. A request needs
 * `start < end`, and Binance may leave either end of a range out; with the extra millisecond on
 * both sides a request for the point returns the record under any of them, and a record on the
 * boundary of two spans owes one point. A record with no time, one whose extent is not finite,
 * or one outside the span says nothing of where in the span it is: it has no point.
 */
const pointOf = (span: WalkWindow, extent: WalkWindow | undefined): WalkWindow | undefined => {
  if (
    extent === undefined ||
    !Number.isFinite(extent.start) ||
    !Number.isFinite(extent.end) ||
    extent.end < span.start ||
    extent.start > span.end
  ) {
    return undefined;
  }

  return { start: extent.start - 1, end: extent.end + 1 };
};

/** The ground a stuck record owes: its own point, or the whole span (a range) without one. */
const owedBy = (span: WalkWindow, point: WalkWindow | undefined): OwedGround =>
  foldMap(maybe(point), (found): OwedGround => ({ ...found, kind: 'point' })) ?? span;

const settledRecord = <Row>(
  attempt: Either<unknown, Row[]>,
  span: WalkWindow,
  point: WalkWindow | undefined,
) => {
  const returned = foldMap(maybe(point), (found) => [found]) ?? [];

  return bifoldMap(
    attempt,
    (error): SettledSpan<Row> => {
      if (!(error instanceof BinanceWalkStop)) {
        throw error;
      }

      return { rows: [], codes: [error.code], owed: [owedBy(span, point)], returned };
    },
    (rows): SettledSpan<Row> => ({ rows, codes: [], owed: [], returned }),
  );
};

/**
 * The settled parts of one span as one. The same ground is owed once; a point is never taken
 * into a range that holds it, and a range never into another entry, so the whole span owed
 * beside the point of a record in it is two entries.
 */
export const joinSettled = <Row>(parts: SettledSpan<Row>[]): SettledSpan<Row> => ({
  rows: parts.flatMap((part) => part.rows),
  codes: parts.flatMap((part) => part.codes),
  owed: distinctGround(parts.flatMap((part) => part.owed)),
  returned: parts.flatMap((part) => part.returned),
});

/**
 * The records of one span, each on its own: a record the walk cannot trust (its `rowsOf` throws
 * a `BinanceWalkStop`) owes only the ground it sits in (`extentOf`, see `pointOf`) and holds
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
    records.map((record) =>
      settledRecord(
        eitherSync<unknown, Row[]>(() => rowsOf(record)),
        span,
        pointOf(span, extentOf(record)),
      ),
    ),
  );
};

/**
 * The rows the client could not read (the page's `unreadable` list), each settled on its own like
 * a stuck record: one `BinanceWalkStop(code)` per row, so it owes its own point when its time is
 * usable (`extentOf` gives where it may sit) and the whole span when it is not, and the other
 * rows of the span still import. A row never fails the run: the walk never sees its content.
 */
export const settleUnreadable = <Row extends UnreadableRow>(input: {
  span: WalkWindow;
  unreadable: Row[];
  code: string;
  extentOf: (row: Row) => WalkWindow | undefined;
}): SettledSpan<never> =>
  settleRecords<Row, never>({
    span: input.span,
    records: input.unreadable,
    rowsOf: () => {
      throw new BinanceWalkStop(input.code);
    },
    extentOf: input.extentOf,
  });

const logCodes = (codes: string[]): void => {
  for (const code of new Set(codes)) {
    logWalkStop(code);
  }
};

/**
 * Place the rows of a settled span. Rows that cannot be placed (a wallet holding that cannot
 * be found) are not one record's stop: nothing of the span is committed and the whole span is
 * owed, beside the points of the records that were stuck.
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

    return {
      ...settled,
      rows: [],
      codes: [...settled.codes, error.code],
      owed: distinctGround([...settled.owed, span]),
    };
  }
};

/**
 * Commit one span: place and write the rows of the records the walk can trust, then move the
 * walk's marks (`advance` gets the ground that stays owed). The commit also reports that ground
 * and the point of every record the read returned, which the window takes a point off the list
 * by once it has been read to its end (see `walkSpans`). Rows first, marks second, so a crash
 * between the two only has the next run read the span again, which imports nothing new. The
 * forward pass moves a cursor that must not pass
 * a record it could not trust, so a stop of any kind leaves its span uncommitted (`undefined`,
 * before anything is written); in the other passes the stuck records stay owed and everything
 * else commits.
 */
export const commitSettledSpan = async <Planned, Row>(input: {
  pass: WalkPass;
  span: WalkWindow;
  settled: SettledSpan<Planned>;
  place: (planned: Planned[]) => Promise<Row[]>;
  add: (rows: Row[]) => Promise<number>;
  advance: (result: { owed: OwedGround[] }) => Promise<void>;
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

  await advance({ owed: ready.owed });

  return {
    imported,
    owed: ready.owed.length > 0,
    returned: ready.returned,
    stuck: ready.owed,
  };
};
