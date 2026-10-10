import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';

import {
  BinanceWalkStop,
  btcSatoshis,
  buildWalkWindows,
  logWalkNotice,
  logWalkStop,
  planWalkPasses,
  rescanCursorAfter,
  resolveWalkStart,
  resolveWalletHoldings,
  runWalkPlan,
  type WalkWindow,
} from './binance.history-walk';
import { EARN_KEY, FUNDING_KEY, SPOT_KEY } from './binance.holding-keys';

const WINDOW_MS = 89 * DAY_MS;
const FLOOR_MS = Date.UTC(2017, 6, 14);

describe('resolveWalkStart', () => {
  const END_MS = Date.UTC(2026, 9, 10);
  const input = { floorMs: FLOOR_MS, endTime: END_MS, windowMs: WINDOW_MS, overlapMs: DAY_MS };

  it('starts at the floor when the walk has no cursor yet', () => {
    expect(resolveWalkStart({ ...input, cursor: null })).toBe(FLOOR_MS);
  });

  it('never starts before the floor, even for a cursor reset to an older floor', () => {
    const payFloor = Date.UTC(2025, 3, 11);

    expect(resolveWalkStart({ ...input, floorMs: payFloor, cursor: FLOOR_MS })).toBe(payFloor);
  });

  it('starts the overlap behind a cursor that is recent', () => {
    const cursor = END_MS - 100 * DAY_MS;

    expect(resolveWalkStart({ ...input, cursor })).toBe(cursor - DAY_MS);
  });

  it('re-scans at least the last window when the cursor is nearly caught up', () => {
    const cursor = END_MS - 60_000;

    expect(resolveWalkStart({ ...input, cursor })).toBe(END_MS - WINDOW_MS);
  });
});

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

  it('starts the forward pass the overlap behind the cursor, however recent the cursor is', () => {
    const cursor = END_MS - 2 * DAY_MS;
    const plan = planWalkPasses({ ...input, cursor });

    expect(plan.forward).toEqual([{ start: cursor - DAY_MS, end: END_MS }]);
  });

  it('re-scans the last window behind the forward pass, ending where the forward pass starts', () => {
    const cursor = END_MS - 2 * DAY_MS;
    const plan = planWalkPasses({ ...input, cursor });

    expect(plan.rescan).toEqual([{ start: END_MS - WINDOW_MS, end: cursor - DAY_MS }]);
    expect(plan.rescanEnd).toBe(cursor - DAY_MS);
  });

  it('resumes the re-scan from its stored cursor', () => {
    const cursor = END_MS - 2 * DAY_MS;
    const rescanCursor = END_MS - 40 * DAY_MS;
    const plan = planWalkPasses({ ...input, cursor, rescanCursor });

    expect(plan.rescan).toEqual([{ start: rescanCursor, end: cursor - DAY_MS }]);
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
    const plan = planWalkPasses({ ...input, cursor, rescanCursor: cursor - DAY_MS });

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

describe('logWalkNotice', () => {
  it('logs only its own fixed tag and the notice code', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    logWalkNotice('pay-overlap-skip');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[binance sync] history row left out', {
      name: 'BinanceWalkNotice',
      code: 'pay-overlap-skip',
    });
    warn.mockRestore();
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
