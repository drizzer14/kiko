import { DAY_MS } from '@kiko/dates';
import {
  createDepthMemories,
  type DepthGuard,
  rememberServedStart,
} from '@kiko/crypto-sync/exchange/walk';
import { readSeriesSpan } from '@kiko/crypto-sync/exchange/paging';

import { BINANCE_WALK_CONFIG } from './binance.walk-config';
import { COSTS, createBinanceHistoryRun } from './binance.history-budget';
import { BINANCE_DEPTH_CONFIG, DEPTH_MARGIN_MS } from './binance.depth-config';
import { BinanceHistoryTooOldError, BinanceRateLimitError } from './binance.client';

const NOW = 1_704_326_400_000;
const BASE = 1_700_000_000_000;
const SPAN = { start: BASE, end: BASE + 10 * DAY_MS };
const ONE_MS_SPAN = { start: BASE, end: BASE + 1 };
const SERVED_START = BASE + 2 * DAY_MS;
const BAND = { start: SERVED_START, end: SERVED_START + DEPTH_MARGIN_MS };
const FULL_PAGE = 100;

const pageOf = (count: number, total: number) => ({
  rows: Array.from({ length: count }, (_unused, id) => ({ id })),
  unreadable: [],
  untracked: [],
  gathered: count,
  total,
  usedUidWeight1m: undefined,
  usedIpWeight1m: undefined,
});

const depthOf = (): DepthGuard => ({
  isRefusal: (error) => error instanceof BinanceHistoryTooOldError,
  nowMs: () => NOW,
  floorMs: () => BASE - DAY_MS,
  ...createDepthMemories(() => NOW, BINANCE_DEPTH_CONFIG),
});

/** The series was served from `SERVED_START` just now: its read begins one margin above. */
const servedJustNow = (): DepthGuard => {
  const depth = depthOf();

  rememberServedStart(depth.memoryOf('T0'), { startMs: SERVED_START, servedAtMs: NOW });

  return depth;
};

type Span = typeof SPAN;

/** A read of one series of a span, with the budget watched, over a `fetchPage` that may reject. */
const readWatched = (input: {
  fetchPage: (span: Span, current: number) => Promise<ReturnType<typeof pageOf>>;
  span?: Span;
  depth?: DepthGuard;
  onRateLimit?: (error: BinanceRateLimitError) => void;
}) => {
  const run = createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined });
  const record = jest.spyOn(run.budget, 'record');
  const fetchPage = jest.fn(async (_series: string, span: Span, current: number) =>
    input.fetchPage(span, current),
  );
  const result = readSeriesSpan({
    run,
    config: BINANCE_WALK_CONFIG,
    lane: 'transfer',
    cost: COSTS.transfer,
    span: input.span ?? SPAN,
    keep: 0,
    series: ['T0'],
    maxPages: 50,
    fetchPage,
    onRateLimit: input.onRateLimit ?? jest.fn(),
    depth: input.depth,
  });

  return { result, record, fetchPage };
};

describe('readSeriesSpan, with a request that rejects', () => {
  it('counts the first page of a series as a call, and rethrows its error', async () => {
    const failure = new Error('boom');
    const { result, record, fetchPage } = readWatched({
      fetchPage: async () => {
        throw failure;
      },
    });

    await expect(result).rejects.toBe(failure);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('counts the page that rejects after a page that was served, each once', async () => {
    const failure = new Error('boom');
    const { result, record, fetchPage } = readWatched({
      span: ONE_MS_SPAN,
      fetchPage: async (_span, current) => {
        if (current === 2) {
          throw failure;
        }

        return pageOf(FULL_PAGE, 300);
      },
    });

    await expect(result).rejects.toBe(failure);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('counts the request of a rate limit, and hands the limit to the caller', async () => {
    const limited = new BinanceRateLimitError(429, 60_000);
    const onRateLimit = jest.fn();
    const { result, record, fetchPage } = readWatched({
      onRateLimit,
      fetchPage: async () => {
        throw limited;
      },
    });

    await expect(result).resolves.toBeUndefined();
    expect(onRateLimit).toHaveBeenCalledWith(limited);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('counts a read of a series on a lane with a depth, and rethrows its error', async () => {
    const failure = new Error('boom');
    const { result, record, fetchPage } = readWatched({
      depth: depthOf(),
      fetchPage: async () => {
        throw failure;
      },
    });

    await expect(result).rejects.toBe(failure);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('counts a probe of the narrowing, and the refused read before it, each once', async () => {
    const failure = new Error('boom');
    const { result, record, fetchPage } = readWatched({
      depth: depthOf(),
      fetchPage: async (span) => {
        throw span.end - span.start > 1 ? new BinanceHistoryTooOldError('too old') : failure;
      },
    });

    await expect(result).rejects.toBe(failure);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('counts the read of the band a series began above, and the series read before it, each once', async () => {
    const failure = new Error('boom');
    const { result, record, fetchPage } = readWatched({
      depth: servedJustNow(),
      fetchPage: async (span) => {
        if (span.end === BAND.end) {
          throw failure;
        }

        return pageOf(1, 1);
      },
    });

    await expect(result).rejects.toBe(failure);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('counts the refusal of a band once, and owes the band', async () => {
    const { result, record, fetchPage } = readWatched({
      depth: servedJustNow(),
      fetchPage: async (span) => {
        if (span.end === BAND.end) {
          throw new BinanceHistoryTooOldError('too old');
        }

        return pageOf(1, 1);
      },
    });

    await expect(result).resolves.toMatchObject({
      kind: 'page',
      page: { owed: [{ series: 'T0', window: BAND }] },
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledTimes(2);
  });
});
