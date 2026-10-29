import { DAY_MS } from '@kiko/dates';
import maybe, { foldMap } from 'fnts/maybe';

import { type OwedGround, planWalkPasses } from './walk';

const END_MS = Date.UTC(2026, 9, 10);
const WINDOW_MS = 30 * DAY_MS;
const BEFORE_EVERY_GROUND = Number.MIN_SAFE_INTEGER;

// Spread from a variable, so the option reaches the planner without the typecheck of a literal
// that names a key this build's input type may not list yet.
const NEWEST_FIRST = { newestFirst: true };
const OLDEST_FIRST = { newestFirst: false };

const input: Parameters<typeof planWalkPasses>[0] = {
  cursor: END_MS - 2 * DAY_MS,
  rescanCursor: null,
  pointCursor: null,
  rangeCursor: null,
  floorMs: Date.UTC(2017, 6, 14),
  endTime: END_MS,
  windowMs: WINDOW_MS,
  overlapMs: DAY_MS,
  maxWindows: 80,
  pending: [],
};

const planNewest = (over: Partial<typeof input> = {}) =>
  planWalkPasses({ ...input, ...over, ...NEWEST_FIRST });

const startsOf = (plan: ReturnType<typeof planNewest>): number[] =>
  plan.pending.map(({ start }) => start);

const RANGE_START = END_MS - 700 * DAY_MS;

// The window `index` of a range that starts at `RANGE_START` and is a whole number of windows
// long (0 is the oldest).
const windowStart = (index: number): number => RANGE_START + index * WINDOW_MS;

const rangeOfWindows = (count: number, series?: string): OwedGround => ({
  start: RANGE_START,
  end: windowStart(count),
  ...foldMap(maybe(series), (name) => ({ series: name })),
});

const newestFirstOf = (count: number): number[] =>
  Array.from({ length: count }, (_unused, offset) => windowStart(count - 1 - offset));

describe('planWalkPasses with the newest-first option', () => {
  it('plans one range of 20 windows from the range end, newest first, cut to the most windows a run may plan', () => {
    const plan = planNewest({ pending: [rangeOfWindows(20)], maxWindows: 8 });

    expect(startsOf(plan)).toEqual(newestFirstOf(20).slice(0, 8));
    expect(plan.pending.map(({ start, end }) => end - start)).toEqual(
      plan.pending.map(() => WINDOW_MS),
    );
  });

  it('cuts the oldest window at the start of the range, so a range that is not a whole number of windows loses no day', () => {
    const odd = { start: RANGE_START + 5 * DAY_MS, end: windowStart(2) };

    const plan = planNewest({ pending: [odd] });

    expect(plan.pending.map(({ start, end }) => [start, end])).toEqual([
      [windowStart(1), windowStart(2)],
      [odd.start, windowStart(1)],
    ]);
  });

  it('plans the windows older than the one the range cursor ends first, then that window and the newer ones, each part newest first', () => {
    const plan = planNewest({ pending: [rangeOfWindows(20)], rangeCursor: windowStart(15) });

    expect(startsOf(plan)).toEqual([
      ...[13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map(windowStart),
      ...[19, 18, 17, 16, 15, 14].map(windowStart),
    ]);
  });

  it('cuts the rotated order, not the plain one, to the most windows a run may plan', () => {
    const plan = planNewest({
      pending: [rangeOfWindows(20)],
      rangeCursor: windowStart(15),
      maxWindows: 8,
    });

    expect(startsOf(plan)).toEqual([13, 12, 11, 10, 9, 8, 7, 6].map(windowStart));
  });

  it.each([
    ['none stored', null],
    ['a cursor before every window, as a repair stores', BEFORE_EVERY_GROUND],
    ['a cursor past every window', END_MS],
  ])('plans every window newest first with %s', (_label, rangeCursor) => {
    const plan = planNewest({ pending: [rangeOfWindows(6)], rangeCursor });

    expect(startsOf(plan)).toEqual(newestFirstOf(6));
  });

  it('plans the 11th and 12th window from the top first when the cursor ends the 10th, which a per-range cap would hide', () => {
    const plan = planNewest({
      pending: [rangeOfWindows(12)],
      rangeCursor: windowStart(3),
      maxWindows: 10,
    });

    expect(startsOf(plan)).toEqual([1, 0, 11, 10, 9, 8, 7, 6, 5, 4].map(windowStart));
  });

  it('plans the windows of two ranges together by start, newest first, whatever order the ranges are stored in', () => {
    const old = { start: END_MS - 500 * DAY_MS, end: END_MS - 500 * DAY_MS + 2 * WINDOW_MS };
    const middle = { start: END_MS - 300 * DAY_MS, end: END_MS - 300 * DAY_MS + WINDOW_MS };
    const recent = { start: END_MS - 200 * DAY_MS, end: END_MS - 200 * DAY_MS + 2 * WINDOW_MS };

    const plan = planNewest({ pending: [middle, old, recent], maxWindows: 3 });

    expect(startsOf(plan)).toEqual([recent.start + WINDOW_MS, recent.start, middle.start]);
  });

  it('keeps the series of a range owed on one side on each window it plans', () => {
    const plan = planNewest({ pending: [rangeOfWindows(3, 'BUY')] });

    expect(startsOf(plan)).toEqual(newestFirstOf(3));
    expect(plan.pending.map(({ series }) => series)).toEqual(newestFirstOf(3).map(() => ['BUY']));
  });

  it('plans the windows owed to the backfill after the others, oldest first as before', () => {
    const everyCoin = { start: windowStart(10), end: windowStart(12) };
    const backfill = {
      start: windowStart(0),
      end: windowStart(2),
      scope: 'backfill' as const,
    };

    const plan = planNewest({ pending: [backfill, everyCoin] });

    expect(plan.pending.map(({ start, scope }) => [start, scope])).toEqual([
      [windowStart(11), undefined],
      [windowStart(10), undefined],
      [windowStart(0), 'backfill'],
      [windowStart(1), 'backfill'],
    ]);
  });

  it('plans the forward pass, the re-scan and the points exactly as with the option off', () => {
    const point = {
      start: END_MS - 90 * DAY_MS,
      end: END_MS - 90 * DAY_MS + 2,
      kind: 'point' as const,
      series: 'BUY',
      since: END_MS,
    };
    const base = { ...input, cursor: END_MS - 3 * DAY_MS, pending: [rangeOfWindows(5), point] };

    const newest = planWalkPasses({ ...base, ...NEWEST_FIRST });
    const oldest = planWalkPasses({ ...base, ...OLDEST_FIRST });

    expect(newest.forward).toEqual(oldest.forward);
    expect(newest.rescan).toEqual(oldest.rescan);
    expect(newest.points).toEqual(oldest.points);
    expect(newest.rescanEnd).toBe(oldest.rescanEnd);
    expect(newest.pendingRanges).toEqual(oldest.pendingRanges);
    expect(newest.ranAt).toBe(oldest.ranAt);
  });

  it('leaves the plan byte for byte what it was when the option is false or left out', () => {
    const base = {
      ...input,
      pending: [rangeOfWindows(7), { start: END_MS - 40 * DAY_MS, end: END_MS - 38 * DAY_MS }],
      rangeCursor: windowStart(3),
    };

    expect(planWalkPasses({ ...base, ...OLDEST_FIRST })).toEqual(planWalkPasses(base));
  });

  it('plans the same ground as with the option off, only in another order, for a range of any length', () => {
    for (const windows of [1, 2, 5, 19]) {
      const base = { ...input, pending: [rangeOfWindows(windows)] };
      const oldest = planWalkPasses({ ...base, ...OLDEST_FIRST }).pending;
      const newest = planWalkPasses({ ...base, ...NEWEST_FIRST }).pending;

      expect([...newest].sort((left, right) => left.start - right.start)).toEqual(oldest);
      expect(newest.map(({ start }) => start)).toEqual(
        [...oldest].reverse().map(({ start }) => start),
      );
    }
  });
});
