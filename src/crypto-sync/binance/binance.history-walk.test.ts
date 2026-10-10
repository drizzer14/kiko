import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';

import {
  advanceWalkMarks,
  BinanceWalkStop,
  btcSatoshis,
  buildWalkWindows,
  halfOf,
  logWalkStop,
  nextSpanAfter,
  planWalkPasses,
  rescanCursorAfter,
  resolveWalletHoldings,
  runWalkPlan,
  type SpanRead,
  splitOrStop,
  type WalkMarks,
  walkSpans,
  type WalkWindow,
} from './binance.history-walk';
import { EARN_KEY, FUNDING_KEY, SPOT_KEY } from './binance.holding-keys';

const WINDOW_MS = 89 * DAY_MS;
const FLOOR_MS = Date.UTC(2017, 6, 14);

describe('planWalkPasses', () => {
  const END_MS = Date.UTC(2026, 9, 10);
  const input = {
    floorMs: FLOOR_MS,
    endTime: END_MS,
    windowMs: WINDOW_MS,
    overlapMs: DAY_MS,
    maxWindows: 12,
    rescanCursor: null,
  };

  it('walks the whole history forward from the floor when the walk has no cursor, with no re-scan', () => {
    const plan = planWalkPasses({ ...input, maxWindows: 80, cursor: null });

    expect(plan.forward[0].start).toBe(FLOOR_MS);
    expect(plan.forward.at(-1)?.end).toBe(END_MS);
    expect(plan.rescan).toEqual([]);
  });

  it('starts the forward pass AT a cursor inside the re-scan window, which covers the overlap', () => {
    const cursor = END_MS - 2 * DAY_MS;
    const plan = planWalkPasses({ ...input, cursor });

    expect(plan.forward).toEqual([{ start: cursor, end: END_MS }]);
  });

  it('starts the forward pass AT a cursor on the first millisecond of the re-scan window', () => {
    const cursor = END_MS - WINDOW_MS;
    const plan = planWalkPasses({ ...input, cursor });

    expect(plan.forward[0].start).toBe(cursor);
    expect(plan.rescan).toEqual([]);
  });

  it('starts the forward pass the overlap behind a cursor one millisecond before the re-scan window', () => {
    const cursor = END_MS - WINDOW_MS - 1;
    const plan = planWalkPasses({ ...input, cursor });

    expect(plan.forward[0].start).toBe(cursor - DAY_MS);
    expect(plan.rescan).toEqual([]);
  });

  it('re-scans the last window behind the forward pass, ending where the forward pass starts', () => {
    const cursor = END_MS - 2 * DAY_MS;
    const plan = planWalkPasses({ ...input, cursor });

    expect(plan.rescan).toEqual([{ start: END_MS - WINDOW_MS, end: cursor }]);
    expect(plan.rescanEnd).toBe(cursor);
  });

  it('resumes the re-scan from its stored cursor', () => {
    const cursor = END_MS - 2 * DAY_MS;
    const rescanCursor = END_MS - 40 * DAY_MS;
    const plan = planWalkPasses({ ...input, cursor, rescanCursor });

    expect(plan.rescan).toEqual([{ start: rescanCursor, end: cursor }]);
  });

  it.each([
    ['a cursor reset to the floor', FLOOR_MS],
    ['a cursor older than the window', END_MS - 120 * DAY_MS],
  ])('restarts the re-scan at the window start for %s', (_label, rescanCursor) => {
    const plan = planWalkPasses({ ...input, cursor: END_MS - 2 * DAY_MS, rescanCursor });

    expect(plan.rescan[0].start).toBe(END_MS - WINDOW_MS);
  });

  it('restarts the re-scan at the window start for a cursor already at or past the forward start', () => {
    const cursor = END_MS - 2 * DAY_MS;
    const plan = planWalkPasses({ ...input, cursor, rescanCursor: cursor });

    expect(plan.rescan[0].start).toBe(END_MS - WINDOW_MS);
  });

  it('has no re-scan when the forward pass already reaches back past the window start', () => {
    const cursor = END_MS - 120 * DAY_MS;
    const plan = planWalkPasses({ ...input, cursor });

    expect(plan.forward[0].start).toBe(cursor - DAY_MS);
    expect(plan.rescan).toEqual([]);
  });

  it('never starts either pass before the floor', () => {
    const floorMs = END_MS - 30 * DAY_MS;
    const plan = planWalkPasses({
      ...input,
      floorMs,
      cursor: END_MS - 2 * DAY_MS,
      rescanCursor: FLOOR_MS,
    });

    expect(plan.rescan[0].start).toBe(floorMs);
  });

  it('never reaches past the end for a cursor ahead of it', () => {
    const plan = planWalkPasses({ ...input, cursor: END_MS + 5 * DAY_MS });

    expect(plan.forward).toEqual([]);
    expect(plan.rescanEnd).toBe(END_MS);
  });
});

describe('rescanCursorAfter', () => {
  const plan = {
    forward: [],
    rescan: [],
    rescanEnd: 1_000,
  };

  it('is the span end while the re-scan has ground left', () => {
    expect(rescanCursorAfter({ span: { start: 100, end: 400 }, plan, restartMs: 5 })).toBe(400);
  });

  it('is the restart mark once the span reaches the end of the re-scan', () => {
    expect(rescanCursorAfter({ span: { start: 400, end: 1_000 }, plan, restartMs: 5 })).toBe(5);
  });
});

describe('runWalkPlan', () => {
  const window = (start: number): WalkWindow => ({ start, end: start + 1 });
  const plan = { forward: [window(0), window(1)], rescan: [window(10)], rescanEnd: 11 };

  it('runs the forward windows, then the re-scan windows, and adds up what they import', async () => {
    const seen: [number, string][] = [];

    const result = await runWalkPlan({
      plan,
      canAfford: () => true,
      runWindow: async (span, pass) => {
        seen.push([span.start, pass]);

        return { imported: 2, complete: true };
      },
    });

    expect(seen).toEqual([
      [0, 'forward'],
      [1, 'forward'],
      [10, 'rescan'],
    ]);
    expect(result).toEqual({ imported: 6, complete: true });
  });

  it('leaves the re-scan alone when a forward window does not complete', async () => {
    const runWindow = jest.fn(async () => ({ imported: 1, complete: false }));

    const result = await runWalkPlan({ plan, canAfford: () => true, runWindow });

    expect(runWindow).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ imported: 1, complete: false });
  });

  it('runs the re-scan on what budget the forward pass left, and reports it incomplete when it runs out', async () => {
    let calls = 3;
    const runWindow = jest.fn(async () => ({ imported: 0, complete: true }));

    const result = await runWalkPlan({
      plan: { ...plan, rescan: [window(10), window(11)] },
      canAfford: () => {
        calls -= 1;

        return calls >= 0;
      },
      runWindow,
    });

    expect(runWindow).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ imported: 0, complete: false });
  });

  it('never starts a window the budget cannot afford', async () => {
    const runWindow = jest.fn(async () => ({ imported: 0, complete: true }));

    const result = await runWalkPlan({ plan, canAfford: () => false, runWindow });

    expect(runWindow).not.toHaveBeenCalled();
    expect(result).toEqual({ imported: 0, complete: false });
  });

  it('is complete when the plan has nothing to walk', async () => {
    const result = await runWalkPlan({
      plan: { forward: [], rescan: [], rescanEnd: 0 },
      canAfford: () => true,
      runWindow: async () => ({ imported: 0, complete: true }),
    });

    expect(result).toEqual({ imported: 0, complete: true });
  });
});

describe('buildWalkWindows', () => {
  it('splits the span into contiguous windows, the last one ending at the end', () => {
    const windows = buildWalkWindows(0, 250, 100, 80);

    expect(windows).toEqual([
      { start: 0, end: 100 },
      { start: 100, end: 200 },
      { start: 200, end: 250 },
    ]);
  });

  it('honors the window cap', () => {
    expect(buildWalkWindows(0, 1_000, 100, 4)).toHaveLength(4);
  });

  it('returns no window for an empty span', () => {
    expect(buildWalkWindows(500, 500, 100, 80)).toEqual([]);
    expect(buildWalkWindows(600, 500, 100, 80)).toEqual([]);
  });
});

describe('btcSatoshis', () => {
  it('converts a decimal string and a number to satoshis', () => {
    expect(btcSatoshis('0.001')).toBe(100_000);
    expect(btcSatoshis(0.5)).toBe(50_000_000);
  });

  it.each([
    ['a word', 'x'],
    ['an empty string', ''],
    ['a blank string', '   '],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['an Infinity string', 'Infinity'],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
  ])('gives null for %s', (_label, amount) => {
    expect(btcSatoshis(amount)).toBeNull();
  });
});

describe('BinanceWalkStop', () => {
  it('carries its fixed tag as the error name and its own code', () => {
    const stop = new BinanceWalkStop('capital-wallet-unknown');

    expect(stop).toBeInstanceOf(Error);
    expect(stop).toBeInstanceOf(BinanceWalkStop);
    expect(stop.name).toBe('BinanceWalkStop');
    expect(stop.code).toBe('capital-wallet-unknown');
    expect(Object.hasOwn(stop, 'code')).toBe(true);
  });
});

describe('logWalkStop', () => {
  it('logs only the fixed tag and the stop code', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    logWalkStop('capital-amount-invalid');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[binance sync] history window stopped', {
      name: 'BinanceWalkStop',
      code: 'capital-amount-invalid',
    });
    warn.mockRestore();
  });
});

describe('halfOf', () => {
  it('is the first half of a span, rounded down', () => {
    expect(halfOf({ start: 100, end: 110 })).toEqual({ start: 100, end: 105 });
    expect(halfOf({ start: 100, end: 103 })).toEqual({ start: 100, end: 101 });
  });

  it('is nothing for a span of one millisecond, which cannot be split', () => {
    expect(halfOf({ start: 100, end: 101 })).toBeUndefined();
  });

  it('never gives a half whose start equals its end', () => {
    const half = halfOf({ start: 100, end: 102 });

    expect(half).toEqual({ start: 100, end: 101 });
  });
});

describe('nextSpanAfter', () => {
  const window = { start: 0, end: 100 };

  it('starts where the committed span ended and is twice as wide', () => {
    expect(nextSpanAfter({ start: 0, end: 10 }, window)).toEqual({ start: 10, end: 30 });
  });

  it('never reaches past the window', () => {
    expect(nextSpanAfter({ start: 40, end: 70 }, window)).toEqual({ start: 70, end: 100 });
  });
});

describe('advanceWalkMarks', () => {
  const plan = { forward: [], rescan: [], rescanEnd: 1_000 };
  const RESTART_MS = 5;

  const FORWARD_FIELD = 'binancePayHistoryCursor';
  const RESCAN_FIELD = 'binancePayRescanCursor';

  const advance = async (pass: 'forward' | 'rescan', span: WalkWindow, marks: WalkMarks) => {
    const writes: [string, number][] = [];

    await advanceWalkMarks({
      pass,
      span,
      plan,
      marks,
      restartMs: RESTART_MS,
      fields: { cursor: FORWARD_FIELD, rescan: RESCAN_FIELD },
      write: async (field, cursorMs) => {
        writes.push([field, cursorMs]);
      },
    });

    return writes;
  };

  it('moves the cursor to the end of a forward span', async () => {
    const marks = { cursor: 100, rescanCursor: null };

    expect(await advance('forward', { start: 100, end: 400 }, marks)).toEqual([
      [FORWARD_FIELD, 400],
    ]);
    expect(marks.cursor).toBe(400);
  });

  it('starts the cursor at the span end when the walk has none', async () => {
    const marks = { cursor: null, rescanCursor: null };

    expect(await advance('forward', { start: 100, end: 400 }, marks)).toEqual([
      [FORWARD_FIELD, 400],
    ]);
  });

  it('never moves the cursor back: a forward span behind it rewrites the cursor it has', async () => {
    const marks = { cursor: 900, rescanCursor: null };

    expect(await advance('forward', { start: 100, end: 400 }, marks)).toEqual([
      [FORWARD_FIELD, 900],
    ]);
    expect(marks.cursor).toBe(900);
  });

  it('moves only the re-scan mark for a re-scan span with ground left', async () => {
    const marks = { cursor: 900, rescanCursor: null };

    expect(await advance('rescan', { start: 100, end: 400 }, marks)).toEqual([[RESCAN_FIELD, 400]]);
    expect(marks).toEqual({ cursor: 900, rescanCursor: 400 });
  });

  it('writes the restart mark once a re-scan span reaches the end of the re-scan', async () => {
    const marks = { cursor: 900, rescanCursor: 400 };

    expect(await advance('rescan', { start: 400, end: 1_000 }, marks)).toEqual([
      [RESCAN_FIELD, RESTART_MS],
    ]);
    expect(marks.rescanCursor).toBe(RESTART_MS);
  });

  it('writes nothing for a finished re-scan that was never started', async () => {
    const marks = { cursor: 900, rescanCursor: null };

    expect(await advance('rescan', { start: 100, end: 1_000 }, marks)).toEqual([]);
    expect(marks.rescanCursor).toBeNull();
  });

  it('writes nothing for a finished re-scan whose stored mark already is the restart mark', async () => {
    const marks = { cursor: 900, rescanCursor: RESTART_MS };

    expect(await advance('rescan', { start: 100, end: 1_000 }, marks)).toEqual([]);
  });
});

describe('splitOrStop', () => {
  it('is the first half of a span as the span to read instead', () => {
    expect(splitOrStop({ start: 100, end: 110 }, 'test-page-stuck')).toEqual({
      kind: 'split',
      half: { start: 100, end: 105 },
    });
  });

  it('logs the stuck code and gives nothing for a span of one millisecond, which cannot be split', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(splitOrStop({ start: 100, end: 101 }, 'test-page-stuck')).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[binance sync] history window stopped', {
      name: 'BinanceWalkStop',
      code: 'test-page-stuck',
    });
    warn.mockRestore();
  });
});

describe('walkSpans', () => {
  const window = { start: 0, end: 100 };
  const WIDEST_PAGE = 25;

  /** A read that finds any span wider than a page too full, and a page of the span otherwise. */
  const readByWidth = () =>
    jest.fn(
      async (span: WalkWindow): Promise<SpanRead<WalkWindow> | undefined> =>
        span.end - span.start > WIDEST_PAGE
          ? splitOrStop(span, 'test-page-stuck')
          : { kind: 'page', page: span },
    );

  const commitCount = (count: number, committed: WalkWindow[] = []) =>
    jest.fn(async (span: WalkWindow, _page: WalkWindow): Promise<number | undefined> => {
      committed.push(span);

      return count;
    });

  it('halves a span the read finds too full, then reads on from where the commit ended, twice as wide', async () => {
    const read = readByWidth();

    await walkSpans({ window, read, commit: commitCount(1) });

    expect(read.mock.calls.slice(0, 4).map(([span]) => span)).toEqual([
      { start: 0, end: 100 },
      { start: 0, end: 50 },
      { start: 0, end: 25 },
      { start: 25, end: 75 },
    ]);
  });

  it('commits the spans oldest first, each once, until the window is covered', async () => {
    const committed: WalkWindow[] = [];

    const result = await walkSpans({
      window,
      read: readByWidth(),
      commit: commitCount(2, committed),
    });

    expect(committed).toEqual([
      { start: 0, end: 25 },
      { start: 25, end: 50 },
      { start: 50, end: 75 },
      { start: 75, end: 100 },
    ]);
    expect(result).toEqual({ imported: 8, complete: true });
  });

  it('hands the commit the page the read gave for that span', async () => {
    const commit = jest.fn(async (_span: WalkWindow, _page: string) => 0);

    await walkSpans({
      window: { start: 0, end: 10 },
      read: async () => ({ kind: 'page', page: 'the page' }),
      commit,
    });

    expect(commit).toHaveBeenCalledWith({ start: 0, end: 10 }, 'the page');
  });

  it('stops without committing the span when the read gives up, keeping what committed', async () => {
    const committed: WalkWindow[] = [];
    const half = { start: 0, end: 50 };
    const reads = [
      { kind: 'split' as const, half },
      { kind: 'page' as const, page: half },
      undefined,
    ];
    const read = jest.fn(async () => reads.shift());

    const result = await walkSpans({ window, read, commit: commitCount(3, committed) });

    expect(read).toHaveBeenCalledTimes(3);
    expect(committed).toEqual([half]);
    expect(result).toEqual({ imported: 3, complete: false });
  });

  it('stops, reading no further span, when the commit gives up', async () => {
    const read = readByWidth();
    const commit = jest.fn(async () => undefined);

    const result = await walkSpans({ window, read, commit });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ imported: 0, complete: false });
  });

  it('stops a span of one millisecond that is still too full, committing nothing', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const commit = commitCount(1);

    const result = await walkSpans({
      window: { start: 100, end: 101 },
      read: async (span) => splitOrStop(span, 'test-page-stuck'),
      commit,
    });

    expect(commit).not.toHaveBeenCalled();
    expect(result).toEqual({ imported: 0, complete: false });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('is complete, reading nothing, for a window with no width', async () => {
    const read = readByWidth();

    const result = await walkSpans({ window: { start: 5, end: 5 }, read, commit: commitCount(1) });

    expect(read).not.toHaveBeenCalled();
    expect(result).toEqual({ imported: 0, complete: true });
  });
});

describe('resolveWalletHoldings', () => {
  const holdingOf = (key: string): HoldingRow =>
    ({ id: `h-${key}`, metadata: { binanceAsset: key } }) as unknown as HoldingRow;

  it('creates a missing wallet holding at zero, then lists again and returns it', async () => {
    let stored = [holdingOf(SPOT_KEY)];
    const listHoldings = jest.fn(async (_accountId: string) => stored);
    const ensureHoldings = jest.fn(async (_holdings: unknown[]) => {
      stored = [holdingOf(SPOT_KEY), holdingOf(FUNDING_KEY)];
    });

    const resolved = await resolveWalletHoldings({
      accountId: 'acc-1',
      keys: [SPOT_KEY, FUNDING_KEY],
      listHoldings,
      ensureHoldings,
    });

    expect(ensureHoldings).toHaveBeenCalledTimes(1);
    expect(ensureHoldings).toHaveBeenCalledWith([
      {
        accountId: 'acc-1',
        name: 'Binance Funding',
        type: 'crypto_asset',
        currency: 'BTC',
        balanceMinorUnits: 0,
        metadataField: 'binanceAsset',
        metadataKey: FUNDING_KEY,
      },
    ]);
    expect(listHoldings).toHaveBeenCalledTimes(2);
    expect(listHoldings).toHaveBeenCalledWith('acc-1');
    expect(resolved.get(FUNDING_KEY)?.id).toBe('h-BTC:funding');
    expect(resolved.get(SPOT_KEY)?.id).toBe('h-BTC');
  });

  it('writes nothing when every wanted holding exists', async () => {
    const listHoldings = jest.fn(async (_accountId: string) => [
      holdingOf(SPOT_KEY),
      holdingOf(EARN_KEY),
    ]);
    const ensureHoldings = jest.fn(async (_holdings: unknown[]) => undefined);

    const resolved = await resolveWalletHoldings({
      accountId: 'acc-1',
      keys: [EARN_KEY],
      listHoldings,
      ensureHoldings,
    });

    expect(ensureHoldings).not.toHaveBeenCalled();
    expect(listHoldings).toHaveBeenCalledTimes(1);
    expect([...resolved.keys()]).toEqual([EARN_KEY]);
  });

  it('asks only for the keys that are missing, each with its own name', async () => {
    const listHoldings = jest.fn(async (_accountId: string) => [holdingOf(SPOT_KEY)]);
    const ensureHoldings = jest.fn(async (_holdings: unknown[]) => undefined);

    await resolveWalletHoldings({
      accountId: 'acc-1',
      keys: [SPOT_KEY, FUNDING_KEY, EARN_KEY],
      listHoldings,
      ensureHoldings,
    });

    const created = ensureHoldings.mock.calls[0][0] as { name: string; metadataKey: string }[];
    expect(created.map((holding) => [holding.metadataKey, holding.name])).toEqual([
      [FUNDING_KEY, 'Binance Funding'],
      [EARN_KEY, 'Binance Earn'],
    ]);
  });

  it('creates only the missing keys named in createKeys and still returns the existing ones', async () => {
    const listHoldings = jest.fn(async (_accountId: string) => [holdingOf(SPOT_KEY)]);
    const ensureHoldings = jest.fn(async (_holdings: unknown[]) => undefined);

    const resolved = await resolveWalletHoldings({
      accountId: 'acc-1',
      keys: [SPOT_KEY, FUNDING_KEY, EARN_KEY],
      createKeys: [EARN_KEY],
      listHoldings,
      ensureHoldings,
    });

    const created = ensureHoldings.mock.calls[0][0] as { metadataKey: string }[];
    expect(created.map((holding) => holding.metadataKey)).toEqual([EARN_KEY]);
    expect([...resolved.keys()]).toEqual([SPOT_KEY]);
  });

  it('writes nothing when createKeys is empty', async () => {
    const listHoldings = jest.fn(async (_accountId: string) => [holdingOf(SPOT_KEY)]);
    const ensureHoldings = jest.fn(async (_holdings: unknown[]) => undefined);

    await resolveWalletHoldings({
      accountId: 'acc-1',
      keys: [FUNDING_KEY],
      createKeys: [],
      listHoldings,
      ensureHoldings,
    });

    expect(ensureHoldings).not.toHaveBeenCalled();
    expect(listHoldings).toHaveBeenCalledTimes(1);
  });

  it('leaves a key out of the result when the holding is still absent after the write', async () => {
    const listHoldings = jest.fn(async (_accountId: string) => [holdingOf(SPOT_KEY)]);
    const ensureHoldings = jest.fn(async (_holdings: unknown[]) => undefined);

    const resolved = await resolveWalletHoldings({
      accountId: 'acc-1',
      keys: [FUNDING_KEY],
      listHoldings,
      ensureHoldings,
    });

    expect(resolved.has(FUNDING_KEY)).toBe(false);
  });
});
