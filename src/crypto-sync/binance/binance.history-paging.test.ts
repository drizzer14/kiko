import { DAY_MS } from '@kiko/dates';

import {
  createDepthMemories,
  createDepthMemory,
  DEPTH_MARGIN_MS,
  DEPTH_RESOLUTION_MS,
  type DepthGuard,
  type DepthMemory,
  MAX_DEPTH_REFUSALS,
  rememberServedStart,
} from './binance.history-depth';
import {
  BINANCE_REQUEST_INTERVAL_MS,
  COSTS,
  createBinanceHistoryRun,
  IP_BUDGET_1M,
  LANE_CALL_CAPS,
  LANE_NARROWING_CALLS,
} from './binance.history-budget';
import {
  crossingOf,
  depthWorldOf,
  isProbeRead,
  jitterMs,
  readDepthWorld,
  refusedSpanReadsOf,
  skippedMsOf,
} from './binance.depth-test-fixtures';
import type { TotalPage, UnreadableRow } from './binance.history-client';
import { fetchAllByTotal, readSeriesSpan } from './binance.history-paging';
import { BinanceHistoryTooOldError, BinanceRateLimitError } from './binance.client';

const NOW = 1_704_326_400_000;
const FULL_PAGE = 100;
const SPAN = { start: 1_000, end: 5_000 };
const HALF = { start: 1_000, end: 3_000 };
const ONE_MS_SPAN = { start: 1_000, end: 1_001 };
const CAP = LANE_CALL_CAPS.transfer;

type Row = { id: number };

const freshRun = () => createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined });

/** A page of `count` rows of a read whose server counts `total` rows; `gathered` is every row. */
const pageOf = (count: number, total: number, over: Partial<TotalPage<Row>> = {}) => ({
  rows: Array.from({ length: count }, (_unused, id) => ({ id })),
  unreadable: [],
  gathered: count,
  total,
  usedUidWeight1m: undefined,
  usedIpWeight1m: undefined,
  ...over,
});

/** The pages of a scripted read, in order, and the `current` of each request. */
const scripted = (pages: TotalPage<Row>[]) => {
  const requested: number[] = [];

  return {
    requested,
    fetchPage: jest.fn(async (current: number) => {
      requested.push(current);

      return pages[current - 1] ?? pageOf(0, 0);
    }),
  };
};

const pagingOf = (
  over: Partial<Parameters<typeof fetchAllByTotal<Row>>[0]> & {
    fetchPage: (current: number) => Promise<TotalPage<Row> | undefined>;
  },
) =>
  fetchAllByTotal<Row>({
    run: freshRun(),
    lane: 'transfer',
    cost: COSTS.transfer,
    keep: 0,
    half: () => HALF,
    maxPages: 50,
    ...over,
  });

describe('fetchAllByTotal', () => {
  it('answers a full page with more rows behind it, in a span that halves, with the half to read instead', async () => {
    const { fetchPage, requested } = scripted([pageOf(FULL_PAGE, 250)]);

    const result = await pagingOf({ fetchPage });

    expect(result).toEqual({ kind: 'split', half: HALF });
    expect(requested).toEqual([1]);
  });

  it('pages a span of one millisecond by current until the rows counted are the total', async () => {
    const { fetchPage, requested } = scripted([
      pageOf(FULL_PAGE, 250),
      pageOf(FULL_PAGE, 250, { rows: [{ id: 100 }] }),
      pageOf(50, 250, { rows: [{ id: 200 }] }),
    ]);

    const result = await pagingOf({ fetchPage, half: () => undefined });

    expect(requested).toEqual([1, 2, 3]);
    expect(result).toEqual({
      kind: 'rows',
      rows: [...pageOf(FULL_PAGE, 250).rows, { id: 100 }, { id: 200 }],
      unreadable: [],
    });
  });

  it('is a clean stop, spending no call, when the page is not fetched (it answers nothing)', async () => {
    const run = freshRun();
    const fetchPage = jest.fn(async () => undefined);

    expect(await pagingOf({ fetchPage, run })).toBeUndefined();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(run.budget.canAfford('transfer', COSTS.transfer, CAP - 1)).toBe(true);
  });

  it('is the rows of a short page whose rows counted are the total', async () => {
    const { fetchPage } = scripted([pageOf(3, 3)]);

    expect(await pagingOf({ fetchPage })).toEqual({
      kind: 'rows',
      rows: [{ id: 0 }, { id: 1 }, { id: 2 }],
      unreadable: [],
    });
  });

  it('is the rows of a full page whose rows counted are the total: nothing is behind it', async () => {
    const { fetchPage, requested } = scripted([pageOf(FULL_PAGE, FULL_PAGE)]);

    const result = await pagingOf({ fetchPage });

    expect(result).toMatchObject({ kind: 'rows' });
    expect(requested).toEqual([1]);
  });

  it('is a drift when a short page leaves the rows counted short of the total', async () => {
    const { fetchPage } = scripted([pageOf(40, 90)]);

    expect(await pagingOf({ fetchPage })).toEqual({ kind: 'drift' });
  });

  it('is a drift for a total above the rows of an empty page: the rows were left out, not absent', async () => {
    const { fetchPage } = scripted([pageOf(0, 5)]);

    expect(await pagingOf({ fetchPage })).toEqual({ kind: 'drift' });
  });

  it('is empty rows for a total of zero and an empty page', async () => {
    const { fetchPage } = scripted([pageOf(0, 0)]);

    expect(await pagingOf({ fetchPage })).toEqual({ kind: 'rows', rows: [], unreadable: [] });
  });

  it('is a drift when the rows counted pass the total', async () => {
    const { fetchPage } = scripted([pageOf(FULL_PAGE, 60)]);

    expect(await pagingOf({ fetchPage, half: () => undefined })).toEqual({ kind: 'drift' });
  });

  it('is a drift when the pages allowed leave the rows counted short of the total', async () => {
    const { fetchPage, requested } = scripted(
      Array.from({ length: 5 }, () => pageOf(FULL_PAGE, 1_000)),
    );

    const result = await pagingOf({ fetchPage, half: () => undefined, maxPages: 3 });

    expect(result).toEqual({ kind: 'drift' });
    expect(requested).toEqual([1, 2, 3]);
  });

  it('counts a row of any asset and a row it could not read as part of the page', async () => {
    const unreadable: UnreadableRow[] = [{ time: 5 }, { time: undefined }];
    const { fetchPage } = scripted([pageOf(1, 5, { gathered: 5, unreadable })]);

    const result = await pagingOf({ fetchPage });

    expect(result).toEqual({ kind: 'rows', rows: [{ id: 0 }], unreadable });
  });

  it('keeps the unreadable rows of every page of a span of one millisecond', async () => {
    const { fetchPage } = scripted([
      pageOf(FULL_PAGE - 1, 101, { gathered: FULL_PAGE, unreadable: [{ time: 1 }] }),
      pageOf(0, 101, { gathered: 1, unreadable: [{ time: 2 }] }),
    ]);

    const result = await pagingOf({ fetchPage, half: () => undefined });

    expect(result).toMatchObject({ kind: 'rows', unreadable: [{ time: 1 }, { time: 2 }] });
  });

  it('gives up with nothing when the next page is unaffordable, before any request of it', async () => {
    const { fetchPage, requested } = scripted([pageOf(FULL_PAGE, 250), pageOf(FULL_PAGE, 250)]);

    const result = await pagingOf({ fetchPage, half: () => undefined, keep: CAP - 1 });

    expect(result).toBeUndefined();
    expect(requested).toEqual([1]);
  });

  it('asks nothing when even the first page is unaffordable', async () => {
    const { fetchPage } = scripted([pageOf(0, 0)]);

    expect(await pagingOf({ fetchPage, keep: CAP })).toBeUndefined();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('spends one call of the lane on every page it reads', async () => {
    const run = freshRun();
    const { fetchPage } = scripted([pageOf(FULL_PAGE, 150), pageOf(50, 150)]);

    await pagingOf({ run, fetchPage, half: () => undefined });

    // Two calls are spent: a read that keeps CAP - 2 calls has none left for itself.
    expect(run.budget.canAfford('transfer', COSTS.transfer, CAP - 3)).toBe(true);
    expect(run.budget.canAfford('transfer', COSTS.transfer, CAP - 2)).toBe(false);
  });

  it('passes every request through the pacing gate first', async () => {
    const run = freshRun();
    const wait = jest.spyOn(run.gate, 'wait');
    const { fetchPage } = scripted([pageOf(FULL_PAGE, 150), pageOf(50, 150)]);

    await pagingOf({ run, fetchPage, half: () => undefined });

    expect(wait).toHaveBeenCalledTimes(2);
  });
});

describe('readSeriesSpan', () => {
  const SERIES = ['MAIN_FUNDING', 'FUNDING_MAIN', 'MAIN_UMFUTURE'] as const;
  type Series = (typeof SERIES)[number];

  const readOf = (
    over: Partial<Parameters<typeof readSeriesSpan<Series, Row>>[0]> & {
      fetchPage: (series: Series, span: typeof SPAN, current: number) => Promise<TotalPage<Row>>;
    },
  ) =>
    readSeriesSpan<Series, Row>({
      run: freshRun(),
      lane: 'transfer',
      cost: COSTS.transfer,
      span: SPAN,
      keep: 0,
      series: SERIES,
      maxPages: 50,
      onRateLimit: jest.fn(),
      ...over,
    });

  it('reads every series of the span, in the order given, one page each, and asks each for the span', async () => {
    const fetchPage = jest.fn(async (_series: Series, _span: typeof SPAN, _current: number) =>
      pageOf(1, 1),
    );

    const result = await readOf({ fetchPage });

    expect(fetchPage.mock.calls).toEqual([
      ['MAIN_FUNDING', SPAN, 1],
      ['FUNDING_MAIN', SPAN, 1],
      ['MAIN_UMFUTURE', SPAN, 1],
    ]);
    expect(result).toEqual({
      kind: 'page',
      page: {
        read: SERIES.map((series) => ({ series, rows: [{ id: 0 }], unreadable: [] })),
        drifted: [],
      },
    });
  });

  it('is not entered when the calls of every series and the calls it keeps do not fit: no request', async () => {
    const fetchPage = jest.fn(async () => pageOf(0, 0));

    // 78 kept and 3 series need 81 of the 80 calls; 77 kept fits exactly.
    expect(await readOf({ fetchPage, keep: CAP - 2 })).toBeUndefined();
    expect(fetchPage).not.toHaveBeenCalled();

    expect(await readOf({ fetchPage, keep: CAP - 3 })).toMatchObject({ kind: 'page' });
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('answers the half to read instead when a series that is not the first splits, after the reads before it', async () => {
    const fetchPage = jest.fn(async (series: Series) =>
      series === 'MAIN_UMFUTURE' ? pageOf(FULL_PAGE, 250) : pageOf(0, 0),
    );

    const result = await readOf({ fetchPage });

    expect(result).toEqual({ kind: 'split', half: HALF });
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('reads no series after the one that splits', async () => {
    const fetchPage = jest.fn(async (series: Series) =>
      series === 'MAIN_FUNDING' ? pageOf(FULL_PAGE, 250) : pageOf(0, 0),
    );

    const result = await readOf({ fetchPage });

    expect(result).toMatchObject({ kind: 'split' });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('pages a span of one millisecond, which cannot split, by current', async () => {
    const fetchPage = jest.fn(async (series: Series, _span: typeof SPAN, current: number) =>
      series === 'MAIN_FUNDING' ? pageOf(current === 1 ? FULL_PAGE : 20, 120) : pageOf(0, 0),
    );

    const result = await readOf({ fetchPage, span: ONE_MS_SPAN });

    expect(result).toMatchObject({ kind: 'page' });
    expect(fetchPage.mock.calls.map(([series, , current]) => [series, current])).toEqual([
      ['MAIN_FUNDING', 1],
      ['MAIN_FUNDING', 2],
      ['FUNDING_MAIN', 1],
      ['MAIN_UMFUTURE', 1],
    ]);
  });

  it('keeps the rows of the series that did not drift and names the one that did', async () => {
    const fetchPage = jest.fn(async (series: Series) =>
      series === 'FUNDING_MAIN' ? pageOf(40, 90) : pageOf(2, 2),
    );

    const result = await readOf({ fetchPage });

    expect(result).toEqual({
      kind: 'page',
      page: {
        read: [
          { series: 'MAIN_FUNDING', rows: [{ id: 0 }, { id: 1 }], unreadable: [] },
          { series: 'MAIN_UMFUTURE', rows: [{ id: 0 }, { id: 1 }], unreadable: [] },
        ],
        drifted: ['FUNDING_MAIN'],
      },
    });
  });

  it('carries the unreadable rows of each series with its rows', async () => {
    const fetchPage = jest.fn(async (series: Series) =>
      series === 'FUNDING_MAIN'
        ? pageOf(0, 1, { gathered: 1, unreadable: [{ time: 7 }] })
        : pageOf(0, 0),
    );

    const result = await readOf({ fetchPage });

    expect(result).toMatchObject({
      page: { read: [{}, { series: 'FUNDING_MAIN', unreadable: [{ time: 7 }] }, {}] },
    });
  });

  it('reports a rate limit to the caller and gives up the read, with no further request', async () => {
    const limited = new BinanceRateLimitError(429, 60_000);
    const onRateLimit = jest.fn();
    const fetchPage = jest.fn(async (series: Series) => {
      if (series === 'FUNDING_MAIN') {
        throw limited;
      }

      return pageOf(0, 0);
    });

    const result = await readOf({ fetchPage, onRateLimit });

    expect(result).toBeUndefined();
    expect(onRateLimit).toHaveBeenCalledWith(limited);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('rethrows any other failure', async () => {
    const fetchPage = jest.fn(async () => {
      throw new Error('boom');
    });

    await expect(readOf({ fetchPage })).rejects.toThrow('boom');
  });

  it('spends no page the calls of the later series could not follow', async () => {
    const fetchPage = jest.fn(async (series: Series, _span: typeof SPAN, current: number) =>
      series === 'MAIN_FUNDING' ? pageOf(FULL_PAGE, 300) : pageOf(0, 0, { gathered: current }),
    );

    // Two series follow the first and 77 calls are kept: the first series may spend two calls.
    const result = await readOf({ fetchPage, span: ONE_MS_SPAN, keep: CAP - 4 });

    expect(result).toBeUndefined();
    expect(fetchPage.mock.calls.map(([, , current]) => current)).toEqual([1, 2]);
  });
});

describe('readSeriesSpan, against a Binance that refuses a start older than it keeps', () => {
  const SERIES = ['MAIN_FUNDING', 'FUNDING_MAIN', 'MAIN_UMFUTURE'] as const;
  type Series = (typeof SERIES)[number];

  const BASE = 1_700_000_000_000;
  const DEEP = { start: BASE, end: BASE + 10 * DAY_MS };
  const SERVED_FROM = BASE + 4 * DAY_MS + 345;

  const depthOf = (over: Partial<DepthGuard> = {}): DepthGuard => ({
    isRefusal: (error) => error instanceof BinanceHistoryTooOldError,
    nowMs: () => NOW,
    floorMs: () => BASE - DAY_MS,
    ...createDepthMemories(() => NOW),
    ...over,
  });

  /** A memory that holds a start Binance refused, a bound that does not move with the clock. */
  const boundedAt = (startMs: number): DepthMemory => {
    const memory = createDepthMemory();
    rememberServedStart(memory, { startMs, servedAtMs: undefined });

    return memory;
  };

  /** A server that keeps every start from `servedFrom` on, and refuses an older one. */
  const keeping = (
    servedFrom: number,
    page: (series: Series) => TotalPage<Row> = () => pageOf(1, 1),
  ) =>
    jest.fn(async (series: Series, span: typeof DEEP, _current: number) => {
      if (span.start < servedFrom) {
        throw new BinanceHistoryTooOldError('too old');
      }

      return page(series);
    });

  const readDeep = (
    over: Partial<Parameters<typeof readSeriesSpan<Series, Row>>[0]> & {
      fetchPage: (series: Series, span: typeof DEEP, current: number) => Promise<TotalPage<Row>>;
    },
  ) =>
    readSeriesSpan<Series, Row>({
      run: freshRun(),
      lane: 'transfer',
      cost: COSTS.transfer,
      span: DEEP,
      keep: 0,
      series: SERIES,
      maxPages: 50,
      onRateLimit: jest.fn(),
      depth: depthOf(),
      ...over,
    });

  const startsOf = (fetchPage: jest.Mock): number[] =>
    fetchPage.mock.calls.map(([, span]) => (span as typeof DEEP).start);

  it('reads every series from the start Binance serves it, the one refusal behind it, keeps the memory of each, and reads the ground between the start and the one it read from in the same span read', async () => {
    const fetchPage = keeping(SERVED_FROM);
    const depth = depthOf();

    const result = await readDeep({ fetchPage, depth });

    const realReads = fetchPage.mock.calls.filter(([, span]) => span.end - span.start > 1);
    const found = depth.memoryOf('MAIN_FUNDING').startMs ?? 0;
    expect(found).toBeGreaterThanOrEqual(SERVED_FROM);
    expect(found - SERVED_FROM).toBeLessThan(DEPTH_RESOLUTION_MS);
    expect(SERIES.map((series) => depth.memoryOf(series).startMs)).toEqual(SERIES.map(() => found));
    expect(realReads.map(([series, span]) => [series, span.start, span.end])).toEqual(
      SERIES.flatMap((series) => [
        [series, DEEP.start, DEEP.end],
        [series, found + DEPTH_MARGIN_MS, DEEP.end],
        [series, found, found + DEPTH_MARGIN_MS],
      ]),
    );
    expect(result).toEqual({
      kind: 'page',
      page: {
        read: SERIES.map((series) => ({
          series,
          rows: [{ id: 0 }, { id: 0 }],
          unreadable: [],
        })),
        drifted: [],
        owed: [],
      },
    });
  });

  it('keeps the rows of the series read before the refusal, and reads them no more', async () => {
    const served = new Set<Series>();
    // Binance forgets the first days once the first series is answered.
    const fetchPage = jest.fn(async (series: Series, span: typeof DEEP, _current: number) => {
      if (served.size > 0 && span.start < SERVED_FROM) {
        throw new BinanceHistoryTooOldError('too old');
      }

      served.add(series);

      return pageOf(1, 1, { rows: [{ id: SERIES.indexOf(series) }] });
    });

    const result = await readDeep({ fetchPage });

    const firstReads = fetchPage.mock.calls.filter(
      ([series, span]) => series === 'MAIN_FUNDING' && span.start === DEEP.start,
    );
    expect(firstReads).toHaveLength(1);
    // The first series was read whole before the refusal; the others are read from the start they
    // are served from, and their bands are served.
    expect(result).toMatchObject({
      page: {
        read: [
          { series: 'MAIN_FUNDING', rows: [{ id: 0 }] },
          { series: 'FUNDING_MAIN', rows: [{ id: 1 }, { id: 1 }] },
          { series: 'MAIN_UMFUTURE', rows: [{ id: 2 }, { id: 2 }] },
        ],
        owed: [],
      },
    });
  });

  it('reads a span whose end Binance refuses as empty in each series by itself, and no later span asks the refused ground', async () => {
    const fetchPage = keeping(DEEP.end + 1);
    const depth = depthOf();

    const result = await readDeep({ fetchPage, depth });

    expect(result).toEqual({ kind: 'page', page: { read: [], drifted: [], owed: [] } });
    expect(fetchPage).toHaveBeenCalledTimes(SERIES.length + 1);
    expect(SERIES.map((series) => depth.memoryOf(series).startMs)).toEqual(
      SERIES.map(() => DEEP.end),
    );

    fetchPage.mockClear();
    await readDeep({ fetchPage, depth, span: { start: DEEP.start - DAY_MS, end: DEEP.end } });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('asks the end of the span, and nothing else, of a series with no memory when another series was refused the end', async () => {
    const fetchPage = keeping(DEEP.end + 1);
    const depth = depthOf();

    const result = await readDeep({ fetchPage, depth });

    // The first series pays its refused read and the end; each of the others the end alone.
    expect(result).toEqual({ kind: 'page', page: { read: [], drifted: [], owed: [] } });
    expect(fetchPage.mock.calls.map(([series, span]) => [series, span.end - span.start])).toEqual([
      ['MAIN_FUNDING', DEEP.end - DEEP.start],
      ['MAIN_FUNDING', 1],
      ['FUNDING_MAIN', 1],
      ['MAIN_UMFUTURE', 1],
    ]);
    expect(SERIES.map((series) => depth.memoryOf(series).startMs)).toEqual(
      SERIES.map(() => DEEP.end),
    );
  });

  it('reads a series that serves the end of the span from the start of the span, when another series was refused the end', async () => {
    const keepsAll = jest.fn(async (series: Series, span: typeof DEEP, _current: number) => {
      if (series === 'MAIN_FUNDING' && span.start < DEEP.end + 1) {
        throw new BinanceHistoryTooOldError('too old');
      }

      return pageOf(1, 1);
    });

    const result = await readDeep({ fetchPage: keepsAll });

    expect(result).toEqual({
      kind: 'page',
      page: {
        read: ['FUNDING_MAIN', 'MAIN_UMFUTURE'].map((series) => ({
          series,
          rows: [{ id: 0 }],
          unreadable: [],
        })),
        drifted: [],
        owed: [],
      },
    });
    expect(
      keepsAll.mock.calls
        .filter(([series]) => series === 'FUNDING_MAIN')
        .map(([, span]) => [span.start, span.end]),
    ).toEqual([
      [DEEP.end, DEEP.end + 1],
      [DEEP.start, DEEP.end],
    ]);
  });

  it('asks the end of a span that starts at the bound a series holds, with no read of the ground the bound refuses', async () => {
    const fetchPage = keeping(DEEP.end + 10 * DAY_MS + 1);
    const depth = depthOf();
    const next = { start: DEEP.end, end: DEEP.end + 10 * DAY_MS };

    await readDeep({ fetchPage, depth });
    fetchPage.mockClear();
    const result = await readDeep({ fetchPage, depth, span: next });

    expect(result).toEqual({ kind: 'page', page: { read: [], drifted: [], owed: [] } });
    expect(fetchPage.mock.calls.map(([series, span]) => [series, span.start, span.end])).toEqual(
      SERIES.map((series) => [series, next.end, next.end + 1]),
    );
  });

  it('reads the series after one whose span lies below the depth, from the start each of them is served from', async () => {
    const belowFor = (series: Series): number => (series === 'MAIN_FUNDING' ? DEEP.end + 1 : 0);
    const fetchPage = jest.fn(async (series: Series, span: typeof DEEP, _current: number) => {
      if (span.start < belowFor(series)) {
        throw new BinanceHistoryTooOldError('too old');
      }

      return pageOf(1, 1);
    });

    const result = await readDeep({ fetchPage });

    expect(result).toEqual({
      kind: 'page',
      page: {
        read: ['FUNDING_MAIN', 'MAIN_UMFUTURE'].map((series) => ({
          series,
          rows: [{ id: 0 }],
          unreadable: [],
        })),
        drifted: [],
        owed: [],
      },
    });
  });

  it('narrows a span from the bound each series holds at once, with no request for the ground below it', async () => {
    const fetchPage = keeping(0);
    const bound = DEEP.start + 2 * DAY_MS;
    const depth = depthOf({ memoryOf: () => boundedAt(bound) });

    await readDeep({ fetchPage, depth });

    expect(Math.min(...startsOf(fetchPage))).toBeGreaterThanOrEqual(bound);
    expect(
      SERIES.map((series) => fetchPage.mock.calls.find(([name]) => name === series)?.[1].end),
    ).toEqual(SERIES.map(() => DEEP.end + 1));
  });

  it('asks nothing of a span that ends at or before the start already known to be served', async () => {
    const fetchPage = keeping(0);

    const result = await readDeep({
      fetchPage,
      depth: depthOf({ memoryOf: () => boundedAt(DEEP.end) }),
    });

    expect(result).toEqual({ kind: 'page', page: { read: [], drifted: [], owed: [] } });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('reads a span that ends at or before the floor of now as empty, with no request', async () => {
    const fetchPage = keeping(DEEP.end + DAY_MS);

    const result = await readDeep({ fetchPage, depth: depthOf({ floorMs: () => DEEP.end }) });

    expect(result).toEqual({ kind: 'page', page: { read: [], drifted: [], owed: [] } });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('reads a span that starts below the floor of now from the floor, and owes nothing below it', async () => {
    const floorMs = DEEP.start + 2 * DAY_MS;
    const fetchPage = keeping(floorMs);

    const result = await readDeep({ fetchPage, depth: depthOf({ floorMs: () => floorMs }) });

    expect(result).toMatchObject({ kind: 'page', page: { drifted: [], owed: [] } });
    expect(startsOf(fetchPage)).toEqual(SERIES.map(() => floorMs));
  });

  it('answers the half of the span that starts where the span does, when the read from the served start comes back full', async () => {
    const fetchPage = keeping(SERVED_FROM, () => pageOf(FULL_PAGE, 250));
    const depth = depthOf();

    const result = await readDeep({ fetchPage, depth });

    const readFrom = (depth.memoryOf('MAIN_FUNDING').startMs ?? 0) + DEPTH_MARGIN_MS;
    expect(result).toEqual({
      kind: 'split',
      half: { start: DEEP.start, end: readFrom + Math.floor((DEEP.end - readFrom) / 2) },
    });
  });

  it('owes the span in a series that reaches the MAX_DEPTH_REFUSALS-th refusal, and reads the others', async () => {
    // Every start is served as a probe (one millisecond); the first series has its reads refused.
    const fetchPage = jest.fn(async (series: Series, span: typeof DEEP, _current: number) => {
      if (span.end - span.start > 1 && series === 'MAIN_FUNDING') {
        throw new BinanceHistoryTooOldError('too old');
      }

      return pageOf(1, 1);
    });

    const result = await readDeep({ fetchPage });

    expect(
      fetchPage.mock.calls.filter(
        ([series, span]) => series === 'MAIN_FUNDING' && span.end - span.start > 1,
      ),
    ).toHaveLength(MAX_DEPTH_REFUSALS);
    expect(result).toEqual({
      kind: 'page',
      page: {
        read: ['FUNDING_MAIN', 'MAIN_UMFUTURE'].map((series) => ({
          series,
          rows: [{ id: 0 }],
          unreadable: [],
        })),
        drifted: [],
        owed: [{ series: 'MAIN_FUNDING', window: DEEP }],
      },
    });
  });

  it('spends a call of the lane on every request it makes, a refused one too, each after the shared gate', async () => {
    const run = freshRun();
    const wait = jest.spyOn(run.gate, 'wait');
    const record = jest.spyOn(run.budget, 'record');
    const fetchPage = keeping(SERVED_FROM);

    await readDeep({ run, fetchPage });

    const made = fetchPage.mock.calls.length;
    expect(record).toHaveBeenCalledTimes(made);
    expect(wait).toHaveBeenCalledTimes(made);
  });

  it('owes the span in each series whose narrowing the budget cannot afford, never reading it as empty', async () => {
    const fetchPage = keeping(SERVED_FROM);
    const run = {
      gate: freshRun().gate,
      budget: {
        canAfford: (_lane: unknown, _cost: unknown, keep = 0) =>
          fetchPage.mock.calls.length + keep < 6,
        record: () => undefined,
      },
    };

    const result = await readDeep({ run, fetchPage });

    // The first series spends the refused read and four probes, the second its refused read, and
    // the third no request: the lane has no call left for it.
    expect(result).toEqual({
      kind: 'page',
      page: { read: [], drifted: [], owed: SERIES.map((series) => ({ series, window: DEEP })) },
    });
    expect(fetchPage).toHaveBeenCalledTimes(6);
  });

  it('lets a series that narrows spend the calls kept for the series after it, which are then owed in full', async () => {
    const fetchPage = keeping(SERVED_FROM);
    const cap = 24;
    const run = {
      gate: freshRun().gate,
      budget: {
        canAfford: (_lane: unknown, _cost: unknown, keep = 0) =>
          fetchPage.mock.calls.length + keep < cap,
        record: () => undefined,
      },
    };

    const result = await readDeep({ run, fetchPage });

    // The first series needs a refused read, an end probe, 20 halvings and its read: 23 calls.
    const page = result?.kind === 'page' ? result.page : undefined;
    expect(page?.read.map(({ series }) => series)).toEqual(['MAIN_FUNDING']);
    expect(page?.owed?.map(({ series }) => series)).toEqual(
      expect.arrayContaining(['FUNDING_MAIN', 'MAIN_UMFUTURE']),
    );
    expect(fetchPage.mock.calls.length).toBeLessThanOrEqual(cap);
  });

  it('is a clean stop, with nothing owed, when the span is not entered: the first reads of every series do not fit', async () => {
    const fetchPage = keeping(SERVED_FROM);
    const run = {
      gate: freshRun().gate,
      budget: { canAfford: () => false, record: () => undefined },
    };

    expect(await readDeep({ run, fetchPage })).toBeUndefined();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('hands a rate limit of a probe to the caller and stops', async () => {
    const limited = new BinanceRateLimitError(429, 60_000);
    const onRateLimit = jest.fn();
    const fetchPage = jest.fn(async (_series: Series, span: typeof DEEP, _current: number) => {
      throw span.end - span.start > 1 ? new BinanceHistoryTooOldError('too old') : limited;
    });

    const result = await readDeep({ fetchPage, onRateLimit });

    expect(result).toBeUndefined();
    expect(onRateLimit).toHaveBeenCalledWith(limited);
  });

  it('rethrows a failure of a probe that is not the refusal', async () => {
    const fetchPage = jest.fn(async (_series: Series, span: typeof DEEP, _current: number) => {
      throw span.end - span.start > 1
        ? new BinanceHistoryTooOldError('too old')
        : new Error('boom');
    });

    await expect(readDeep({ fetchPage })).rejects.toThrow('boom');
  });

  it('rethrows the refusal when the lane has no depth to be refused at', async () => {
    const fetchPage = keeping(SERVED_FROM);

    await expect(readDeep({ fetchPage, depth: undefined })).rejects.toBeInstanceOf(
      BinanceHistoryTooOldError,
    );
  });

  /** The run with its budget watched: whether each call was asked and counted as narrowing. */
  const watchedRun = () => {
    const run = freshRun();
    const asked = jest.spyOn(run.budget, 'canAfford');
    const recorded = jest.spyOn(run.budget, 'record');

    return {
      run,
      askedNarrowing: () => asked.mock.calls.map(([, , , narrowing]) => narrowing === true),
      recordedNarrowing: () => recorded.mock.calls.map(([, , narrowing]) => narrowing === true),
    };
  };

  describe('the band a read begins above', () => {
    const SERVED_START = BASE + 2 * DAY_MS;
    const BAND = { start: SERVED_START, end: SERVED_START + DEPTH_MARGIN_MS };
    // A read of the span ends where the span does; a read of the band ends where the band does.
    const isBandRead = (span: typeof DEEP): boolean => span.end === BAND.end;

    /** Every series was served from `SERVED_START` just now: its read begins one margin above. */
    const servedJustNow = (): DepthGuard => {
      const depth = depthOf();

      for (const series of SERIES) {
        rememberServedStart(depth.memoryOf(series), { startMs: SERVED_START, servedAtMs: NOW });
      }

      return depth;
    };

    it('reads the band in the same span read, right after the series read, and joins its rows to those of the series, owing nothing', async () => {
      const fetchPage = jest.fn(async (_series: Series, span: typeof DEEP, _current: number) =>
        pageOf(1, 1, { rows: [{ id: isBandRead(span) ? 1 : 0 }] }),
      );

      const result = await readDeep({ fetchPage, depth: servedJustNow() });

      expect(fetchPage.mock.calls.map(([series, span]) => [series, span.start, span.end])).toEqual(
        SERIES.flatMap((series) => [
          [series, BAND.end, DEEP.end],
          [series, BAND.start, BAND.end],
        ]),
      );
      expect(result).toEqual({
        kind: 'page',
        page: {
          read: SERIES.map((series) => ({ series, rows: [{ id: 0 }, { id: 1 }], unreadable: [] })),
          drifted: [],
          owed: [],
        },
      });
    });

    it('owes the band in its series, and keeps the rows of the series read, when Binance refuses the band, and asks the band of no series after the one it refused', async () => {
      const run = freshRun();
      const record = jest.spyOn(run.budget, 'record');
      const fetchPage = jest.fn(async (_series: Series, span: typeof DEEP, _current: number) => {
        if (isBandRead(span)) {
          throw new BinanceHistoryTooOldError('too old');
        }

        return pageOf(1, 1);
      });

      const result = await readDeep({ run, fetchPage, depth: servedJustNow() });

      expect(fetchPage.mock.calls.filter(([, span]) => isBandRead(span))).toHaveLength(1);
      expect(fetchPage).toHaveBeenCalledTimes(SERIES.length + 1);
      expect(record).toHaveBeenCalledTimes(SERIES.length + 1);
      expect(result).toEqual({
        kind: 'page',
        page: {
          read: SERIES.map((series) => ({ series, rows: [{ id: 0 }], unreadable: [] })),
          drifted: [],
          owed: SERIES.map((series) => ({ series, window: BAND })),
        },
      });
    });

    it('owes the band, never reading it as read, when the weight reading refuses the call after the series read', async () => {
      const fetchPage = jest.fn(async (_series: Series, _span: typeof DEEP, _current: number) =>
        pageOf(1, 1, { usedIpWeight1m: IP_BUDGET_1M }),
      );

      const result = await readDeep({ fetchPage, depth: servedJustNow() });

      expect(fetchPage).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        kind: 'page',
        page: {
          read: [{ series: 'MAIN_FUNDING', rows: [{ id: 0 }] }],
          owed: expect.arrayContaining([{ series: 'MAIN_FUNDING', window: BAND }]),
        },
      });
    });

    it('hands a rate limit of the band read to the caller and leaves the span unread', async () => {
      const limited = new BinanceRateLimitError(429, 60_000);
      const onRateLimit = jest.fn();
      const fetchPage = jest.fn(async (_series: Series, span: typeof DEEP, _current: number) => {
        if (isBandRead(span)) {
          throw limited;
        }

        return pageOf(1, 1);
      });

      const result = await readDeep({ fetchPage, depth: servedJustNow(), onRateLimit });

      expect(result).toBeUndefined();
      expect(onRateLimit).toHaveBeenCalledWith(limited);
      expect(fetchPage).toHaveBeenCalledTimes(2);
    });

    it('rethrows a failure of the band read that is not the refusal', async () => {
      const fetchPage = jest.fn(async (_series: Series, span: typeof DEEP, _current: number) => {
        if (isBandRead(span)) {
          throw new Error('boom');
        }

        return pageOf(1, 1);
      });

      await expect(readDeep({ fetchPage, depth: servedJustNow() })).rejects.toThrow('boom');
    });

    it('counts the band read, and the reads after it, as narrowing calls, and the series read before it as not', async () => {
      const { run, askedNarrowing, recordedNarrowing } = watchedRun();
      const fetchPage = jest.fn(async () => pageOf(1, 1));

      await readDeep({ run, fetchPage, depth: servedJustNow() });

      expect(recordedNarrowing()).toEqual([false, true, true, true, true, true]);
      // The first ask is the entry of the span, the second the read of the first series.
      expect(askedNarrowing().slice(0, 3)).toEqual([false, false, true]);
    });

    it('pages the band by current, never splitting it, and joins every page', async () => {
      const fetchPage = jest.fn(async (_series: Series, span: typeof DEEP, current: number) => {
        if (!isBandRead(span)) {
          return pageOf(1, 1);
        }

        return current === 1
          ? pageOf(FULL_PAGE, 120, { rows: [{ id: 1 }] })
          : pageOf(20, 120, { rows: [{ id: 2 }] });
      });

      const result = await readDeep({
        fetchPage,
        depth: servedJustNow(),
        series: ['MAIN_FUNDING'],
      });

      expect(fetchPage.mock.calls.map(([, span, current]) => [isBandRead(span), current])).toEqual([
        [false, 1],
        [true, 1],
        [true, 2],
      ]);
      expect(result).toMatchObject({
        kind: 'page',
        page: { read: [{ rows: [{ id: 0 }, { id: 1 }, { id: 2 }] }], owed: [] },
      });
    });

    it('owes the band when its pages drift, and keeps the rows of the series read', async () => {
      const fetchPage = jest.fn(async (_series: Series, span: typeof DEEP, _current: number) =>
        isBandRead(span) ? pageOf(40, 90) : pageOf(1, 1),
      );

      const result = await readDeep({
        fetchPage,
        depth: servedJustNow(),
        series: ['MAIN_FUNDING'],
      });

      expect(result).toEqual({
        kind: 'page',
        page: {
          read: [{ series: 'MAIN_FUNDING', rows: [{ id: 0 }], unreadable: [] }],
          drifted: [],
          owed: [{ series: 'MAIN_FUNDING', window: BAND }],
        },
      });
    });

    it('carries the unreadable rows of the band with those of the series', async () => {
      const fetchPage = jest.fn(async (_series: Series, span: typeof DEEP, _current: number) =>
        isBandRead(span) ? pageOf(0, 1, { gathered: 1, unreadable: [{ time: 7 }] }) : pageOf(1, 1),
      );

      const result = await readDeep({
        fetchPage,
        depth: servedJustNow(),
        series: ['MAIN_FUNDING'],
      });

      expect(result).toMatchObject({
        page: { read: [{ rows: [{ id: 0 }], unreadable: [{ time: 7 }] }], owed: [] },
      });
    });

    it('reads no band of a series whose read is answered with the half of the span', async () => {
      const fetchPage = jest.fn(async () => pageOf(FULL_PAGE, 250));

      const result = await readDeep({ fetchPage, depth: servedJustNow() });

      expect(result).toMatchObject({ kind: 'split' });
      expect(fetchPage).toHaveBeenCalledTimes(1);
    });

    it('reads no band of a series that is read from the start it was served from', async () => {
      const depth = depthOf();
      rememberServedStart(depth.memoryOf('MAIN_FUNDING'), {
        startMs: SERVED_START,
        servedAtMs: NOW,
      });
      depth.memoryOf('MAIN_FUNDING').marginMs = 0;
      const fetchPage = jest.fn(async () => pageOf(1, 1));

      await readDeep({ fetchPage, depth, series: ['MAIN_FUNDING'] });

      expect(fetchPage).toHaveBeenCalledTimes(1);
    });
  });

  describe('the calls of a span read, narrowing or not', () => {
    it('counts every call of a span read in which a series was refused as a narrowing call, the refused read, the probes and the reads of the others', async () => {
      const { run, askedNarrowing, recordedNarrowing } = watchedRun();
      const fetchPage = keeping(SERVED_FROM);
      const depth = depthOf();
      // The last series is served from the start the first one found: it is not refused.
      rememberServedStart(depth.memoryOf('MAIN_UMFUTURE'), {
        startMs: SERVED_FROM,
        servedAtMs: NOW,
      });

      await readDeep({ run, fetchPage, depth });

      const made = fetchPage.mock.calls.length;
      expect(recordedNarrowing()).toEqual(Array.from({ length: made }, () => true));
      // Everything asked before the first refusal was asked as a call that is not narrowing yet.
      expect(askedNarrowing().filter(Boolean).length).toBeGreaterThanOrEqual(made - 1);
      expect(askedNarrowing()[0]).toBe(false);
    });

    it('counts no call of a span read in which no series was refused as a narrowing call', async () => {
      const { run, askedNarrowing, recordedNarrowing } = watchedRun();
      const fetchPage = keeping(DEEP.start);

      const result = await readDeep({ run, fetchPage });

      expect(result).toMatchObject({ kind: 'page', page: { drifted: [], owed: [] } });
      expect(fetchPage).toHaveBeenCalledTimes(SERIES.length);
      expect(recordedNarrowing()).toEqual(SERIES.map(() => false));
      expect(askedNarrowing().some(Boolean)).toBe(false);
    });

    it('counts the calls of a series with a bound the span lies above as narrowing calls from the first', async () => {
      const { run, askedNarrowing, recordedNarrowing } = watchedRun();
      const fetchPage = keeping(DEEP.end + 1);
      const depth = depthOf();
      depth.memoryOf('MAIN_FUNDING').startMs = DEEP.start;
      depth.memoryOf('MAIN_FUNDING').servedAtMs = undefined;

      await readDeep({ run, fetchPage, depth });

      // The first ask is the span's entry, made before any series is read.
      expect(askedNarrowing()[1]).toBe(true);
      expect(recordedNarrowing().every(Boolean)).toBe(true);
    });

    it('counts the calls of a series asked the end of the span, because another was refused it, as narrowing calls', async () => {
      const { run, recordedNarrowing } = watchedRun();
      const fetchPage = keeping(DEEP.end + 1);

      await readDeep({ run, fetchPage });

      // The first series' refused read and end are narrowing, and so are the others' ends.
      expect(recordedNarrowing()).toEqual(Array.from({ length: SERIES.length + 1 }, () => true));
    });

    it('counts the end a series asks of a span, because an earlier span refused another series that start, as a narrowing call from the first', async () => {
      const { run, recordedNarrowing } = watchedRun();
      const fetchPage = keeping(DEEP.end + 1);
      const depth = depthOf();
      rememberServedStart(depth.memoryOf('FUNDING_MAIN'), {
        startMs: DEEP.end,
        servedAtMs: undefined,
      });

      await readDeep({ run, fetchPage, depth, series: ['MAIN_FUNDING'] });

      expect(fetchPage).toHaveBeenCalledTimes(1);
      expect(recordedNarrowing()).toEqual([true]);
    });

    it('counts the calls of a series whose memory lapsed as narrowing calls', async () => {
      const { run, recordedNarrowing } = watchedRun();
      const fetchPage = keeping(SERVED_FROM);
      const depth = depthOf();
      rememberServedStart(depth.memoryOf('MAIN_FUNDING'), {
        startMs: SERVED_FROM,
        servedAtMs: NOW - DAY_MS,
      });

      await readDeep({ run, fetchPage, depth, series: ['MAIN_FUNDING'] });

      expect(recordedNarrowing().length).toBeGreaterThan(1);
      expect(recordedNarrowing().every(Boolean)).toBe(true);
    });

    it('starts the next span read as one that is not narrowing', async () => {
      const { run, recordedNarrowing } = watchedRun();
      const fetchPage = keeping(SERVED_FROM);
      const depth = depthOf();
      // A span above the start the first read found: it has no band to read.
      const above = { start: BASE + 6 * DAY_MS, end: DEEP.end };

      await readDeep({ run, fetchPage, depth });
      const first = recordedNarrowing().length;
      await readDeep({ run, fetchPage, depth, span: above });

      expect(recordedNarrowing().slice(first)).toEqual(SERIES.map(() => false));
    });

    it('keeps the lane cap whole when a span read narrows, so the reads that follow have all of it', async () => {
      const run = freshRun();
      const fetchPage = keeping(SERVED_FROM);

      await readDeep({ run, fetchPage });

      expect(run.budget.canAfford('transfer', COSTS.transfer, CAP - 1)).toBe(true);
    });

    it('spends the lane cap, never more, once the narrowing calls are spent', async () => {
      const run = freshRun();
      const fetchPage = keeping(SERVED_FROM);

      for (let call = 0; call < LANE_NARROWING_CALLS.transfer; call += 1) {
        run.budget.record(
          'transfer',
          { usedUidWeight1m: undefined, usedIpWeight1m: undefined },
          true,
        );
      }

      await readDeep({ run, fetchPage });

      expect(
        run.budget.canAfford('transfer', COSTS.transfer, CAP - fetchPage.mock.calls.length - 1),
      ).toBe(true);
      expect(
        run.budget.canAfford('transfer', COSTS.transfer, CAP - fetchPage.mock.calls.length),
      ).toBe(false);
    });

    it('leaves the span unread in the series after the weight reading refuses a narrowing call, never reading it as empty', async () => {
      const run = freshRun();
      const served = keeping(SERVED_FROM);
      // The read of the first series answers the weight of the minute at its ceiling.
      const fetchPage = jest.fn(async (series: Series, span: typeof DEEP, current: number) => {
        const page = await served(series, span, current);

        return span.end - span.start > 1 ? { ...page, usedIpWeight1m: IP_BUDGET_1M } : page;
      });

      const result = await readDeep({ run, fetchPage });

      expect(result).toMatchObject({
        kind: 'page',
        page: {
          read: [{ series: 'MAIN_FUNDING' }],
          owed: expect.arrayContaining([
            { series: 'FUNDING_MAIN', window: DEEP },
            { series: 'MAIN_UMFUTURE', window: DEEP },
          ]),
        },
      });
      expect(fetchPage.mock.calls.some(([series]) => series === 'FUNDING_MAIN')).toBe(false);
      expect(fetchPage.mock.calls.some(([series]) => series === 'MAIN_UMFUTURE')).toBe(false);
    });
  });
});

describe('readSeriesSpan, against a Binance whose depth moves with a clock the run gate advances', () => {
  const HOUR_MS = 3_600_000;

  describe.each([
    ['no latency', () => () => 0],
    ['150 ms of latency', () => () => 150],
    ['a latency of 0 to 300 ms', jitterMs],
  ])('with %s', (_name, latencyOf) => {
    it.each([1, 2, 3, 20])(
      'reads a span that crosses the depth to a page of all %i series, each from above the depth, refused once',
      async (count) => {
        const world = depthWorldOf({ latencyMs: latencyOf(), uncapped: true });

        const span = crossingOf(world.edgeOf('T0', world.clock.now));

        const result = await readDepthWorld(world, { count, span });

        expect(result).toMatchObject({ kind: 'page', page: { drifted: [] } });
        expect(result?.kind === 'page' ? result.page.read : []).toHaveLength(count);
        expect(refusedSpanReadsOf(world.calls, span)).toHaveLength(count);
        // The refused read, 23 requests of the narrowing, the read, and the band below it.
        expect(world.calls.length).toBeLessThanOrEqual(count * (1 + 23 + 1 + 1));
      },
    );
  });

  it('widens the margin of each series for a read that reaches Binance later than the request that found its start, until it is served', async () => {
    // A request that is not a probe takes 2.5 seconds to reach Binance.
    const world = depthWorldOf({ latencyMs: (read) => (isProbeRead(read) ? 0 : 2_500) });
    const span = crossingOf(world.edgeOf('T0', world.clock.now));

    const result = await readDepthWorld(world, { count: 3, span });

    expect(result).toMatchObject({ kind: 'page' });
    // The time the gate and the earlier series took since the start was found also moves a later
    // series on, so it needs a smaller margin than the first.
    for (const series of ['T0', 'T1', 'T2']) {
      expect(
        refusedSpanReadsOf(world.calls, span).filter((call) => call.series === series).length,
      ).toBe(series === 'T0' ? 3 : 2);
      expect(world.depth.memoryOf(series).marginMs).toBe(series === 'T0' ? 4_000 : 2_000);
    }
  });

  it('begins each series from its start moved on by the wait of the gate, though the wait takes hours', async () => {
    const suspensions: { atWait: number; ms: number }[] = [];
    const world = depthWorldOf({ latencyMs: () => 0, suspensions, uncapped: true });
    const span = crossingOf(world.edgeOf('T0', world.clock.now));
    await readDepthWorld(world, { count: 2, span });
    const firstCalls = world.calls.length;
    suspensions.push({ atWait: firstCalls + 1, ms: HOUR_MS });

    const result = await readDepthWorld(world, { count: 2, span });

    expect(result).toMatchObject({ kind: 'page', page: { drifted: [] } });
    expect(refusedSpanReadsOf(world.calls, span)).toHaveLength(2);
    expect(skippedMsOf(world.calls.slice(firstCalls))[0]).toBeLessThanOrEqual(
      DEPTH_RESOLUTION_MS + DEPTH_MARGIN_MS + BINANCE_REQUEST_INTERVAL_MS,
    );
  });

  it('never asks a read for a start at or past the end of the span, when the gate wait carries the clock past it', async () => {
    const world = depthWorldOf({ latencyMs: () => 0, suspensions: [{ atWait: 1, ms: HOUR_MS }] });
    const span = crossingOf(world.edgeOf('T0', world.clock.now));
    rememberServedStart(world.depth.memoryOf('T0'), {
      startMs: span.end - 5_000,
      servedAtMs: world.clock.now,
    });

    const result = await readDepthWorld(world, { span });

    expect(result).toMatchObject({ kind: 'page', page: { drifted: [] } });
    const reads = world.calls.filter(({ read }) => !isProbeRead(read));
    expect(reads).toHaveLength(2);
    expect(reads[0]?.read.start).toBeGreaterThanOrEqual(span.end - 5_000);
    expect(reads[0]?.read.start).toBeLessThan(span.end);
    // The band below that read is read right after it, from the start the memory held.
    expect(reads[1]?.read).toEqual({ start: span.end - 5_000, end: reads[0]?.read.start });
  });

  it('remembers the start with the clock at the moment the request that served it was sent, after the gate', async () => {
    const world = depthWorldOf({ latencyMs: () => 0 });

    await readDepthWorld(world);

    const served = world.calls.filter(({ read, refused }) => isProbeRead(read) && !refused);
    const lastServed = served[served.length - 1];
    expect(world.depth.memoryOf('T0').startMs).toBe(lastServed?.read.start);
    expect(world.depth.memoryOf('T0').servedAtMs).toBe(lastServed?.sentAtMs);
  });

  it('reads a span read again a day later from a start found between the one it held and the one moved on by that day, with no refusal', async () => {
    const world = depthWorldOf({ latencyMs: () => 0 });
    const span = crossingOf(world.edgeOf('T0', world.clock.now));
    await readDepthWorld(world, { span });
    const firstStart = world.depth.memoryOf('T0').startMs ?? 0;
    world.calls.length = 0;
    world.clock.now += DAY_MS;

    await readDepthWorld(world, { span });

    const probes = world.calls.filter(({ read }) => isProbeRead(read));
    expect(refusedSpanReadsOf(world.calls, span)).toHaveLength(0);
    expect(probes.length).toBe(1 + Math.ceil(Math.log2(DAY_MS / DEPTH_RESOLUTION_MS)));
    expect(world.calls.at(-1)?.read.start).toBeGreaterThanOrEqual(firstStart + DAY_MS);
  });
});
