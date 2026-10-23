import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import type { Currency } from '@kiko/currency/currency';
import type { ExchangeHolding } from '@kiko/holdings/repo';
import { bifoldMap, type Either, eitherSync } from 'fnts/either';

import { type AmountError, type AmountUse, exchangeMinorUnits } from '../amounts';

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
} from './walk';
import type { ExchangeWalkConfig } from './walk-config';
import type { ExchangeStateDeps } from './exchange-state-deps';

/**
 * One span's records told apart: the rows of those the walk can trust, the codes of the stops
 * of those it cannot, the ground the stuck records owe, and the point of every record the read
 * returned, trusted or not (`returned`): the walk takes a point off its list only for one of
 * those. A point carries the series its record was read under, when the walk reads several.
 * `oversized` names the coins of the records that stopped too large, and `untracked` the tickers of
 * the records counted but imported as no row (a coin the walk does not track); each is left out
 * when there is none. `notImported` holds the entries of the records a rule refused for good (see
 * `notImportedEntry`), also left out when there is none.
 */
export type SettledSpan<Row> = {
  rows: Row[];
  codes: string[];
  owed: OwedGround[];
  returned: OwedGround[];
  oversized?: string[];
  untracked?: string[];
  notImported?: string[];
};

/**
 * Every code of the amount parser, for a lane that owes the point of a record the parser refused
 * and goes past it in the forward pass (`forwardOwes`).
 */
export const AMOUNT_STOP_CODES: readonly AmountError[] = [
  'amount-malformed',
  'amount-precision',
  'amount-too-large',
];

/**
 * The exact minor units of a history row's amount text, in the coin's own scale. A text the
 * parser refuses stops the record with the parser's code, and an amount past the safe integer
 * names its coin, so the walk lists it as oversized. Only the trade read passes `'trade-row'`,
 * which also rounds a fiat amount past its scale.
 */
export const rowMinorUnits = (
  currency: Currency,
  text: string,
  use: Extract<AmountUse, 'row' | 'trade-row'> = 'row',
): number =>
  bifoldMap(
    exchangeMinorUnits(currency, text, use),
    (code): number => {
      throw new BinanceWalkStop(code, code === 'amount-too-large' ? currency : undefined);
    },
    (units) => units,
  );

/**
 * The write of the coins a history read met, to one of the two history lists: the oversized coins
 * (a record whose amount stopped too large) or the untracked ones (a window counted them but
 * imported no row). One union patch, as a list only grows (see `withCoinList`).
 */
export const historyListWriterOf =
  (
    deps: Pick<ExchangeStateDeps, 'patchExchangeState'>,
    accountId: string,
    coins: 'oversizedCoins' | 'untrackedCoins',
  ) =>
  (tickers: readonly string[]): Promise<void> =>
    deps.patchExchangeState(accountId, [
      { kind: 'coinList', coins, list: 'history', tickers: [...tickers] },
    ]);

/** The write of a span's not-imported entries: one union patch, as the list only grows. */
export const notImportedWriterOf =
  (deps: Pick<ExchangeStateDeps, 'patchExchangeState'>, accountId: string) =>
  (entries: readonly string[]): Promise<void> =>
    deps.patchExchangeState(accountId, [{ kind: 'notImported', entries: [...entries] }]);

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

/** A record the walk counted but imports as no row: its point is returned, nothing is owed. */
const untrackedRecord = <Row>(ticker: string, point: OwedGround | undefined): SettledSpan<Row> => ({
  rows: [],
  codes: [],
  owed: [],
  returned: foldMap(maybe(point), (found) => [found]) ?? [],
  untracked: [ticker],
});

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

      return {
        rows: [],
        codes: [error.code],
        owed: [owedBy(span, point)],
        returned,
        ...foldMap(maybe(error.oversizedTicker), (ticker) => ({ oversized: [ticker] })),
      };
    },
    (rows): SettledSpan<Row> => ({ rows, codes: [], owed: [], returned }),
  );
};

/**
 * The settled parts of one span as one. The same ground is owed once; a point is never taken
 * into a range that holds it, and a range never into another entry, so the whole span owed
 * beside the point of a record in it is two entries.
 */
export const joinSettled = <Row>(parts: SettledSpan<Row>[]): SettledSpan<Row> => {
  const oversized = [...new Set(parts.flatMap((part) => part.oversized ?? []))];
  const untracked = [...new Set(parts.flatMap((part) => part.untracked ?? []))];
  const notImported = [...new Set(parts.flatMap((part) => part.notImported ?? []))];

  return {
    rows: parts.flatMap((part) => part.rows),
    codes: parts.flatMap((part) => part.codes),
    owed: distinctGround(parts.flatMap((part) => part.owed)),
    returned: parts.flatMap((part) => part.returned),
    ...(oversized.length > 0 ? { oversized } : {}),
    ...(untracked.length > 0 ? { untracked } : {}),
    ...(notImported.length > 0 ? { notImported } : {}),
  };
};

/**
 * The records of one span, each on its own: a record the walk cannot trust (its `rowsOf` throws
 * a `BinanceWalkStop`) owes only the ground it sits in (`extentOf`, see `pointOf`) and holds
 * back nothing else, so the rows of the others are still imported. A walk that reads several
 * series names the series a record was read under (`seriesOf`): its point, owed or returned,
 * carries it, so it is read in that series and leaves only for a record of it. A read that
 * compares a time coarser than a millisecond returns a record just before the span's start: the
 * walk gives that `reach`, the ground a read of the span returns records from, and a record in it
 * owes its own point; the whole span owed without a point is always the real span. A record whose
 * `untrackedOf` gives a ticker is a coin the walk does not track: it is counted (its point is
 * returned) and never read, so it gives no row, no stop and no owed ground, and its ticker is
 * named in `untracked`.
 */
export const settleRecords = <Record, Row>(input: {
  span: WalkWindow;
  reach?: WalkWindow;
  records: Record[];
  rowsOf: (record: Record) => Row[];
  extentOf: (record: Record) => WalkWindow | undefined;
  seriesOf?: (record: Record) => string;
  untrackedOf?: (record: Record) => string | undefined;
}): SettledSpan<Row> => {
  const { span, reach = span, records, rowsOf, extentOf, seriesOf, untrackedOf } = input;

  return joinSettled(
    records.map((record) => {
      const point = foldMap(maybe(pointOf(reach, extentOf(record))), (found) =>
        withSeries(found, seriesOf?.(record)),
      );

      return (
        foldMap(maybe(untrackedOf?.(record)), (ticker) => untrackedRecord(ticker, point)) ??
        settledRecord(
          eitherSync<unknown, Row[]>(() => rowsOf(record)),
          span,
          point,
        )
      );
    }),
  );
};

/**
 * A row the client could not read, kept for the walk instead of failing the read: it holds
 * nothing of the row but its own time field when that is usable (a finite number or, for a
 * withdrawal, a datetime text), else `undefined`. The walk owes the row's point, or its span.
 */
export type UnreadableRow = { time: number | string | undefined };

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
 * Ground the forward pass owes and goes past: the point of one record, or a range owed in one
 * series (the ground that series left unread, which holds nothing back in the others). A range
 * owed in every series is a stop of the span as a whole.
 */
const isOwedPast = (ground: OwedGround): boolean => isPoint(ground) || ground.series !== undefined;

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
 * span uncommitted, as does any other code beside it. The tickers the span counted but imported as
 * no row (`untracked`) are written once its rows are, and then the not-imported entries
 * (`notImported`, through `writeNotImported`), still before the marks move.
 */
export const commitSettledSpan = async <Planned, Row>(input: {
  pass: WalkPass;
  span: WalkWindow;
  settled: SettledSpan<Planned>;
  place: (planned: Planned[]) => Promise<Row[]>;
  add: (rows: Row[]) => Promise<number>;
  advance: (result: { owed: OwedGround[] }) => Promise<void>;
  writeOversized: (tickers: readonly string[]) => Promise<void>;
  writeUntracked: (tickers: readonly string[]) => Promise<void>;
  writeNotImported: (entries: readonly string[]) => Promise<void>;
  forwardOwes?: readonly string[];
}): Promise<SpanCommit | undefined> => {
  const {
    pass,
    span,
    settled,
    add,
    advance,
    writeOversized,
    writeUntracked,
    writeNotImported,
    forwardOwes = [],
  } = input;
  const stopsRun = (part: Pick<SettledSpan<unknown>, 'codes' | 'owed'>): boolean =>
    pass === 'forward' &&
    (part.codes.some((code) => !forwardOwes.includes(code)) || !part.owed.every(isOwedPast));

  // Before any stop of the forward pass returns, which commits nothing of its span: a capital or
  // Pay amount that is too large is met again on every run until it ages out, and would never be
  // listed if the write waited for a commit.
  if (settled.oversized !== undefined) {
    await writeOversized(settled.oversized);
  }

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

  // Once for the window, after its rows and before its marks: a crash between the two reads the
  // span again, and a ticker that is already listed changes nothing.
  if (ready.untracked !== undefined) {
    await writeUntracked(ready.untracked);
  }

  // Its own write, as the entries are not coins: same order, so a crash re-reads the span and
  // an entry that is already listed changes nothing.
  if (ready.notImported !== undefined) {
    await writeNotImported(ready.notImported);
  }

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
  wallet: string;
  counterpartWallet?: string;
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
  config: ExchangeWalkConfig<Error, unknown>;
  listHoldings: (accountId: string) => Promise<HoldingRow[]>;
  ensureHoldings: (holdings: ExchangeHolding[]) => Promise<void>;
  missingCode: string;
}): Promise<PlacedWalletRow<Planned>[]> => {
  const { accountId, config, listHoldings, ensureHoldings, missingCode } = input;
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
    config,
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
