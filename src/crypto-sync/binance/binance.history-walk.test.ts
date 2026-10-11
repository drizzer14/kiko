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
  readPendingMark,
  rescanCursorAfter,
  resolveWalletHoldings,
  runWalkPlan,
  type SpanRead,
  splitOrStop,
  type WalkMarks,
  walkSpans,
  type WalkPass,
  type WalkPlan,
  type WalkWindow,
  type WindowOutcome,
  withoutRead,
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
    pending: [],
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
    expect(plan.rescan).toEqual([{ start: cursor - DAY_MS, end: cursor }]);
  });

  it('starts the forward pass AT a cursor one millisecond before the re-scan window', () => {
    const cursor = END_MS - WINDOW_MS - 1;
    const plan = planWalkPasses({ ...input, cursor });

    expect(plan.forward[0].start).toBe(cursor);
    expect(plan.rescan).toEqual([{ start: cursor - DAY_MS, end: cursor }]);
  });

  it('re-scans the overlap day behind a cursor older than the window, and starts forward at the cursor', () => {
    const cursor = END_MS - 120 * DAY_MS;
    const plan = planWalkPasses({ ...input, cursor });

    expect(plan.forward[0].start).toBe(cursor);
    expect(plan.rescan).toEqual([{ start: cursor - DAY_MS, end: cursor }]);
    expect(plan.rescanEnd).toBe(cursor);
  });

  it('re-scans the whole overlap day behind a cursor that the window start cuts into', () => {
    const cursor = END_MS - 88.5 * DAY_MS;
    const plan = planWalkPasses({ ...input, cursor });

    expect(plan.forward[0].start).toBe(cursor);
    expect(plan.rescan).toEqual([{ start: cursor - DAY_MS, end: cursor }]);
  });

  it('re-scans the last window behind the forward pass, ending where the forward pass starts', () => {
    const cursor = END_MS - 2 * DAY_MS;
    const plan = planWalkPasses({ ...input, cursor });

    expect(plan.rescan).toEqual([{ start: END_MS - WINDOW_MS, end: cursor }]);
    expect(plan.rescanEnd).toBe(cursor);
  });

  it('restarts the re-scan at the window start for a cursor reset to the floor', () => {
    const plan = planWalkPasses({
      ...input,
      cursor: END_MS - 2 * DAY_MS,
      rescanCursor: FLOOR_MS,
    });

    expect(plan.rescan[0].start).toBe(END_MS - WINDOW_MS);
  });

  it.each([
    ['a mark the window just outran', END_MS - WINDOW_MS - DAY_MS],
    ['a mark an old cursor left behind', END_MS - 120 * DAY_MS],
    ['a mark more than a window behind the window start', END_MS - 2 * WINDOW_MS - 1],
  ])(
    'starts a new pass at the window start for %s, whatever the distance',
    (_label, rescanCursor) => {
      const cursor = END_MS - 2 * DAY_MS;
      const plan = planWalkPasses({ ...input, cursor, rescanCursor });

      expect(plan.rescan).toEqual([{ start: END_MS - WINDOW_MS, end: cursor }]);
      expect(plan.rescanEnd).toBe(cursor);
    },
  );

  it('resumes a stored cursor at or after the re-scan start up to the forward start', () => {
    const cursor = END_MS - 2 * DAY_MS;
    const rescanCursor = END_MS - 40 * DAY_MS;
    const plan = planWalkPasses({ ...input, cursor, rescanCursor });

    expect(plan.rescan).toEqual([{ start: rescanCursor, end: cursor }]);
    expect(plan.rescanEnd).toBe(cursor);
  });

  it('does not take the floor itself for a stored re-scan cursor, since a finished pass is reset to it', () => {
    const plan = planWalkPasses({
      ...input,
      floorMs: FLOOR_MS,
      cursor: END_MS - 2 * DAY_MS,
      rescanCursor: FLOOR_MS,
    });

    expect(plan.rescan[0].start).toBe(END_MS - WINDOW_MS);
  });

  describe('the pending overlap ranges', () => {
    const cursor = END_MS - 2 * DAY_MS;
    const day = { start: cursor - DAY_MS, end: cursor };

    it('adds the overlap day behind the forward start, for a cursor inside the window too', () => {
      expect(planWalkPasses({ ...input, cursor, pending: [] }).pendingRanges).toEqual([day]);
    });

    it('adds the overlap day behind a cursor older than the window', () => {
      const stale = END_MS - 120 * DAY_MS;

      expect(planWalkPasses({ ...input, cursor: stale, pending: [] }).pendingRanges).toEqual([
        { start: stale - DAY_MS, end: stale },
      ]);
    });

    it.each([
      ['no cursor', null],
      ['a cursor at the floor', FLOOR_MS],
    ])('adds no day for %s', (_label, noCursor) => {
      expect(planWalkPasses({ ...input, cursor: noCursor, pending: [] }).pendingRanges).toEqual([]);
    });

    it('keeps the stored ranges beside the new day, oldest first', () => {
      const stored = { start: END_MS - 150 * DAY_MS, end: END_MS - 149 * DAY_MS };

      expect(planWalkPasses({ ...input, cursor, pending: [stored] }).pendingRanges).toEqual([
        stored,
        day,
      ]);
    });

    it('merges the new day into a stored range it overlaps or touches', () => {
      const stored = { start: cursor - 3 * DAY_MS, end: cursor - DAY_MS / 2 };

      expect(planWalkPasses({ ...input, cursor, pending: [stored] }).pendingRanges).toEqual([
        { start: stored.start, end: cursor },
      ]);
      expect(
        planWalkPasses({
          ...input,
          cursor,
          pending: [{ start: cursor - 3 * DAY_MS, end: cursor - DAY_MS }],
        }).pendingRanges,
      ).toEqual([{ start: cursor - 3 * DAY_MS, end: cursor }]);
    });

    it('drops a stored range the floor has passed, and cuts one the floor crosses', () => {
      const floorMs = END_MS - 100 * DAY_MS;
      const passed = { start: floorMs - 3 * DAY_MS, end: floorMs };
      const crossed = { start: floorMs - DAY_MS, end: floorMs + DAY_MS };

      const plan = planWalkPasses({ ...input, floorMs, cursor, pending: [passed, crossed] });

      expect(plan.pendingRanges).toEqual([{ start: floorMs, end: floorMs + DAY_MS }, day]);
    });

    it('keeps a stored range that lies right after the floor', () => {
      const floorMs = END_MS - 100 * DAY_MS;
      const stored = { start: floorMs, end: floorMs + DAY_MS };

      expect(
        planWalkPasses({ ...input, floorMs, cursor, pending: [stored] }).pendingRanges,
      ).toEqual([stored, day]);
    });

    it('cuts a stored range off at the end of the walk', () => {
      const ahead = { start: END_MS - DAY_MS, end: END_MS + 5 * DAY_MS };

      expect(
        planWalkPasses({ ...input, cursor: END_MS, pending: [ahead] }).pendingRanges.at(-1),
      ).toEqual({ start: END_MS - DAY_MS, end: END_MS });
    });

    it('never holds more than twelve ranges: the two nearest merge, so no ground is lost', () => {
      const stored = Array.from({ length: 12 }, (_unused, index) => ({
        start: END_MS - 170 * DAY_MS + index * 10 * DAY_MS,
        end: END_MS - 170 * DAY_MS + index * 10 * DAY_MS + DAY_MS,
      }));

      const { pendingRanges } = planWalkPasses({ ...input, cursor, pending: stored });

      expect(pendingRanges).toHaveLength(12);
      expect(pendingRanges[0].start).toBe(stored[0].start);
      expect(pendingRanges.at(-1)).toEqual(day);
      expect(
        stored.every((range) =>
          pendingRanges.some((merged) => merged.start <= range.start && merged.end >= range.end),
        ),
      ).toBe(true);
    });

    it('leaves a stored range the re-scan covers to the re-scan, and reads no window for it', () => {
      const inside = { start: END_MS - 30 * DAY_MS, end: END_MS - 29 * DAY_MS };

      const plan = planWalkPasses({ ...input, cursor, pending: [inside] });

      expect(plan.pending).toEqual([]);
    });

    it('reads a stored range outside the re-scan as its own window, oldest first', () => {
      const older = { start: END_MS - 170 * DAY_MS, end: END_MS - 169 * DAY_MS };
      const old = { start: END_MS - 140 * DAY_MS, end: END_MS - 139 * DAY_MS };

      const plan = planWalkPasses({ ...input, cursor, pending: [old, older] });

      expect(plan.pending).toEqual([older, old]);
    });

    it('reads a range longer than a window in windows', () => {
      const long = {
        start: END_MS - 300 * DAY_MS,
        end: END_MS - 300 * DAY_MS + WINDOW_MS + DAY_MS,
      };

      expect(planWalkPasses({ ...input, cursor, pending: [long] }).pending).toEqual([
        { start: long.start, end: long.start + WINDOW_MS },
        { start: long.start + WINDOW_MS, end: long.end },
      ]);
    });

    it('reads the ground of a range that lies before a resumed re-scan mark as its own window', () => {
      const rescanCursor = END_MS - 40 * DAY_MS;
      const behindMark = { start: END_MS - 60 * DAY_MS, end: END_MS - 59 * DAY_MS };

      const plan = planWalkPasses({ ...input, cursor, rescanCursor, pending: [behindMark] });

      expect(plan.pending).toEqual([behindMark]);
    });

    it('reads the overlap day of a stale cursor as the re-scan, not twice', () => {
      const stale = END_MS - 120 * DAY_MS;

      const plan = planWalkPasses({ ...input, cursor: stale, pending: [] });

      expect(plan.rescan).toEqual([{ start: stale - DAY_MS, end: stale }]);
      expect(plan.pending).toEqual([]);
    });
  });

  it('restarts the re-scan at the window start for a cursor already at or past the forward start', () => {
    const cursor = END_MS - 2 * DAY_MS;
    const plan = planWalkPasses({ ...input, cursor, rescanCursor: cursor });

    expect(plan.rescan[0].start).toBe(END_MS - WINDOW_MS);
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

const planOf = (over: Partial<WalkPlan> = {}): WalkPlan => ({
  forward: [],
  pending: [],
  rescan: [],
  rescanEnd: 0,
  pendingRanges: [],
  ...over,
});

describe('rescanCursorAfter', () => {
  const plan = planOf({ rescanEnd: 1_000 });

  it('is the span end while the re-scan has ground left', () => {
    expect(rescanCursorAfter({ span: { start: 100, end: 400 }, plan, restartMs: 5 })).toBe(400);
  });

  it('is the restart mark once the span reaches the end of the re-scan', () => {
    expect(rescanCursorAfter({ span: { start: 400, end: 1_000 }, plan, restartMs: 5 })).toBe(5);
  });
});

describe('runWalkPlan', () => {
  const window = (start: number): WalkWindow => ({ start, end: start + 1 });
  const owedWindow = (start: number): WalkWindow => ({ start, end: start + 10 });
  const plan = planOf({
    forward: [window(0), window(1)],
    pending: [owedWindow(5), owedWindow(20)],
    rescan: [window(10)],
    rescanEnd: 11,
  });
  const ran = (imported: number, complete: boolean, stopped: WalkWindow[] = []): WindowOutcome => ({
    imported,
    complete,
    stopped,
  });

  it('runs the forward windows, then the pending windows oldest first, then the re-scan windows, and adds up what they import', async () => {
    const seen: [number, string][] = [];

    const result = await runWalkPlan({
      plan,
      canAfford: () => true,
      runWindow: async (span, pass) => {
        seen.push([span.start, pass]);

        return ran(2, true);
      },
    });

    expect(seen).toEqual([
      [0, 'forward'],
      [1, 'forward'],
      [5, 'pending'],
      [20, 'pending'],
      [10, 'rescan'],
    ]);
    expect(result).toEqual({ imported: 10, complete: true });
  });

  it('goes on to the next pending window and the re-scan when a pending window does not complete', async () => {
    const seen: [number, string][] = [];

    const result = await runWalkPlan({
      plan,
      canAfford: () => true,
      runWindow: async (span, pass) => {
        seen.push([span.start, pass]);

        return ran(1, span.start !== 5);
      },
    });

    expect(seen.slice(2)).toEqual([
      [5, 'pending'],
      [20, 'pending'],
      [10, 'rescan'],
    ]);
    expect(result).toEqual({ imported: 5, complete: false });
  });

  it('stops at a re-scan window that does not complete', async () => {
    const runWindow = jest.fn(async (_span: WalkWindow, pass: string) => ran(0, pass !== 'rescan'));

    const result = await runWalkPlan({
      plan: { ...plan, rescan: [window(10), window(11)] },
      canAfford: () => true,
      runWindow,
    });

    expect(runWindow).toHaveBeenCalledTimes(5);
    expect(result).toEqual({ imported: 0, complete: false });
  });

  it('starts no further window once the budget cannot afford one, between pending windows too', async () => {
    let calls = 1;
    const runWindow = jest.fn(async () => ran(0, false));

    const result = await runWalkPlan({
      plan: { ...plan, forward: [] },
      canAfford: () => {
        calls -= 1;

        return calls >= 0;
      },
      runWindow,
    });

    expect(runWindow).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ imported: 0, complete: false });
  });

  it('leaves the re-scan alone when a forward window does not complete', async () => {
    const runWindow = jest.fn(async () => ran(1, false));

    const result = await runWalkPlan({ plan, canAfford: () => true, runWindow });

    expect(runWindow).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ imported: 1, complete: false });
  });

  it('runs the re-scan on what budget the forward pass left, and reports it incomplete when it runs out', async () => {
    let calls = 3;
    const runWindow = jest.fn(async () => ran(0, true));

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
    const runWindow = jest.fn(async () => ran(0, true));

    const result = await runWalkPlan({ plan, canAfford: () => false, runWindow });

    expect(runWindow).not.toHaveBeenCalled();
    expect(result).toEqual({ imported: 0, complete: false });
  });

  it('is complete when the plan has nothing to walk', async () => {
    const result = await runWalkPlan({
      plan: planOf(),
      canAfford: () => true,
      runWindow: async () => ran(0, true),
    });

    expect(result).toEqual({ imported: 0, complete: true });
  });

  describe('isolating a stop in an owed range', () => {
    const owed = { start: 0, end: 100 };
    const STUCK_AT = 37;
    const isolationPlan = planOf({
      pending: [owed],
      rescan: [{ start: 200, end: 300 }],
      rescanEnd: 300,
    });
    const holdsStuck = (span: WalkWindow): boolean => span.start <= STUCK_AT && STUCK_AT < span.end;

    /** A walk whose pending spans holding the stuck record stop, as the pending pass reports. */
    const stuckWalk = (seen: [WalkWindow, WalkPass][] = []) =>
      jest.fn(async (span: WalkWindow, pass: WalkPass) => {
        seen.push([span, pass]);

        return pass === 'pending' && holdsStuck(span) ? ran(0, false, [span]) : ran(1, true);
      });

    it('halves a span that stopped, oldest part first, and reads the parts as pending windows', async () => {
      const seen: [WalkWindow, WalkPass][] = [];

      await runWalkPlan({
        plan: isolationPlan,
        canAfford: () => true,
        runWindow: stuckWalk(seen),
      });

      expect(seen.slice(0, 5)).toEqual([
        [{ start: 0, end: 100 }, 'pending'],
        [{ start: 0, end: 50 }, 'pending'],
        [{ start: 50, end: 100 }, 'pending'],
        [{ start: 0, end: 25 }, 'pending'],
        [{ start: 25, end: 50 }, 'pending'],
      ]);
    });

    it('reads at most four parts of stopped spans in a run, halving a part that stopped again a level down', async () => {
      const seen: [WalkWindow, WalkPass][] = [];

      await runWalkPlan({
        plan: isolationPlan,
        canAfford: () => true,
        runWindow: stuckWalk(seen),
      });

      const pending = seen.filter(([, pass]) => pass === 'pending').map(([span]) => span);
      expect(pending).toEqual([
        { start: 0, end: 100 },
        { start: 0, end: 50 },
        { start: 50, end: 100 },
        { start: 0, end: 25 },
        { start: 25, end: 50 },
      ]);
    });

    it('goes on to the re-scan once the isolation reads of the run are spent, and reports the run incomplete', async () => {
      const seen: [WalkWindow, WalkPass][] = [];

      const result = await runWalkPlan({
        plan: isolationPlan,
        canAfford: () => true,
        runWindow: stuckWalk(seen),
      });

      expect(seen.at(-1)).toEqual([{ start: 200, end: 300 }, 'rescan']);
      expect(result.complete).toBe(false);
    });

    it('reads every owed window once before it isolates a stop in any of them', async () => {
      const seen: [WalkWindow, WalkPass][] = [];

      await runWalkPlan({
        plan: planOf({ pending: [owed, { start: 500, end: 600 }] }),
        canAfford: () => true,
        runWindow: stuckWalk(seen),
      });

      expect(seen.slice(0, 3)).toEqual([
        [{ start: 0, end: 100 }, 'pending'],
        [{ start: 500, end: 600 }, 'pending'],
        [{ start: 0, end: 50 }, 'pending'],
      ]);
    });

    it('adds up what the isolated parts import', async () => {
      const result = await runWalkPlan({
        plan: planOf({ pending: [owed] }),
        canAfford: () => true,
        runWindow: stuckWalk(),
      });

      expect(result.imported).toBe(2);
    });

    it('leaves a stopped span of one millisecond alone: it cannot be halved', async () => {
      const runWindow = jest.fn(async (span: WalkWindow) => ran(0, false, [span]));

      const result = await runWalkPlan({
        plan: planOf({ pending: [{ start: 37, end: 38 }] }),
        canAfford: () => true,
        runWindow,
      });

      expect(runWindow).toHaveBeenCalledTimes(1);
      expect(result.complete).toBe(false);
    });

    it('reads no part the budget cannot afford, and goes no further', async () => {
      let calls = 3;
      const runWindow = stuckWalk();

      const result = await runWalkPlan({
        plan: isolationPlan,
        canAfford: () => {
          calls -= 1;

          return calls >= 0;
        },
        runWindow,
      });

      expect(runWindow).toHaveBeenCalledTimes(3);
      expect(result.complete).toBe(false);
    });

    it('does not isolate a stop in the forward pass or the re-scan: they end the run', async () => {
      const runWindow = jest.fn(async (span: WalkWindow) => ran(0, false, [span]));

      await runWalkPlan({
        plan: planOf({ forward: [{ start: 0, end: 100 }] }),
        canAfford: () => true,
        runWindow,
      });

      expect(runWindow).toHaveBeenCalledTimes(1);
    });
  });

  describe('with an owed span that cannot be halved', () => {
    const isolated = (start: number): WalkWindow => ({ start, end: start + 1 });
    const stuckAtOne = (span: WalkWindow): boolean => span.end - span.start === 1;

    /** A walk whose one-millisecond owed spans stop, and whose other windows commit. */
    const isolatedStuckWalk = (seen: [WalkWindow, WalkPass][] = []) =>
      jest.fn(async (span: WalkWindow, pass: WalkPass) => {
        seen.push([span, pass]);

        return pass === 'pending' && stuckAtOne(span) ? ran(0, false, [span]) : ran(1, true);
      });

    it('reads it after the re-scan, behind the owed windows that are not stuck', async () => {
      const seen: [WalkWindow, WalkPass][] = [];

      await runWalkPlan({
        plan: planOf({
          pending: [isolated(5), owedWindow(20)],
          rescan: [{ start: 200, end: 300 }],
          rescanEnd: 300,
        }),
        canAfford: () => true,
        runWindow: isolatedStuckWalk(seen),
      });

      expect(seen).toEqual([
        [owedWindow(20), 'pending'],
        [{ start: 200, end: 300 }, 'rescan'],
        [isolated(5), 'pending'],
      ]);
    });

    it('reads the spans of a run in the order: forward, owed windows, isolation halves, re-scan, isolated spans', async () => {
      const seen: [WalkWindow, WalkPass][] = [];
      const stuckAt = (span: WalkWindow): boolean => span.start <= 37 && 37 < span.end;

      await runWalkPlan({
        plan: planOf({
          forward: [{ start: 1_000, end: 1_100 }],
          pending: [{ start: 0, end: 100 }, isolated(500), { start: 600, end: 700 }],
          rescan: [{ start: 200, end: 300 }],
          rescanEnd: 300,
        }),
        canAfford: () => true,
        runWindow: jest.fn(async (span: WalkWindow, pass: WalkPass) => {
          seen.push([span, pass]);

          return pass === 'pending' && (stuckAt(span) || stuckAtOne(span))
            ? ran(0, false, [span])
            : ran(1, true);
        }),
      });

      expect(seen).toEqual([
        [{ start: 1_000, end: 1_100 }, 'forward'],
        [{ start: 0, end: 100 }, 'pending'],
        [{ start: 600, end: 700 }, 'pending'],
        [{ start: 0, end: 50 }, 'pending'],
        [{ start: 50, end: 100 }, 'pending'],
        [{ start: 0, end: 25 }, 'pending'],
        [{ start: 25, end: 50 }, 'pending'],
        [{ start: 200, end: 300 }, 'rescan'],
        [isolated(500), 'pending'],
      ]);
    });

    it('goes on to the next isolated span after one that stopped, and reports the run incomplete', async () => {
      const seen: [WalkWindow, WalkPass][] = [];

      const result = await runWalkPlan({
        plan: planOf({ pending: [isolated(5), isolated(9)] }),
        canAfford: () => true,
        runWindow: isolatedStuckWalk(seen),
      });

      expect(seen).toEqual([
        [isolated(5), 'pending'],
        [isolated(9), 'pending'],
      ]);
      expect(result).toEqual({ imported: 0, complete: false });
    });

    it('reads no isolated span once the re-scan has used the budget, and reports the run incomplete', async () => {
      let calls = 1;
      const seen: [WalkWindow, WalkPass][] = [];

      const result = await runWalkPlan({
        plan: planOf({
          pending: [isolated(5)],
          rescan: [{ start: 200, end: 300 }],
          rescanEnd: 300,
        }),
        canAfford: () => {
          calls -= 1;

          return calls >= 0;
        },
        runWindow: isolatedStuckWalk(seen),
      });

      expect(seen).toEqual([[{ start: 200, end: 300 }, 'rescan']]);
      expect(result.complete).toBe(false);
    });

    it('imports an isolated span that has become readable and reports the run complete', async () => {
      const result = await runWalkPlan({
        plan: planOf({ pending: [isolated(5)] }),
        canAfford: () => true,
        runWindow: async () => ran(1, true),
      });

      expect(result).toEqual({ imported: 1, complete: true });
    });

    it('still reads the isolated spans after a re-scan window that stopped', async () => {
      const seen: [WalkWindow, WalkPass][] = [];

      await runWalkPlan({
        plan: planOf({
          pending: [isolated(5)],
          rescan: [{ start: 200, end: 300 }],
          rescanEnd: 300,
        }),
        canAfford: () => true,
        runWindow: jest.fn(async (span: WalkWindow, pass: WalkPass) => {
          seen.push([span, pass]);

          return ran(0, pass !== 'rescan');
        }),
      });

      expect(seen.at(-1)).toEqual([isolated(5), 'pending']);
    });
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
  const plan = planOf({ rescanEnd: 1_000 });
  const RESTART_MS = 5;

  const FORWARD_FIELD = 'binancePayHistoryCursor';
  const RESCAN_FIELD = 'binancePayRescanCursor';
  const PENDING_FIELD = 'binancePayPendingOverlap';

  type Write = [string, number | WalkWindow[]];

  const markOf = (over: Partial<WalkMarks> = {}): WalkMarks => ({
    cursor: null,
    rescanCursor: null,
    pending: [],
    ...over,
  });

  const advance = async (
    pass: WalkPass,
    span: WalkWindow,
    marks: WalkMarks,
    walkPlan: WalkPlan = plan,
  ) => {
    const writes: Write[] = [];

    await advanceWalkMarks({
      pass,
      span,
      plan: walkPlan,
      marks,
      restartMs: RESTART_MS,
      fields: { cursor: FORWARD_FIELD, rescan: RESCAN_FIELD, pending: PENDING_FIELD },
      write: async (field, cursorMs) => {
        writes.push([field, cursorMs]);
      },
      writePending: async (field, ranges) => {
        writes.push([field, ranges]);
      },
    });

    return writes;
  };

  it('moves the cursor to the end of a forward span', async () => {
    const marks = markOf({ cursor: 100 });

    expect(await advance('forward', { start: 100, end: 400 }, marks)).toEqual([
      [FORWARD_FIELD, 400],
    ]);
    expect(marks.cursor).toBe(400);
  });

  it('starts the cursor at the span end when the walk has none', async () => {
    const marks = markOf();

    expect(await advance('forward', { start: 100, end: 400 }, marks)).toEqual([
      [FORWARD_FIELD, 400],
    ]);
  });

  it('never moves the cursor back: a forward span behind it rewrites the cursor it has', async () => {
    const marks = markOf({ cursor: 900 });

    expect(await advance('forward', { start: 100, end: 400 }, marks)).toEqual([
      [FORWARD_FIELD, 900],
    ]);
    expect(marks.cursor).toBe(900);
  });

  it('moves only the re-scan mark for a re-scan span with ground left', async () => {
    const marks = markOf({ cursor: 900 });

    expect(await advance('rescan', { start: 100, end: 400 }, marks)).toEqual([[RESCAN_FIELD, 400]]);
    expect(marks).toEqual({ cursor: 900, rescanCursor: 400, pending: [] });
  });

  it('writes the restart mark once a re-scan span reaches the end of the re-scan', async () => {
    const marks = markOf({ cursor: 900, rescanCursor: 400 });

    expect(await advance('rescan', { start: 400, end: 1_000 }, marks)).toEqual([
      [RESCAN_FIELD, RESTART_MS],
    ]);
    expect(marks.rescanCursor).toBe(RESTART_MS);
  });

  it('writes nothing for a finished re-scan that was never started', async () => {
    const marks = markOf({ cursor: 900 });

    expect(await advance('rescan', { start: 100, end: 1_000 }, marks)).toEqual([]);
    expect(marks.rescanCursor).toBeNull();
  });

  it('writes nothing for a finished re-scan whose stored mark already is the restart mark', async () => {
    const marks = markOf({ cursor: 900, rescanCursor: RESTART_MS });

    expect(await advance('rescan', { start: 100, end: 1_000 }, marks)).toEqual([]);
  });

  describe('with pending overlap ranges', () => {
    const day = { start: 70, end: 100 };
    const planned = planOf({ rescanEnd: 1_000, pendingRanges: [day] });

    it('stores the list before it moves the cursor, so a crash between the two loses nothing', async () => {
      const marks = markOf({ cursor: 100 });

      expect(await advance('forward', { start: 100, end: 400 }, marks, planned)).toEqual([
        [PENDING_FIELD, [day]],
        [FORWARD_FIELD, 400],
      ]);
      expect(marks).toEqual({ cursor: 400, rescanCursor: null, pending: [day] });
    });

    it('stores the list once: the next forward span moves only the cursor', async () => {
      const marks = markOf({ cursor: 100 });
      await advance('forward', { start: 100, end: 400 }, marks, planned);

      expect(await advance('forward', { start: 400, end: 700 }, marks, planned)).toEqual([
        [FORWARD_FIELD, 700],
      ]);
    });

    it('stores nothing when the stored list already is the planned one', async () => {
      const marks = markOf({ cursor: 100, pending: [day] });

      expect(await advance('forward', { start: 100, end: 400 }, marks, planned)).toEqual([
        [FORWARD_FIELD, 400],
      ]);
    });

    it('takes the read ground out of the list when a re-scan span commits, after the mark', async () => {
      const marks = markOf({ cursor: 900, rescanCursor: 50, pending: [day] });

      expect(await advance('rescan', { start: 50, end: 85 }, marks, planned)).toEqual([
        [RESCAN_FIELD, 85],
        [PENDING_FIELD, [{ start: 85, end: 100 }]],
      ]);
      expect(marks.pending).toEqual([{ start: 85, end: 100 }]);
    });

    it('drops a range a re-scan span reads whole', async () => {
      const marks = markOf({ cursor: 900, rescanCursor: 85, pending: [{ start: 85, end: 100 }] });

      expect(await advance('rescan', { start: 85, end: 1_000 }, marks, planned)).toEqual([
        [RESCAN_FIELD, RESTART_MS],
        [PENDING_FIELD, []],
      ]);
    });

    it('takes the ground a pending span reads out of the list and moves no mark', async () => {
      const marks = markOf({ cursor: 900, pending: [day] });

      expect(await advance('pending', { start: 70, end: 90 }, marks, planned)).toEqual([
        [PENDING_FIELD, [{ start: 90, end: 100 }]],
      ]);
      expect(marks.cursor).toBe(900);
      expect(marks.rescanCursor).toBeNull();
    });

    it('splits a range in two when a span in its middle commits', async () => {
      const marks = markOf({ cursor: 900, pending: [day] });

      expect(await advance('pending', { start: 80, end: 90 }, marks, planned)).toEqual([
        [
          PENDING_FIELD,
          [
            { start: 70, end: 80 },
            { start: 90, end: 100 },
          ],
        ],
      ]);
    });

    it('writes no list when the span reads none of it', async () => {
      const marks = markOf({ cursor: 900, pending: [day] });

      expect(await advance('pending', { start: 200, end: 300 }, marks, planned)).toEqual([]);
    });
  });
});

describe('withoutRead', () => {
  const range = { start: 100, end: 200 };

  it.each([
    ['all of it', { start: 100, end: 200 }, []],
    ['more than all of it', { start: 50, end: 250 }, []],
    ['its start', { start: 50, end: 150 }, [{ start: 150, end: 200 }]],
    ['its end', { start: 150, end: 250 }, [{ start: 100, end: 150 }]],
    [
      'its middle',
      { start: 120, end: 180 },
      [
        { start: 100, end: 120 },
        { start: 180, end: 200 },
      ],
    ],
    ['ground before it', { start: 0, end: 100 }, [range]],
    ['ground after it', { start: 200, end: 300 }, [range]],
  ])('leaves what is not read when a span reads %s', (_label, read, left) => {
    expect(withoutRead([range], read)).toEqual(left);
  });

  it('reads across several ranges', () => {
    const ranges = [
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ];

    expect(withoutRead(ranges, { start: 5, end: 25 })).toEqual([
      { start: 0, end: 5 },
      { start: 25, end: 30 },
    ]);
  });
});

describe('readPendingMark', () => {
  const FIELD = 'binancePayPendingOverlap';
  const owedBefore = { start: 1_000, end: 5_000 };

  const readMark = (metadata: unknown, owedIfUnreadable = owedBefore) => {
    const write = jest.fn(async (_field: string, _ranges: WalkWindow[]) => undefined);

    return {
      write,
      ranges: readPendingMark({ field: FIELD, metadata, owedIfUnreadable, write }),
    };
  };

  it('reads the stored list of one walk and writes nothing', async () => {
    const stored = [{ start: 1, end: 2 }];
    const { ranges, write } = readMark({ [FIELD]: stored });

    expect(await ranges).toEqual(stored);
    expect(write).not.toHaveBeenCalled();
  });

  it('is an empty list with nothing stored, and writes nothing', async () => {
    const { ranges, write } = readMark({ binanceAsset: 'BTC' });

    expect(await ranges).toEqual([]);
    expect(write).not.toHaveBeenCalled();
  });

  describe('for a malformed value', () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warn.mockRestore();
    });

    it('owes the ground before the cursor once, instead of nothing', async () => {
      const { ranges } = readMark({ [FIELD]: 'x' });

      expect(await ranges).toEqual([owedBefore]);
    });

    it('stores that ground at once, so the repaired list is what the next run reads', async () => {
      const { ranges, write } = readMark({ [FIELD]: [{ start: 9, end: 3 }] });

      await ranges;

      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith(FIELD, [owedBefore]);
    });

    it('logs one fixed code and never throws', async () => {
      await readMark({ [FIELD]: 'x' }).ranges;

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('[binance sync] pending overlap ranges unreadable', {
        name: 'BinanceWalkStop',
        code: 'pending-malformed',
      });
    });

    it('owes nothing when no ground lies before the cursor', async () => {
      const { ranges, write } = readMark({ [FIELD]: 'x' }, { start: 5_000, end: 5_000 });

      expect(await ranges).toEqual([]);
      expect(write).toHaveBeenCalledWith(FIELD, []);
    });
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

    await walkSpans({ window, read, commit: commitCount(1), pass: 'forward' });

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
      pass: 'forward',
    });

    expect(committed).toEqual([
      { start: 0, end: 25 },
      { start: 25, end: 50 },
      { start: 50, end: 75 },
      { start: 75, end: 100 },
    ]);
    expect(result).toEqual({ imported: 8, complete: true, stopped: [] });
  });

  it('hands the commit the page the read gave for that span', async () => {
    const commit = jest.fn(async (_span: WalkWindow, _page: string) => 0);

    await walkSpans({
      window: { start: 0, end: 10 },
      read: async () => ({ kind: 'page', page: 'the page' }),
      commit,
      pass: 'forward',
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

    const result = await walkSpans({
      window,
      read,
      commit: commitCount(3, committed),
      pass: 'forward',
    });

    expect(read).toHaveBeenCalledTimes(3);
    expect(committed).toEqual([half]);
    expect(result).toEqual({ imported: 3, complete: false, stopped: [] });
  });

  it.each(['forward', 'rescan'] as const)(
    'stops the %s pass, reading no further span, when the commit gives up',
    async (pass) => {
      const read = readByWidth();
      const commit = jest.fn(async () => undefined);

      const result = await walkSpans({ window, read, commit, pass });

      expect(commit).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ imported: 0, complete: false, stopped: [] });
    },
  );

  describe('in the pending pass', () => {
    const STUCK_AT = 37;
    const holdsStuck = (span: WalkWindow): boolean => span.start <= STUCK_AT && STUCK_AT < span.end;

    /** A commit that gives up on any span holding the stuck record, as a row it cannot place. */
    const commitUnlessStuck = (committed: WalkWindow[] = []) =>
      jest.fn(async (span: WalkWindow, _page: WalkWindow): Promise<number | undefined> => {
        if (holdsStuck(span)) {
          return undefined;
        }

        committed.push(span);

        return 1;
      });

    it('goes on past a span whose commit gives up, and reports the span as stopped', async () => {
      const committed: WalkWindow[] = [];

      const result = await walkSpans({
        window,
        read: readByWidth(),
        commit: commitUnlessStuck(committed),
        pass: 'pending',
      });

      expect(committed).toEqual([
        { start: 0, end: 25 },
        { start: 50, end: 75 },
        { start: 75, end: 100 },
      ]);
      expect(result).toEqual({ imported: 3, complete: false, stopped: [{ start: 25, end: 50 }] });
    });

    it('reports every span that gave up, oldest first', async () => {
      const result = await walkSpans({
        window,
        read: readByWidth(),
        commit: jest.fn(async (span: WalkWindow) => (span.start >= 50 ? undefined : 1)),
        pass: 'pending',
      });

      expect(result.stopped).toEqual([
        { start: 50, end: 75 },
        { start: 75, end: 100 },
      ]);
    });

    it('is complete with nothing stopped when every commit goes through', async () => {
      const result = await walkSpans({
        window,
        read: readByWidth(),
        commit: commitCount(1),
        pass: 'pending',
      });

      expect(result).toEqual({ imported: 4, complete: true, stopped: [] });
    });

    it('keeps the stopped spans it found when the read gives up after them', async () => {
      const half = { start: 0, end: 50 };
      const reads = [
        { kind: 'split' as const, half },
        { kind: 'page' as const, page: half },
        undefined,
      ];
      const read = jest.fn(async () => reads.shift());

      const result = await walkSpans({
        window,
        read,
        commit: jest.fn(async () => undefined),
        pass: 'pending',
      });

      expect(result).toEqual({ imported: 0, complete: false, stopped: [half] });
    });
  });

  it('stops a span of one millisecond that is still too full, committing nothing', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const commit = commitCount(1);

    const result = await walkSpans({
      window: { start: 100, end: 101 },
      read: async (span) => splitOrStop(span, 'test-page-stuck'),
      commit,
      pass: 'forward',
    });

    expect(commit).not.toHaveBeenCalled();
    expect(result).toEqual({ imported: 0, complete: false, stopped: [] });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('is complete, reading nothing, for a window with no width', async () => {
    const read = readByWidth();

    const result = await walkSpans({
      window: { start: 5, end: 5 },
      read,
      commit: commitCount(1),
      pass: 'forward',
    });

    expect(read).not.toHaveBeenCalled();
    expect(result).toEqual({ imported: 0, complete: true, stopped: [] });
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
