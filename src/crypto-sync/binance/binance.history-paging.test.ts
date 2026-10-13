import { DAY_MS } from '@kiko/dates';

import type { TotalPage, UnreadableRow } from './binance.history-client';
import { fetchAllByTotal, readSeriesSpan } from './binance.history-paging';
import { BinanceHistoryTooOldError, BinanceRateLimitError } from './binance.client';
import { COSTS, createBinanceHistoryRun, LANE_CALL_CAPS } from './binance.history-budget';
import { DEPTH_RESOLUTION_MS, type DepthGuard, MAX_DEPTH_REFUSALS } from './binance.history-depth';

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
    fetchPage: (current: number) => Promise<TotalPage<Row>>;
  },
) =>
  fetchAllByTotal<Row>({
    run: freshRun(),
    lane: 'transfer',
    cost: COSTS.transfer,
    keep: 0,
    half: HALF,
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

    const result = await pagingOf({ fetchPage, half: undefined });

    expect(requested).toEqual([1, 2, 3]);
    expect(result).toEqual({
      kind: 'rows',
      rows: [...pageOf(FULL_PAGE, 250).rows, { id: 100 }, { id: 200 }],
      unreadable: [],
    });
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

    expect(await pagingOf({ fetchPage, half: undefined })).toEqual({ kind: 'drift' });
  });

  it('is a drift when the pages allowed leave the rows counted short of the total', async () => {
    const { fetchPage, requested } = scripted(
      Array.from({ length: 5 }, () => pageOf(FULL_PAGE, 1_000)),
    );

    const result = await pagingOf({ fetchPage, half: undefined, maxPages: 3 });

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

    const result = await pagingOf({ fetchPage, half: undefined });

    expect(result).toMatchObject({ kind: 'rows', unreadable: [{ time: 1 }, { time: 2 }] });
  });

  it('gives up with nothing when the next page is unaffordable, before any request of it', async () => {
    const { fetchPage, requested } = scripted([pageOf(FULL_PAGE, 250), pageOf(FULL_PAGE, 250)]);

    const result = await pagingOf({ fetchPage, half: undefined, keep: CAP - 1 });

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

    await pagingOf({ run, fetchPage, half: undefined });

    // Two calls are spent: a read that keeps CAP - 2 calls has none left for itself.
    expect(run.budget.canAfford('transfer', COSTS.transfer, CAP - 3)).toBe(true);
    expect(run.budget.canAfford('transfer', COSTS.transfer, CAP - 2)).toBe(false);
  });

  it('passes every request through the pacing gate first', async () => {
    const run = freshRun();
    const wait = jest.spyOn(run.gate, 'wait');
    const { fetchPage } = scripted([pageOf(FULL_PAGE, 150), pageOf(50, 150)]);

    await pagingOf({ run, fetchPage, half: undefined });

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
    floorMs: () => BASE - DAY_MS,
    memory: { startMs: undefined },
    ...over,
  });

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

  it('reads every series from the start Binance serves, the one refusal behind it, and keeps the memory of it', async () => {
    const fetchPage = keeping(SERVED_FROM);
    const depth = depthOf();

    const result = await readDeep({ fetchPage, depth });

    const realReads = fetchPage.mock.calls.filter(([, span]) => span.end - span.start > 1);
    const found = depth.memory.startMs ?? 0;
    expect(found).toBeGreaterThanOrEqual(SERVED_FROM);
    expect(found - SERVED_FROM).toBeLessThan(DEPTH_RESOLUTION_MS);
    expect(realReads.map(([series, span]) => [series, span.start, span.end])).toEqual([
      ['MAIN_FUNDING', DEEP.start, DEEP.end],
      ...SERIES.map((series) => [series, found, DEEP.end]),
    ]);
    expect(result).toEqual({
      kind: 'page',
      page: {
        read: SERIES.map((series) => ({ series, rows: [{ id: 0 }], unreadable: [] })),
        drifted: [],
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
      ([series, span]) => series === 'MAIN_FUNDING' && span.end - span.start > 1,
    );
    expect(firstReads).toHaveLength(1);
    expect(result).toMatchObject({
      page: {
        read: SERIES.map((series) => ({ series, rows: [{ id: SERIES.indexOf(series) }] })),
      },
    });
  });

  it('reads a span whose end Binance refuses as empty, with no series read after the refusal, and no later span asks the refused ground', async () => {
    const fetchPage = keeping(DEEP.end + 1);
    const depth = depthOf();

    const result = await readDeep({ fetchPage, depth });

    expect(result).toEqual({ kind: 'page', page: { read: [], drifted: [] } });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(depth.memory.startMs).toBe(DEEP.end);

    fetchPage.mockClear();
    await readDeep({ fetchPage, depth, span: { start: DEEP.start - DAY_MS, end: DEEP.end } });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('starts a span from the start already known to be served, with no request for the ground below it', async () => {
    const fetchPage = keeping(0);
    const depth = depthOf({ memory: { startMs: DEEP.start + 2 * DAY_MS } });

    await readDeep({ fetchPage, depth });

    expect(new Set(startsOf(fetchPage))).toEqual(new Set([DEEP.start + 2 * DAY_MS]));
  });

  it('asks nothing of a span that ends at or before the start already known to be served', async () => {
    const fetchPage = keeping(0);

    const result = await readDeep({
      fetchPage,
      depth: depthOf({ memory: { startMs: DEEP.end } }),
    });

    expect(result).toEqual({ kind: 'page', page: { read: [], drifted: [] } });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('reads a refused span that ends at or before the floor of now as empty, after the one refused request', async () => {
    const fetchPage = keeping(DEEP.end + DAY_MS);

    const result = await readDeep({ fetchPage, depth: depthOf({ floorMs: () => DEEP.end }) });

    expect(result).toEqual({ kind: 'page', page: { read: [], drifted: [] } });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('answers the half of the span that starts where the span does, when the read from the served start comes back full', async () => {
    const fetchPage = keeping(SERVED_FROM, () => pageOf(FULL_PAGE, 250));
    const depth = depthOf();

    const result = await readDeep({ fetchPage, depth });

    const found = depth.memory.startMs ?? 0;
    expect(result).toEqual({
      kind: 'split',
      half: { start: DEEP.start, end: found + Math.floor((DEEP.end - found) / 2) },
    });
  });

  it('is a clean stop, with the span unread, once a read is refused more than MAX_DEPTH_REFUSALS times', async () => {
    // Every start is served as a probe (one millisecond), and every read is refused.
    const fetchPage = jest.fn(async (_series: Series, span: typeof DEEP, _current: number) => {
      if (span.end - span.start > 1) {
        throw new BinanceHistoryTooOldError('too old');
      }

      return pageOf(0, 0);
    });

    const result = await readDeep({ fetchPage });

    expect(result).toBeUndefined();
    expect(fetchPage.mock.calls.filter(([, span]) => span.end - span.start > 1)).toHaveLength(
      MAX_DEPTH_REFUSALS + 1,
    );
  });

  it('spends a call of the lane on every request it makes, a refused one too, each after the shared gate', async () => {
    const run = freshRun();
    const wait = jest.spyOn(run.gate, 'wait');
    const fetchPage = keeping(SERVED_FROM);

    await readDeep({ run, fetchPage });

    const made = fetchPage.mock.calls.length;
    expect(run.budget.canAfford('transfer', COSTS.transfer, CAP - made - 1)).toBe(true);
    expect(run.budget.canAfford('transfer', COSTS.transfer, CAP - made)).toBe(false);
    expect(wait).toHaveBeenCalledTimes(made);
  });

  it('is a clean stop, with no request made, when the budget cannot afford the next one while it narrows', async () => {
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

    expect(result).toBeUndefined();
    expect(fetchPage).toHaveBeenCalledTimes(3);
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
});
