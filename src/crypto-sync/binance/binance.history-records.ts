import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import type { ExchangeHolding } from '@kiko/holdings/repo';
import { bifoldMap, type Either, eitherSync } from 'fnts/either';

import {
  BinanceWalkStop,
  distinctGround,
  isPoint,
  logWalkStop,
  type OwedGround,
  resolveWalletHoldings,
  type SpanCommit,
  type WalkPass,
  type WalkWindow,
} from './binance.history-walk';
import type { UnreadableRow } from './binance.history-client';
import type { BinanceWalletKey } from './binance.holding-keys';

/**
 * One span's records told apart: the rows of those the walk can trust, the codes of the stops
 * of those it cannot, the ground the stuck records owe, and the point of every record the read
 * returned, trusted or not (`returned`): the walk takes a point off its list only for one of
 * those. A point carries the series its record was read under, when the walk reads several.
 */
export type SettledSpan<Row> = {
  rows: Row[];
  codes: string[];
  owed: OwedGround[];
  returned: OwedGround[];
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
 * or one outside `reach` (the span, unless the read returns records beyond it) says nothing of
 * where in the span it is: it has no point.
 */
const pointOf = (reach: WalkWindow, extent: WalkWindow | undefined): WalkWindow | undefined => {
  if (
    extent === undefined ||
    !Number.isFinite(extent.start) ||
    !Number.isFinite(extent.end) ||
    extent.end < reach.start ||
    extent.start > reach.end
  ) {
    return undefined;
  }

  return { start: extent.start - 1, end: extent.end + 1 };
};

/** The point of a record with `series` (none, for a walk that reads one series). */
const withSeries = (point: WalkWindow, series: string | undefined): OwedGround => ({
  ...point,
  ...foldMap(maybe(series), (name) => ({ series: name })),
});

/** The ground a stuck record owes: its own point, or the whole span (a range) without one. */
const owedBy = (span: WalkWindow, point: OwedGround | undefined): OwedGround =>
  foldMap(maybe(point), (found): OwedGround => ({ ...found, kind: 'point' })) ?? span;

const settledRecord = <Row>(
  attempt: Either<unknown, Row[]>,
  span: WalkWindow,
  point: OwedGround | undefined,
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
 * back nothing else, so the rows of the others are still imported. A walk that reads several
 * series names the series a record was read under (`seriesOf`): its point, owed or returned,
 * carries it, so it is read in that series and leaves only for a record of it. A read that
 * compares a time coarser than a millisecond returns a record just before the span's start: the
 * walk gives that `reach`, the ground a read of the span returns records from, and a record in it
 * owes its own point; the whole span owed without a point is always the real span.
 */
export const settleRecords = <Record, Row>(input: {
  span: WalkWindow;
  reach?: WalkWindow;
  records: Record[];
  rowsOf: (record: Record) => Row[];
  extentOf: (record: Record) => WalkWindow | undefined;
  seriesOf?: (record: Record) => string;
}): SettledSpan<Row> => {
  const { span, reach = span, records, rowsOf, extentOf, seriesOf } = input;

  return joinSettled(
    records.map((record) =>
      settledRecord(
        eitherSync<unknown, Row[]>(() => rowsOf(record)),
        span,
        foldMap(maybe(pointOf(reach, extentOf(record))), (point) =>
          withSeries(point, seriesOf?.(record)),
        ),
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
  reach?: WalkWindow;
  unreadable: Row[];
  code: string;
  extentOf: (row: Row) => WalkWindow | undefined;
  seriesOf?: (row: Row) => string;
}): SettledSpan<never> =>
  settleRecords<Row, never>({
    span: input.span,
    reach: input.reach,
    records: input.unreadable,
    rowsOf: () => {
      throw new BinanceWalkStop(input.code);
    },
    extentOf: input.extentOf,
    seriesOf: input.seriesOf,
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
 * else commits. A code in `forwardOwes` is one the forward pass owes like the other passes do:
 * its record's point is stored (`advance` gets it) and the cursor goes past it, because the
 * record stays owed until the floor and no later read of the span would settle it differently.
 * Only a record with a usable time can be owed that way: a stop that owes more than a point (a
 * record with no time owes the whole span, and so does a stop that is no one record's) leaves the
 * span uncommitted, as does any other code beside it.
 */
export const commitSettledSpan = async <Planned, Row>(input: {
  pass: WalkPass;
  span: WalkWindow;
  settled: SettledSpan<Planned>;
  place: (planned: Planned[]) => Promise<Row[]>;
  add: (rows: Row[]) => Promise<number>;
  advance: (result: { owed: OwedGround[] }) => Promise<void>;
  forwardOwes?: readonly string[];
}): Promise<SpanCommit | undefined> => {
  const { pass, span, settled, add, advance, forwardOwes = [] } = input;
  const stopsRun = (part: Pick<SettledSpan<unknown>, 'codes' | 'owed'>): boolean =>
    pass === 'forward' &&
    (part.codes.some((code) => !forwardOwes.includes(code)) || !part.owed.every(isPoint));

  if (stopsRun(settled)) {
    logCodes(settled.codes);

    return undefined;
  }

  const ready = await placed({ span, settled, place: input.place });

  logCodes(ready.codes);

  if (stopsRun(ready)) {
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

/**
 * A row mapped from a record, before its wallets are turned into holdings: `wallet` is the one
 * it sits on, `counterpartWallet` the other leg's of a move between two wallets.
 */
type WalletPlannedRow = {
  wallet: BinanceWalletKey;
  counterpartWallet?: BinanceWalletKey;
  externalId: string;
};

type PlacedWalletRow<Planned extends WalletPlannedRow> = Omit<
  Planned,
  'wallet' | 'counterpartWallet'
> & {
  holdingId: string;
  source: 'binance';
  exchangeCounterpartHoldingId?: string;
};

/**
 * Turn the planned rows of a span (one row per key, the last one read) into importable ones,
 * creating a missing wallet holding at zero first. A wallet that cannot be resolved even after
 * creation is no one record's stop: it throws `BinanceWalkStop(missingCode)` and the span is
 * owed (see `placed`).
 */
export const placeWalletRows = async <Planned extends WalletPlannedRow>(input: {
  accountId: string;
  planned: Planned[];
  listHoldings: (accountId: string) => Promise<HoldingRow[]>;
  ensureHoldings: (holdings: ExchangeHolding[]) => Promise<void>;
  missingCode: string;
}): Promise<PlacedWalletRow<Planned>[]> => {
  const { accountId, listHoldings, ensureHoldings, missingCode } = input;
  const planned = [...new Map(input.planned.map((row) => [row.externalId, row])).values()];

  if (planned.length === 0) {
    return [];
  }

  const holdings = await resolveWalletHoldings({
    accountId,
    keys: [
      ...new Set(
        planned.flatMap((row) => [
          row.wallet,
          ...(foldMap(maybe(row.counterpartWallet), (key) => [key]) ?? []),
        ]),
      ),
    ],
    listHoldings,
    ensureHoldings,
  });

  return planned.map(({ wallet, counterpartWallet, ...row }): PlacedWalletRow<Planned> => {
    const holding = holdings.get(wallet);
    const counterpart = foldMap(maybe(counterpartWallet), (key) => holdings.get(key));

    if (holding === undefined || (counterpartWallet !== undefined && counterpart === undefined)) {
      throw new BinanceWalkStop(missingCode);
    }

    return {
      ...row,
      holdingId: holding.id,
      source: 'binance',
      ...foldMap(maybe(counterpart), (found) => ({ exchangeCounterpartHoldingId: found.id })),
    };
  });
};
