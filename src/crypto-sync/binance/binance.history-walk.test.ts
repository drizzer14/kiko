import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import type { BinanceSpanHints } from '@kiko/holdings/holding-metadata';

import {
  advanceWalkMarks,
  BinanceWalkStop,
  btcSatoshis,
  buildWalkWindows,
  distinctGround,
  dropReadPoints,
  halfOf,
  logWalkStop,
  nextSpanAfter,
  type OwedGround,
  type OwedWindow,
  NO_HINTS,
  planWalkPasses,
  readPendingMark,
  readPointCursor,
  readRangeCursor,
  readSpanHints,
  readWalkRoundRobins,
  rescanCursorAfter,
  resolveWalletHoldings,
  roundRobinHooksOf,
  runWalkPlan,
  type SpanCommit,
  type SpanRead,
  storePointCursor,
  storeRangeCursor,
  storeSpanHints,
  type WalkMarks,
  type WalkResult,
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
    pointCursor: null,
    rangeCursor: null,
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

  describe('the round-robin over the owed ranges', () => {
    const cursor = END_MS - 2 * DAY_MS;
    const rangeAt = (index: number): WalkWindow => ({
      start: END_MS - 200 * DAY_MS + index * 10 * DAY_MS,
      end: END_MS - 200 * DAY_MS + index * 10 * DAY_MS + DAY_MS,
    });
    const ranges = [0, 1, 2, 3].map(rangeAt);
    const startsOf = (rangeCursor: number | null, pending: WalkWindow[] = ranges): number[] =>
      planWalkPasses({ ...input, cursor, pending, rangeCursor }).pending.map(
        (window) => window.start,
      );

    it('reads the ranges oldest first with no range cursor', () => {
      expect(startsOf(null)).toEqual(ranges.map((range) => range.start));
    });

    it('reads the ranges that start after the cursor first, then the others, oldest first', () => {
      expect(startsOf(ranges[1].end)).toEqual([2, 3, 0, 1].map((index) => ranges[index].start));
    });

    it('puts the range the cursor is at the end of behind every other range', () => {
      expect(startsOf(ranges[0].end)).toEqual([1, 2, 3, 0].map((index) => ranges[index].start));
      expect(startsOf(ranges[3].end)).toEqual([0, 1, 2, 3].map((index) => ranges[index].start));
    });

    it('reads a range that starts at the cursor first: the cursor is the end of the window read last', () => {
      expect(startsOf(ranges[2].start)).toEqual([2, 3, 0, 1].map((index) => ranges[index].start));
    });

    it('reads oldest first for a cursor before every range, the start a repair stores', () => {
      expect(startsOf(Number.MIN_SAFE_INTEGER)).toEqual(ranges.map((range) => range.start));
    });

    it('reads oldest first for a cursor past every range', () => {
      expect(startsOf(END_MS)).toEqual(ranges.map((range) => range.start));
    });

    const SHORT_WINDOW_MS = 4 * DAY_MS;
    const startsInShortWindows = (rangeCursor: number | null, pending: WalkWindow[]): number[] =>
      planWalkPasses({
        ...input,
        cursor,
        pending,
        rangeCursor,
        windowMs: SHORT_WINDOW_MS,
      }).pending.map((window) => window.start);

    it('keeps the windows of one range together and in order', () => {
      const long = { start: ranges[1].start, end: ranges[1].start + 2 * SHORT_WINDOW_MS };
      const pending = [ranges[0], long, rangeAt(3)];

      expect(startsInShortWindows(ranges[0].end, pending)).toEqual([
        long.start,
        long.start + SHORT_WINDOW_MS,
        rangeAt(3).start,
        ranges[0].start,
      ]);
    });

    it('reads what is left of a range cut by a read first: it starts at the end of the window read', () => {
      const left = {
        start: ranges[1].start + SHORT_WINDOW_MS,
        end: ranges[1].start + 2 * SHORT_WINDOW_MS,
      };

      expect(startsInShortWindows(left.start, [ranges[0], left, rangeAt(3)])).toEqual([
        left.start,
        rangeAt(3).start,
        ranges[0].start,
      ]);
    });

    describe('one range of several windows', () => {
      const WINDOWS = 5;
      const long = {
        start: END_MS - 600 * DAY_MS,
        end: END_MS - 600 * DAY_MS + WINDOWS * WINDOW_MS,
      };
      const windowStart = (index: number): number => long.start + index * WINDOW_MS;
      const plannedStarts = (rangeCursor: number | null): number[] =>
        planWalkPasses({ ...input, cursor, pending: [long], rangeCursor }).pending.map(
          (window) => window.start,
        );

      it('plans the window after the one read last first, whichever window of the range that was', () => {
        expect(plannedStarts(windowStart(1))[0]).toBe(windowStart(1));
        expect(plannedStarts(windowStart(2))[0]).toBe(windowStart(2));
        expect(plannedStarts(windowStart(1))).toEqual(
          [1, 2, 3, 4, 0].map((index) => windowStart(index)),
        );
      });

      it('wraps to the first window once the cursor is past the last', () => {
        expect(plannedStarts(long.end)).toEqual([0, 1, 2, 3, 4].map((index) => windowStart(index)));
      });

      it('reads every window within 5 runs of one read each, the range owed whole every run', () => {
        let rangeCursor: number | null = null;
        const read: number[] = [];

        for (let run = 0; run < WINDOWS; run += 1) {
          const [first]: WalkWindow[] = planWalkPasses({
            ...input,
            cursor,
            pending: [long],
            rangeCursor,
          }).pending;

          read.push(first.start);
          rangeCursor = first.end;
        }

        expect(read).toEqual([0, 1, 2, 3, 4].map((index) => windowStart(index)));
      });
    });

    it('does not move the forward windows, the re-scan or the points', () => {
      const point: OwedGround = { start: 5, end: 7, kind: 'point' };
      const plain = planWalkPasses({ ...input, cursor, pending: [...ranges, point] });
      const rotated = planWalkPasses({
        ...input,
        cursor,
        pending: [...ranges, point],
        rangeCursor: ranges[1].end,
      });

      expect(rotated.forward).toEqual(plain.forward);
      expect(rotated.rescan).toEqual(plain.rescan);
      expect(rotated.points).toEqual(plain.points);
      expect(rotated.pendingRanges).toEqual(plain.pendingRanges);
    });
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

    const storedRanges = (count: number): WalkWindow[] =>
      Array.from({ length: count }, (_unused, index) => ({
        start: END_MS - 190 * DAY_MS + index * 10 * DAY_MS,
        end: END_MS - 190 * DAY_MS + index * 10 * DAY_MS + DAY_MS,
      }));

    it('holds twelve stored ranges and the overlap day beside them, and merges none', () => {
      const stored = storedRanges(12);

      const { pendingRanges } = planWalkPasses({ ...input, cursor, pending: stored });

      expect(pendingRanges).toEqual([...stored, day]);
    });

    it('merges the two nearest ranges past twelve into their hull, so no ground is lost', () => {
      const stored = storedRanges(13).map((range, index) =>
        index >= 7 ? { start: range.start - 5 * DAY_MS, end: range.end - 5 * DAY_MS } : range,
      );

      const { pendingRanges } = planWalkPasses({ ...input, cursor, pending: stored });

      expect(pendingRanges).toEqual([
        ...stored.slice(0, 6),
        { start: stored[6].start, end: stored[7].end },
        ...stored.slice(8),
        day,
      ]);
    });

    describe('with points, the ground of one record each', () => {
      const pointAt = (time: number): OwedGround => ({
        start: time - 1,
        end: time + 1,
        kind: 'point',
      });
      const secondAt = (time: number): OwedGround => ({
        start: time - 1_000,
        end: time + 1_000,
        kind: 'point',
      });
      const pointsAmong = (ranges: OwedGround[]): OwedGround[] =>
        ranges.filter((range) => range.kind === 'point');
      const windowOf = ({ start, end }: OwedGround): WalkWindow => ({ start, end });

      it('never merges a point, and does not count it against the twelve', () => {
        const stored = storedRanges(12);
        const points = Array.from({ length: 5 }, (_unused, index) =>
          pointAt(stored[index].end + 3 * DAY_MS),
        );

        const { pendingRanges } = planWalkPasses({
          ...input,
          cursor,
          pending: [...stored, ...points],
        });

        expect(pendingRanges).toHaveLength(12 + 5 + 1);
        expect(pointsAmong(pendingRanges)).toEqual(points);
      });

      it('keeps a point that lies between two ranges that must merge, beside their hull', () => {
        const stored = storedRanges(13).map((range, index) =>
          index === 12 ? { start: range.start - 6 * DAY_MS, end: range.end - 6 * DAY_MS } : range,
        );
        const between = pointAt(stored[11].end + DAY_MS);

        const { pendingRanges } = planWalkPasses({
          ...input,
          cursor,
          pending: [...stored, between],
        });

        expect(pendingRanges).toEqual([
          ...stored.slice(0, 11),
          { start: stored[11].start, end: stored[12].end },
          between,
          day,
        ]);
      });

      it('keeps a point of a second, as a withdrawal owes, and not as a range', () => {
        const stored = storedRanges(12);
        const second = secondAt(stored[0].end + 3 * DAY_MS);

        const { pendingRanges } = planWalkPasses({
          ...input,
          cursor,
          pending: [...stored, second, pointAt(stored[1].end + 3 * DAY_MS)],
        });

        expect(pendingRanges).toHaveLength(12 + 2 + 1);
        expect(pendingRanges).toContainEqual(second);
      });

      it('keeps a point a range holds beside the range, and drops only a point that repeats one', () => {
        const stored = { start: END_MS - 150 * DAY_MS, end: END_MS - 149 * DAY_MS };
        const inside = pointAt(stored.start + 1_000);
        const outside = pointAt(stored.end + DAY_MS);

        const { pendingRanges } = planWalkPasses({
          ...input,
          cursor,
          pending: [stored, inside, outside, outside],
        });

        expect(pendingRanges).toEqual([stored, inside, outside, day]);
      });

      it('keeps both of two points that start together and differ, the narrower first', () => {
        const time = END_MS - 150 * DAY_MS;
        const narrow = pointAt(time - 999);
        const wide = secondAt(time);

        const { pendingRanges } = planWalkPasses({
          ...input,
          cursor,
          pending: [wide, narrow, narrow, wide],
        });

        expect(narrow.start).toBe(wide.start);
        expect(pointsAmong(pendingRanges)).toEqual([narrow, wide]);
      });

      it('reads one window for points that start together, the wider, which holds the other', () => {
        const time = END_MS - 150 * DAY_MS;
        const narrow = pointAt(time - 999);
        const wide = secondAt(time);

        const { points } = planWalkPasses({ ...input, cursor, pending: [narrow, wide] });

        expect(points).toEqual([windowOf(wide)]);
      });

      describe('typed, the ground of one record in the series it was read under', () => {
        const time = END_MS - 150 * DAY_MS;
        const typedAt = (series: string, reach = 1): OwedGround => ({
          start: time - reach,
          end: time + reach,
          kind: 'point',
          series,
        });
        const seriesOf = (window: { series?: readonly string[] }): string[] =>
          [...(window.series ?? [])].sort();

        it('keeps the series of a point in the list', () => {
          const { pendingRanges } = planWalkPasses({
            ...input,
            cursor,
            pending: [typedAt('MAIN_FUNDING')],
          });

          expect(pointsAmong(pendingRanges)).toEqual([typedAt('MAIN_FUNDING')]);
        });

        it('keeps two points of one window in two series as two entries, and one that repeats as one', () => {
          const { pendingRanges } = planWalkPasses({
            ...input,
            cursor,
            pending: [typedAt('FUNDING_MAIN'), typedAt('MAIN_FUNDING'), typedAt('MAIN_FUNDING')],
          });

          expect(pointsAmong(pendingRanges)).toHaveLength(2);
          expect(pointsAmong(pendingRanges).map((point) => point.series)).toEqual(
            expect.arrayContaining(['FUNDING_MAIN', 'MAIN_FUNDING']),
          );
        });

        it('reads a point in its own series only', () => {
          const { points } = planWalkPasses({
            ...input,
            cursor,
            pending: [typedAt('MAIN_UMFUTURE')],
          });

          expect(points).toEqual([
            { ...windowOf(typedAt('MAIN_UMFUTURE')), series: ['MAIN_UMFUTURE'] },
          ]);
        });

        it('reads one window for points that start together: the widest, in the union of their series', () => {
          const wider: OwedGround = { ...typedAt('FUNDING_MAIN'), end: time + 1_000 };
          const { points } = planWalkPasses({
            ...input,
            cursor,
            pending: [typedAt('MAIN_FUNDING'), wider],
          });

          expect(points).toHaveLength(1);
          expect(points[0]).toMatchObject(windowOf(wider));
          expect(seriesOf(points[0])).toEqual(['FUNDING_MAIN', 'MAIN_FUNDING']);
        });

        it('lists a series once, however many points of it start together', () => {
          const { points } = planWalkPasses({
            ...input,
            cursor,
            pending: [typedAt('MAIN_FUNDING'), { ...typedAt('MAIN_FUNDING'), end: time + 1_000 }],
          });

          expect(points).toHaveLength(1);
          expect(seriesOf(points[0])).toEqual(['MAIN_FUNDING']);
        });

        it('reads in every series, no series named, when a point that starts with the others has none', () => {
          const untyped: OwedGround = { ...windowOf(typedAt('x')), kind: 'point' };

          const { points } = planWalkPasses({
            ...input,
            cursor,
            pending: [typedAt('MAIN_FUNDING'), untyped],
          });

          expect(points).toEqual([windowOf(untyped)]);
        });

        it('reads the points of different starts as windows of their own, each in its own series', () => {
          const later: OwedGround = {
            start: time + 10 * DAY_MS - 1,
            end: time + 10 * DAY_MS + 1,
            kind: 'point',
            series: 'UMFUTURE_MAIN',
          };

          const { points } = planWalkPasses({
            ...input,
            cursor,
            pending: [typedAt('MAIN_FUNDING'), later],
          });

          expect(points.map(seriesOf)).toEqual([['MAIN_FUNDING'], ['UMFUTURE_MAIN']]);
        });
      });

      it('keeps a short range a range, and reads it among the ranges, never among the points', () => {
        const sliver = { start: END_MS - 150 * DAY_MS, end: END_MS - 150 * DAY_MS + 3 };

        const plan = planWalkPasses({ ...input, cursor, pending: [sliver] });

        expect(plan.pending).toEqual([sliver]);
        expect(plan.points).toEqual([]);
        expect(plan.pendingRanges).toEqual([sliver, day]);
      });

      it('keeps a range and a point of one window, each as its own entry', () => {
        const window = { start: END_MS - 150 * DAY_MS, end: END_MS - 150 * DAY_MS + 2 };
        const point = { ...window, kind: 'point' as const };

        const plan = planWalkPasses({ ...input, cursor, pending: [window, point] });

        expect(plan.pendingRanges).toEqual([window, point, day]);
        expect(plan.pending).toEqual([window]);
        expect(plan.points).toEqual([window]);
      });

      it('leaves a point beside the range that only reaches into it, and never shortens either', () => {
        const stored = { start: END_MS - 150 * DAY_MS, end: END_MS - 149 * DAY_MS };
        const across = pointAt(stored.end);

        const { pendingRanges } = planWalkPasses({
          ...input,
          cursor,
          pending: [stored, across],
        });

        expect(pendingRanges).toEqual([stored, across, day]);
      });

      it('plans a read for a point the re-scan covers: only its own record takes it off the list', () => {
        const inside = pointAt(END_MS - 30 * DAY_MS);

        const plan = planWalkPasses({ ...input, cursor, pending: [inside] });

        expect(plan.points).toEqual([windowOf(inside)]);
        expect(plan.pending).toEqual([]);
        expect(plan.pendingRanges).toContainEqual(inside);
      });

      it('plans a point outside the re-scan as a point to read, not as a range', () => {
        const old = pointAt(END_MS - 150 * DAY_MS);

        const plan = planWalkPasses({ ...input, cursor, pending: [old] });

        expect(plan.points).toEqual([windowOf(old)]);
        expect(plan.pending).toEqual([]);
      });

      it('drops a point the floor has passed', () => {
        const floorMs = END_MS - 100 * DAY_MS;

        const plan = planWalkPasses({
          ...input,
          floorMs,
          cursor,
          pending: [pointAt(floorMs - 10)],
        });

        expect(plan.points).toEqual([]);
        expect(pointsAmong(plan.pendingRanges)).toEqual([]);
      });

      it('keeps a point the floor reaches into whole: its record is at the floor, or before it', () => {
        const floorMs = END_MS - 150 * DAY_MS;

        const plan = planWalkPasses({ ...input, floorMs, cursor, pending: [pointAt(floorMs)] });

        expect(plan.points).toEqual([windowOf(pointAt(floorMs))]);
        expect(pointsAmong(plan.pendingRanges)).toEqual([pointAt(floorMs)]);
      });

      it('keeps a point the end has not reached in the list, and plans no read for it yet', () => {
        const ahead = pointAt(END_MS + 10);

        const plan = planWalkPasses({ ...input, cursor: END_MS, pending: [ahead] });

        expect(pointsAmong(plan.pendingRanges)).toEqual([ahead]);
        expect(plan.points).toEqual([]);
      });

      it('keeps a point that reaches past the end whole, and cuts only the window it reads', () => {
        const atEnd = pointAt(END_MS);

        const plan = planWalkPasses({ ...input, cursor: END_MS, pending: [atEnd] });

        expect(pointsAmong(plan.pendingRanges)).toEqual([atEnd]);
        expect(plan.points).toEqual([{ start: END_MS - 1, end: END_MS }]);
      });

      it('plans a point the re-scan covers only in part as the whole point, never a remnant', () => {
        const rescanStart = END_MS - WINDOW_MS;
        const straddling = pointAt(rescanStart);

        const plan = planWalkPasses({ ...input, cursor, pending: [straddling] });

        expect(plan.points).toEqual([windowOf(straddling)]);
      });

      it('plans a read for a point a pending range holds, beside the read of the range', () => {
        const stored = { start: END_MS - 150 * DAY_MS, end: END_MS - 149 * DAY_MS };
        const inside = pointAt(stored.start + 5_000);

        const plan = planWalkPasses({ ...input, cursor, pending: [stored, inside] });

        expect(plan.points).toEqual([windowOf(inside)]);
        expect(plan.pending).toEqual([stored]);
        expect(plan.pendingRanges).toEqual([stored, inside, day]);
      });

      describe('read last, in a round-robin that the point cursor moves on', () => {
        const points = Array.from({ length: 7 }, (_unused, index) =>
          pointAt(END_MS - 150 * DAY_MS + index * 10 * DAY_MS),
        );
        const planAfter = (pointCursor: number | null, endTime = END_MS) =>
          planWalkPasses({
            ...input,
            endTime,
            pointCursor,
            cursor: endTime - 2 * DAY_MS,
            pending: points,
          });

        const windows = points.map(windowOf);

        it('plans every point oldest first when there is no point cursor', () => {
          expect(planAfter(null).points).toEqual(windows);
        });

        it('starts at the first point after the cursor, and wraps around to the ones before', () => {
          const plan = planAfter(points[2].start);

          expect(plan.points).toEqual([...windows.slice(3), ...windows.slice(0, 3)]);
        });

        it('reads the point the cursor stands on last', () => {
          expect(planAfter(points[4].start).points.at(-1)).toEqual(windows[4]);
        });

        it('wraps to the oldest point when the cursor is past the newest', () => {
          expect(planAfter(points[6].start).points).toEqual(windows);
          expect(planAfter(points[6].start + 1).points).toEqual(windows);
        });

        it('starts at the oldest point when the cursor is before every point', () => {
          expect(planAfter(points[0].start - 1).points).toEqual(windows);
          expect(planAfter(Number.MIN_SAFE_INTEGER).points).toEqual(windows);
        });

        it('does not depend on the end time of the run', () => {
          for (const step of [0, 1, 3_600_000, DAY_MS, 2 ** 32, 2 ** 33 + 7]) {
            expect(planAfter(points[2].start, END_MS + step).points).toEqual(
              planAfter(points[2].start).points,
            );
          }
        });

        it.each([1, 2, 3, 7])(
          'reads every point within ceil(7 / %i) runs of reading the next %i after the cursor',
          (reads) => {
            let pointCursor: number | null = null;
            const seen = new Set<number>();
            const runs = Math.ceil(points.length / reads);

            for (let run = 0; run < runs; run += 1) {
              const read = planAfter(pointCursor, END_MS + run * 2 ** 32).points.slice(0, reads);

              for (const point of read) {
                seen.add(point.start);
              }
              pointCursor = read.at(-1)?.start ?? pointCursor;
            }

            expect(seen.size).toBe(points.length);
          },
        );
      });
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
  points: [],
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
  const ran = (
    imported: number,
    complete: boolean,
    owed = false,
    started = true,
  ): WindowOutcome => ({
    imported,
    complete,
    owed,
    started,
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

  describe('a forward window that does not complete', () => {
    const withPoint = { ...plan, points: [{ start: 500, end: 502 }] };

    it('ends only the forward pass: the owed windows, the re-scan and the points are read after it', async () => {
      const seen: [number, WalkPass][] = [];

      const result = await runWalkPlan({
        plan: withPoint,
        canAfford: () => true,
        runWindow: async (span, pass) => {
          seen.push([span.start, pass]);

          return ran(1, pass !== 'forward');
        },
      });

      expect(seen).toEqual([
        [0, 'forward'],
        [5, 'pending'],
        [20, 'pending'],
        [10, 'rescan'],
        [500, 'pending'],
      ]);
      expect(result).toEqual({ imported: 5, complete: false });
    });

    it('still lets the budget end every pass', async () => {
      let calls = 1;
      const runWindow = jest.fn(async () => ran(1, false));

      const result = await runWalkPlan({
        plan: withPoint,
        canAfford: () => {
          calls -= 1;

          return calls >= 0;
        },
        runWindow,
      });

      expect(runWindow).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ imported: 1, complete: false });
    });
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

  describe('a window that leaves ground owed', () => {
    const rescanWindow = { start: 200, end: 300 };
    const owedOutcome = (imported: number): WindowOutcome => ({
      imported,
      complete: true,
      owed: true,
      started: true,
    });

    it('reports the run incomplete, though every window was read to its end', async () => {
      const result = await runWalkPlan({
        plan: planOf({ pending: [owedWindow(5)] }),
        canAfford: () => true,
        runWindow: async () => owedOutcome(2),
      });

      expect(result).toEqual({ imported: 2, complete: false });
    });

    it('goes on to the next owed window, the re-scan and the points after it', async () => {
      const seen: [WalkWindow, WalkPass][] = [];

      const result = await runWalkPlan({
        plan: planOf({
          pending: [owedWindow(5), owedWindow(20)],
          points: [{ start: 500, end: 501 }],
          rescan: [rescanWindow],
          rescanEnd: 300,
        }),
        canAfford: () => true,
        runWindow: async (span, pass) => {
          seen.push([span, pass]);

          return owedOutcome(1);
        },
      });

      expect(seen).toEqual([
        [owedWindow(5), 'pending'],
        [owedWindow(20), 'pending'],
        [rescanWindow, 'rescan'],
        [{ start: 500, end: 501 }, 'pending'],
      ]);
      expect(result).toEqual({ imported: 4, complete: false });
    });

    it('goes on to the rest of the re-scan, which a stuck record does not end', async () => {
      const seen: number[] = [];

      await runWalkPlan({
        plan: planOf({ rescan: [window(10), window(11), window(12)], rescanEnd: 13 }),
        canAfford: () => true,
        runWindow: async (span) => {
          seen.push(span.start);

          return owedOutcome(0);
        },
      });

      expect(seen).toEqual([10, 11, 12]);
    });
  });

  describe('with owed points', () => {
    const pointAt = (start: number): WalkWindow => ({ start, end: start + 1 });
    const rescanWindow = { start: 200, end: 300 };

    /** A walk whose points stop, and whose other windows commit. */
    const stuckPointWalk = (seen: [WalkWindow, WalkPass][] = []) =>
      jest.fn(async (span: WalkWindow, pass: WalkPass) => {
        seen.push([span, pass]);

        return span.end - span.start === 1 ? ran(0, true, true) : ran(1, true);
      });

    it('reads them after the re-scan, behind the owed windows', async () => {
      const seen: [WalkWindow, WalkPass][] = [];

      await runWalkPlan({
        plan: planOf({
          pending: [owedWindow(20)],
          points: [pointAt(5)],
          rescan: [rescanWindow],
          rescanEnd: 300,
        }),
        canAfford: () => true,
        runWindow: stuckPointWalk(seen),
      });

      expect(seen).toEqual([
        [owedWindow(20), 'pending'],
        [rescanWindow, 'rescan'],
        [pointAt(5), 'pending'],
      ]);
    });

    it('reads them in the order the plan gives, each as one window', async () => {
      const seen: [WalkWindow, WalkPass][] = [];

      await runWalkPlan({
        plan: planOf({ points: [pointAt(9), pointAt(3), pointAt(7)] }),
        canAfford: () => true,
        runWindow: stuckPointWalk(seen),
      });

      expect(seen).toEqual([
        [pointAt(9), 'pending'],
        [pointAt(3), 'pending'],
        [pointAt(7), 'pending'],
      ]);
    });

    it('goes on to the next point after one that is still stuck, and reports the run incomplete', async () => {
      const result = await runWalkPlan({
        plan: planOf({ points: [pointAt(5), pointAt(9)] }),
        canAfford: () => true,
        runWindow: stuckPointWalk(),
      });

      expect(result).toEqual({ imported: 0, complete: false });
    });

    it('reads no point once the re-scan has used the budget, and reports the run incomplete', async () => {
      let calls = 1;
      const seen: [WalkWindow, WalkPass][] = [];

      const result = await runWalkPlan({
        plan: planOf({ points: [pointAt(5)], rescan: [rescanWindow], rescanEnd: 300 }),
        canAfford: () => {
          calls -= 1;

          return calls >= 0;
        },
        runWindow: stuckPointWalk(seen),
      });

      expect(seen).toEqual([[rescanWindow, 'rescan']]);
      expect(result.complete).toBe(false);
    });

    it('reads as many points as the calls that are left allow, and no more', async () => {
      let calls = 2;
      const seen: [WalkWindow, WalkPass][] = [];

      await runWalkPlan({
        plan: planOf({ points: [pointAt(1), pointAt(2), pointAt(3)] }),
        canAfford: () => {
          calls -= 1;

          return calls >= 0;
        },
        runWindow: stuckPointWalk(seen),
      });

      expect(seen.map(([span]) => span.start)).toEqual([1, 2]);
    });

    it('imports a point that has become readable and reports the run complete', async () => {
      const result = await runWalkPlan({
        plan: planOf({ points: [pointAt(5)] }),
        canAfford: () => true,
        runWindow: async () => ran(1, true),
      });

      expect(result).toEqual({ imported: 1, complete: true });
    });

    it('still reads the points after a re-scan window that did not finish', async () => {
      const seen: [WalkWindow, WalkPass][] = [];

      await runWalkPlan({
        plan: planOf({ points: [pointAt(5)], rescan: [rescanWindow], rescanEnd: 300 }),
        canAfford: () => true,
        runWindow: jest.fn(async (span: WalkWindow, pass: WalkPass) => {
          seen.push([span, pass]);

          return ran(0, pass !== 'rescan');
        }),
      });

      expect(seen.at(-1)).toEqual([pointAt(5), 'pending']);
    });

    describe('marking the points that were read, for the round-robin', () => {
      it('marks each point after its own window, in the order they were read, and no other window', async () => {
        const events: string[] = [];

        await runWalkPlan({
          plan: planOf({
            pending: [owedWindow(20)],
            points: [pointAt(9), pointAt(3)],
            rescan: [rescanWindow],
            rescanEnd: 300,
          }),
          canAfford: () => true,
          runWindow: async (span, pass) => {
            events.push(`read:${span.start}:${pass}`);

            return ran(0, true, span.end - span.start === 1);
          },
          markPointRead: async (span) => {
            events.push(`mark:${span.start}`);
          },
        });

        expect(events).toEqual([
          'read:20:pending',
          'read:200:rescan',
          'read:9:pending',
          'mark:9',
          'read:3:pending',
          'mark:3',
        ]);
      });

      it('marks a point that is still stuck: it was read', async () => {
        const marked: number[] = [];

        await runWalkPlan({
          plan: planOf({ points: [pointAt(5)] }),
          canAfford: () => true,
          runWindow: stuckPointWalk(),
          markPointRead: async (span) => {
            marked.push(span.start);
          },
        });

        expect(marked).toEqual([5]);
      });

      it('marks a point whose window split and did not finish once its read had started, and none the budget skipped', async () => {
        let calls = 2;
        const marked: number[] = [];

        await runWalkPlan({
          plan: planOf({ points: [pointAt(1), pointAt(2), pointAt(3)] }),
          canAfford: () => {
            calls -= 1;

            return calls >= 0;
          },
          runWindow: async (span) => ran(0, span.start !== 2),
          markPointRead: async (span) => {
            marked.push(span.start);
          },
        });

        expect(marked).toEqual([1, 2]);
      });

      it('marks no point whose read never started: the budget or a rate limit stopped its first call', async () => {
        const marked: number[] = [];

        await runWalkPlan({
          plan: planOf({ points: [pointAt(1), pointAt(2)] }),
          canAfford: () => true,
          runWindow: async (span) => ran(0, false, false, span.start === 1),
          markPointRead: async (span) => {
            marked.push(span.start);
          },
        });

        expect(marked).toEqual([1]);
      });

      it('goes on to the next point after one whose window did not finish', async () => {
        const seen: number[] = [];

        await runWalkPlan({
          plan: planOf({ points: [pointAt(1), pointAt(2)] }),
          canAfford: () => true,
          runWindow: async (span) => {
            seen.push(span.start);

            return ran(0, false);
          },
        });

        expect(seen).toEqual([1, 2]);
      });
    });
  });

  describe('the calls a run keeps for later', () => {
    const owedAt = (start: number): WalkWindow => ({ start, end: start + 100 });
    const pointAt = (start: number): WalkWindow => ({ start, end: start + 1 });
    const rescanWindow = { start: 200, end: 300 };

    /** A lane budget of `calls` reads: a read is affordable when `keep` more would still fit. */
    const budgetOf = (calls: number) => {
      let spent = 0;

      return {
        canAfford: (keep: number) => spent + keep < calls,
        spend: () => {
          spent += 1;
        },
      };
    };

    /** Every window read, with the calls it was asked to keep, in order. */
    const keepsOf = async (
      walkPlan: WalkPlan,
      calls: number,
    ): Promise<{ seen: [WalkWindow, WalkPass, number][]; result: WalkResult }> => {
      const budget = budgetOf(calls);
      const seen: [WalkWindow, WalkPass, number][] = [];

      const result = await runWalkPlan({
        plan: walkPlan,
        canAfford: budget.canAfford,
        runWindow: async (span, pass, keep) => {
          budget.spend();
          seen.push([span, pass, keep]);

          return ran(1, true);
        },
      });

      return { seen, result };
    };

    it('keeps no call in the forward pass, one for the re-scan and one for the points in the owed windows, one for the points in the re-scan, and none in the points', async () => {
      const { seen } = await keepsOf(
        planOf({
          forward: [window(0)],
          pending: [owedAt(500)],
          points: [pointAt(900)],
          rescan: [rescanWindow],
          rescanEnd: 300,
        }),
        20,
      );

      expect(seen).toEqual([
        [window(0), 'forward', 0],
        [owedAt(500), 'pending', 2],
        [rescanWindow, 'rescan', 1],
        [pointAt(900), 'pending', 0],
      ]);
    });

    it('keeps no call for a re-scan or for points the plan does not have', async () => {
      const { seen } = await keepsOf(planOf({ pending: [owedAt(500)] }), 20);

      expect(seen).toEqual([[owedAt(500), 'pending', 0]]);
    });

    it('keeps a call for the points alone when the plan has points and no re-scan', async () => {
      const { seen } = await keepsOf(
        planOf({ pending: [owedAt(500)], points: [pointAt(900)] }),
        20,
      );

      expect(seen[0]).toEqual([owedAt(500), 'pending', 1]);
    });

    it('leaves the owed windows unread that the calls it keeps do not allow, and reads the re-scan and a point', async () => {
      const { seen, result } = await keepsOf(
        planOf({
          pending: [0, 500, 700, 900].map(owedAt),
          points: [pointAt(1_100)],
          rescan: [rescanWindow],
          rescanEnd: 300,
        }),
        3,
      );

      expect(seen.map(([span, pass]) => [span.start, pass])).toEqual([
        [0, 'pending'],
        [200, 'rescan'],
        [1_100, 'pending'],
      ]);
      expect(result.complete).toBe(false);
    });

    describe('when a window costs several calls, as one read of every transfer type does', () => {
      const SERIES_COUNT = 20;
      const callsOf = (window: OwedWindow): number => window.series?.length ?? SERIES_COUNT;
      const typedPointAt = (start: number, series: string[]): OwedWindow => ({
        ...pointAt(start),
        series,
      });

      /** Runs the plan on a lane of `cap` calls; a window spends the calls `callsOf` gives it. */
      const keepsWith = async (walkPlan: WalkPlan, cap: number) => {
        let spent = 0;
        const seen: [number, WalkPass, number][] = [];

        await runWalkPlan({
          plan: walkPlan,
          callsOf,
          canAfford: (keep) => spent + keep < cap,
          runWindow: async (span, pass, keep) => {
            spent += callsOf(span);
            seen.push([span.start, pass, keep]);

            return ran(1, true);
          },
        });

        return seen;
      };

      it('keeps the calls of one read of every series for the re-scan, and the calls of the first point for the points', async () => {
        const seen = await keepsWith(
          planOf({
            pending: [owedAt(500)],
            points: [typedPointAt(900, ['A'])],
            rescan: [rescanWindow],
            rescanEnd: 300,
          }),
          60,
        );

        expect(seen).toEqual([
          [500, 'pending', SERIES_COUNT + 1],
          [200, 'rescan', 1],
          [900, 'pending', 0],
        ]);
      });

      it('keeps as many calls for the points as the first point to read costs', async () => {
        const seen = await keepsWith(
          planOf({ pending: [owedAt(500)], points: [typedPointAt(900, ['A', 'B', 'C'])] }),
          60,
        );

        expect(seen[0]).toEqual([500, 'pending', 3]);
      });

      it('does not enter an owed window when the calls it keeps and its other calls do not fit, though the first call would', async () => {
        const seen = await keepsWith(
          planOf({
            pending: [owedAt(500)],
            points: [typedPointAt(900, ['A'])],
            rescan: [rescanWindow],
            rescanEnd: 300,
          }),
          40,
        );

        expect(seen.map(([start, pass]) => [start, pass])).toEqual([
          [200, 'rescan'],
          [900, 'pending'],
        ]);
      });

      it('reads a point of one series on one call, and ends the points at a point of every series that does not fit', async () => {
        const seen = await keepsWith(
          planOf({
            points: [typedPointAt(900, ['A']), pointAt(950), typedPointAt(990, ['B'])],
            rescan: [rescanWindow],
            rescanEnd: 300,
          }),
          30,
        );

        expect(seen.map(([start]) => start)).toEqual([200, 900]);
      });

      it('reads a point of every series only when all its calls fit beside what it keeps', async () => {
        const fits = await keepsWith(planOf({ points: [pointAt(950)] }), SERIES_COUNT);
        const short = await keepsWith(planOf({ points: [pointAt(950)] }), SERIES_COUNT - 1);

        expect(fits).toHaveLength(1);
        expect(short).toHaveLength(0);
      });
    });

    it('reads a point in every run, whatever a dense re-scan and the owed windows would spend', async () => {
      const dense = Array.from({ length: 10 }, (_unused, index) => window(200 + index));

      const { seen } = await keepsOf(
        planOf({
          pending: [0, 500, 700].map(owedAt),
          points: [pointAt(1_100)],
          rescan: dense,
          rescanEnd: 300,
        }),
        4,
      );

      expect(seen.filter(([span]) => span.start === 1_100)).toHaveLength(1);
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
  const POINT_FIELD = 'binancePayPointCursor';

  type Write = [string, number | OwedGround[]];

  const markOf = (over: Partial<WalkMarks> = {}): WalkMarks => ({
    cursor: null,
    rescanCursor: null,
    pointCursor: null,
    rangeCursor: null,
    hints: NO_HINTS,
    pending: [],
    ...over,
  });

  const pointOf = (start: number, end: number): OwedGround => ({ start, end, kind: 'point' });

  const advance = async (
    pass: WalkPass,
    span: WalkWindow,
    marks: WalkMarks,
    walkPlan: WalkPlan = plan,
    owed: OwedGround[] = [],
  ) => {
    const writes: Write[] = [];

    await advanceWalkMarks({
      pass,
      span,
      owed,
      plan: walkPlan,
      marks,
      restartMs: RESTART_MS,
      fields: {
        cursor: FORWARD_FIELD,
        rescan: RESCAN_FIELD,
        point: POINT_FIELD,
        range: 'binancePayRangeCursor',
        hints: 'binancePaySpanHints',
        pending: PENDING_FIELD,
      },
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
    expect(marks).toEqual({
      cursor: 900,
      rescanCursor: 400,
      pointCursor: null,
      rangeCursor: null,
      hints: NO_HINTS,
      pending: [],
    });
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
    const day = { start: 70_000, end: 100_000 };
    const planned = planOf({ rescanEnd: 1_000_000, pendingRanges: [day] });

    it('stores the list before it moves the cursor, so a crash between the two loses nothing', async () => {
      const marks = markOf({ cursor: 100 });

      expect(await advance('forward', { start: 100, end: 400 }, marks, planned)).toEqual([
        [PENDING_FIELD, [day]],
        [FORWARD_FIELD, 400],
      ]);
      expect(marks).toEqual({
        cursor: 400,
        rescanCursor: null,
        pointCursor: null,
        rangeCursor: null,
        hints: NO_HINTS,
        pending: [day],
      });
    });

    it('stores the list once: the next forward span moves only the cursor', async () => {
      const marks = markOf({ cursor: 100 });
      await advance('forward', { start: 100, end: 400 }, marks, planned);

      expect(await advance('forward', { start: 400, end: 700 }, marks, planned)).toEqual([
        [FORWARD_FIELD, 700],
      ]);
    });

    it('stores the ground a forward span owes in the list, before it moves the cursor past it', async () => {
      const marks = markOf({ cursor: 100 });
      const point = pointOf(150_000, 150_002);

      expect(await advance('forward', { start: 100, end: 400 }, marks, planned, [point])).toEqual([
        [PENDING_FIELD, [day, point]],
        [FORWARD_FIELD, 400],
      ]);
      expect(marks.pending).toEqual([day, point]);
    });

    it('keeps what an earlier forward span owed in the list the next forward span stores', async () => {
      const marks = markOf({ cursor: 100 });
      const first = pointOf(150_000, 150_002);
      const second = pointOf(160_000, 160_002);
      await advance('forward', { start: 100, end: 400 }, marks, planned, [first]);

      expect(await advance('forward', { start: 400, end: 700 }, marks, planned, [second])).toEqual([
        [PENDING_FIELD, [day, first, second]],
        [FORWARD_FIELD, 700],
      ]);
    });

    it('stores the same ground once when two forward spans owe it', async () => {
      const marks = markOf({ cursor: 100 });
      const point = pointOf(150_000, 150_002);
      await advance('forward', { start: 100, end: 400 }, marks, planned, [point]);

      expect(await advance('forward', { start: 400, end: 700 }, marks, planned, [point])).toEqual([
        [FORWARD_FIELD, 700],
      ]);
    });

    it('stores nothing when the stored list already is the planned one', async () => {
      const marks = markOf({ cursor: 100, pending: [day] });

      expect(await advance('forward', { start: 100, end: 400 }, marks, planned)).toEqual([
        [FORWARD_FIELD, 400],
      ]);
    });

    it('takes the read ground out of the list when a re-scan span commits, before the mark', async () => {
      const marks = markOf({ cursor: 900, rescanCursor: 50_000, pending: [day] });

      expect(await advance('rescan', { start: 50_000, end: 85_000 }, marks, planned)).toEqual([
        [PENDING_FIELD, [{ start: 85_000, end: 100_000 }]],
        [RESCAN_FIELD, 85_000],
      ]);
      expect(marks.pending).toEqual([{ start: 85_000, end: 100_000 }]);
    });

    it('drops a range a re-scan span reads whole', async () => {
      const marks = markOf({
        cursor: 900,
        rescanCursor: 85_000,
        pending: [{ start: 85_000, end: 100_000 }],
      });

      expect(await advance('rescan', { start: 85_000, end: 1_000_000 }, marks, planned)).toEqual([
        [PENDING_FIELD, []],
        [RESCAN_FIELD, RESTART_MS],
      ]);
    });

    describe('with ground the span could not commit', () => {
      const point = pointOf(79_999, 80_001);

      it('puts the points back in the same write that takes the read ground out, in a pending span', async () => {
        const marks = markOf({ cursor: 900, pending: [day] });

        expect(
          await advance('pending', { start: 70_000, end: 100_000 }, marks, planned, [point]),
        ).toEqual([[PENDING_FIELD, [point]]]);
        expect(marks.pending).toEqual([point]);
      });

      it('writes no list when the span owes exactly the ground it read', async () => {
        const marks = markOf({ cursor: 900, pending: [point] });

        expect(await advance('pending', point, marks, planned, [point])).toEqual([]);
      });

      it('puts the points back before the mark moves in a re-scan span, so a stuck record is never passed unowed', async () => {
        const marks = markOf({ cursor: 900, rescanCursor: 50_000, pending: [] });

        expect(
          await advance('rescan', { start: 50_000, end: 90_000 }, marks, planned, [point]),
        ).toEqual([
          [PENDING_FIELD, [point]],
          [RESCAN_FIELD, 90_000],
        ]);
      });

      describe('beside a range that is longer than a point', () => {
        const range = { start: 10_000, end: 50_000 };
        const span = { start: 10_000, end: 30_000 };

        it('keeps a point beside what is left of the range, and never merges the two', async () => {
          const marks = markOf({ cursor: 90_000, pending: [range] });
          const inSpan = pointOf(19_999, 20_001);

          await advance('pending', span, marks, planned, [inSpan]);

          expect(marks.pending).toEqual([inSpan, { start: 30_000, end: 50_000 }]);
        });

        it('puts the whole span back, joined to what is left, when that is what is owed', async () => {
          const marks = markOf({ cursor: 90_000, pending: [range] });

          await advance('pending', span, marks, planned, [span]);

          expect(marks.pending).toEqual([range]);
        });
      });

      it('stores what a forward span owes (only a code the forward pass owes reaches it, see commitSettledSpan), before the cursor', async () => {
        const marks = markOf({ cursor: 100 });

        expect(await advance('forward', { start: 100, end: 400 }, marks, plan, [point])).toEqual([
          [PENDING_FIELD, [point]],
          [FORWARD_FIELD, 400],
        ]);
      });
    });

    it('takes the ground a pending span reads out of the list and moves no mark', async () => {
      const marks = markOf({ cursor: 900, pending: [day] });

      expect(await advance('pending', { start: 70_000, end: 90_000 }, marks, planned)).toEqual([
        [PENDING_FIELD, [{ start: 90_000, end: 100_000 }]],
      ]);
      expect(marks.cursor).toBe(900);
      expect(marks.rescanCursor).toBeNull();
    });

    it('splits a range in two when a span in its middle commits', async () => {
      const marks = markOf({ cursor: 900, pending: [day] });

      expect(await advance('pending', { start: 80_000, end: 90_000 }, marks, planned)).toEqual([
        [
          PENDING_FIELD,
          [
            { start: 70_000, end: 80_000 },
            { start: 90_000, end: 100_000 },
          ],
        ],
      ]);
    });

    it('writes no list when the span reads none of it', async () => {
      const marks = markOf({ cursor: 900, pending: [day] });

      expect(await advance('pending', { start: 200, end: 300 }, marks, planned)).toEqual([]);
    });

    describe('with a point on the list', () => {
      const point = pointOf(79_999, 80_001);
      const whole = { start: 70_000, end: 90_000 };

      it('keeps a point whatever the span holds of it: only a window that completed takes a point off (dropReadPoints)', async () => {
        const marks = markOf({ cursor: 900, pending: [point] });

        expect(await advance('pending', whole, marks, planned)).toEqual([]);
        expect(marks.pending).toEqual([point]);
      });

      it('keeps a point beside what is left of a range when the read returned no record for it', async () => {
        const marks = markOf({ cursor: 900, pending: [day, point] });

        await advance('pending', whole, marks, planned);

        expect(marks.pending).toEqual([point, { start: 90_000, end: 100_000 }]);
      });

      it('leaves a point whole that a span only reaches into when the read returned nothing for it', async () => {
        const marks = markOf({ cursor: 900, pending: [point] });

        expect(await advance('pending', { start: 70_000, end: 80_000 }, marks, planned)).toEqual(
          [],
        );
        expect(marks.pending).toEqual([point]);
      });

      it('writes no list when a read of the point finds its record stuck again', async () => {
        const marks = markOf({ cursor: 900, pending: [point] });

        expect(await advance('pending', point, marks, planned, [point])).toEqual([]);
      });

      it('keeps a point a re-scan span passes, and moves only the mark', async () => {
        const marks = markOf({ cursor: 900, rescanCursor: 50_000, pending: [point] });

        expect(await advance('rescan', { start: 50_000, end: 90_000 }, marks, planned)).toEqual([
          [RESCAN_FIELD, 90_000],
        ]);
        expect(marks.pending).toEqual([point]);
      });
    });

    describe('with a short range on the list: a sliver is a range, never a point', () => {
      const sliver = { start: 79_990, end: 79_995 };
      const whole = { start: 70_000, end: 90_000 };

      it('takes a range off the list once a read holds all of it, though the read returned no record', async () => {
        const marks = markOf({ cursor: 900, pending: [sliver] });

        expect(await advance('pending', whole, marks, planned)).toEqual([[PENDING_FIELD, []]]);
      });

      it('takes a range as short as a point off the list on a re-scan read that returned nothing', async () => {
        const marks = markOf({
          cursor: 900,
          rescanCursor: 50_000,
          pending: [{ start: 1, end: 3 }],
        });

        expect(await advance('rescan', { start: 0, end: 90_000 }, marks, planned)).toEqual([
          [PENDING_FIELD, []],
          [RESCAN_FIELD, 90_000],
        ]);
      });

      it('leaves the point beside a range of the same window, and the range goes', async () => {
        const range = { start: 79_999, end: 80_001 };
        const point = pointOf(79_999, 80_001);
        const marks = markOf({ cursor: 900, pending: [range, point] });

        await advance('pending', whole, marks, planned);

        expect(marks.pending).toEqual([point]);
      });

      it('leaves a point that lies inside a range the read took off, never dropping it with the range', async () => {
        const marks = markOf({
          cursor: 900,
          pending: [{ start: 70_000, end: 90_000 }, pointOf(80_000, 80_002)],
        });

        await advance('pending', whole, marks, planned);

        expect(marks.pending).toEqual([pointOf(80_000, 80_002)]);
      });
    });
  });
});

describe('dropReadPoints', () => {
  const FIELDS = {
    cursor: 'binancePayHistoryCursor',
    rescan: 'binancePayRescanCursor',
    point: 'binancePayPointCursor',
    range: 'binancePayRangeCursor',
    hints: 'binancePaySpanHints',
    pending: 'binancePayPendingOverlap',
  } as const;

  const pointOf = (start: number, end: number): OwedGround => ({ start, end, kind: 'point' });
  const point = pointOf(79_999, 80_001);
  const whole = { start: 70_000, end: 90_000 };

  const drop = async (input: {
    pending: OwedGround[];
    read: OwedGround[];
    window?: WalkWindow;
    pass?: WalkPass;
  }) => {
    const { pending, read, window = whole, pass = 'pending' } = input;
    const marks: WalkMarks = {
      cursor: 900,
      rescanCursor: null,
      pointCursor: null,
      rangeCursor: null,
      hints: NO_HINTS,
      pending,
    };
    const writes: [string, OwedGround[]][] = [];

    await dropReadPoints({
      pass,
      window,
      read,
      marks,
      fields: FIELDS,
      writePending: async (field, ranges) => {
        writes.push([field, ranges]);
      },
    });

    return { marks, writes };
  };

  it('takes a point off the list when the window holds all of it and a returned record owes exactly it, in one write', async () => {
    const { marks, writes } = await drop({ pending: [point], read: [point] });

    expect(writes).toEqual([[FIELDS.pending, []]]);
    expect(marks.pending).toEqual([]);
  });

  it('keeps a point, and writes nothing, when the window returned no record that owes it: it fails closed', async () => {
    const { marks, writes } = await drop({ pending: [point], read: [] });

    expect(writes).toEqual([]);
    expect(marks.pending).toEqual([point]);
  });

  it.each([
    ['a neighbour a few ms away', pointOf(80_099, 80_101)],
    ['a record whose point is wider', pointOf(79_999, 81_000)],
    ['a record whose point is narrower', pointOf(79_999, 80_000)],
    ['a record whose point starts later', pointOf(80_000, 80_002)],
  ])(
    'keeps a point when the window returned only %s: Binance may filter on another field',
    async (_label, other) => {
      const { marks, writes } = await drop({ pending: [point], read: [other] });

      expect(writes).toEqual([]);
      expect(marks.pending).toEqual([point]);
    },
  );

  it('keeps every point no returned record owes, and takes off only the one that one does', async () => {
    const other = pointOf(75_000, 75_002);

    const { marks } = await drop({ pending: [other, point], read: [point] });

    expect(marks.pending).toEqual([other]);
  });

  it.each([
    ['its start', { start: 70_000, end: 80_000 }],
    ['its end', { start: 80_000, end: 90_000 }],
  ])(
    'keeps a point whole when the window only reaches into it at %s, though a returned record owes it: the rest of its second is unread',
    async (_label, window) => {
      const { marks, writes } = await drop({ pending: [point], read: [point], window });

      expect(writes).toEqual([]);
      expect(marks.pending).toEqual([point]);
    },
  );

  it('takes off only the narrower of two points that start together when only its record was returned', async () => {
    const narrow = pointOf(79_999, 80_001);
    const wide = pointOf(79_999, 81_000);

    const { marks } = await drop({ pending: [narrow, wide], read: [narrow] });

    expect(marks.pending).toEqual([wide]);
  });

  it('never takes a range off the list: the span writes ranges, as it reads them', async () => {
    const range = { start: 75_000, end: 85_000 };

    const { marks, writes } = await drop({ pending: [range, point], read: [point] });

    expect(writes).toEqual([[FIELDS.pending, [range]]]);
    expect(marks.pending).toEqual([range]);
  });

  it('leaves the list alone for a window of the forward pass, which writes the list as the cursor moves', async () => {
    const { marks, writes } = await drop({ pending: [point], read: [point], pass: 'forward' });

    expect(writes).toEqual([]);
    expect(marks.pending).toEqual([point]);
  });

  describe('typed points', () => {
    const typed = (series: string): OwedGround => ({ ...point, series });

    it('takes off only the point of the series a returned record owes, not the point of another series at the very same window', async () => {
      const { marks } = await drop({
        pending: [typed('MAIN_FUNDING'), typed('FUNDING_MAIN')],
        read: [typed('FUNDING_MAIN')],
      });

      expect(marks.pending).toEqual([typed('MAIN_FUNDING')]);
    });

    it('keeps a typed point when the window returned a record of the same window and no series', async () => {
      const { marks, writes } = await drop({ pending: [typed('MAIN_FUNDING')], read: [point] });

      expect(writes).toEqual([]);
      expect(marks.pending).toEqual([typed('MAIN_FUNDING')]);
    });

    it('keeps a point with no series when the window returned a record of the same window in a series', async () => {
      const { marks, writes } = await drop({ pending: [point], read: [typed('MAIN_FUNDING')] });

      expect(writes).toEqual([]);
      expect(marks.pending).toEqual([point]);
    });

    it('takes off a typed point whose window was read whole when a record of its own series came back', async () => {
      const { marks, writes } = await drop({
        pending: [typed('MAIN_FUNDING')],
        read: [typed('MAIN_FUNDING')],
      });

      expect(writes).toEqual([[FIELDS.pending, []]]);
      expect(marks.pending).toEqual([]);
    });
  });
});

describe('distinctGround', () => {
  it('keeps the first of every repeated entry, and tells a point from a range of the same window', () => {
    const range = { start: 1, end: 3 };
    const point: OwedGround = { start: 1, end: 3, kind: 'point' };

    expect(distinctGround([range, point, { ...range }, { ...point }])).toEqual([range, point]);
  });

  it('tells two points of one window apart by their series, and keeps a repeat of one series once', () => {
    const base = { start: 1, end: 3, kind: 'point' as const };
    const first: OwedGround = { ...base, series: 'MAIN_FUNDING' };
    const second: OwedGround = { ...base, series: 'FUNDING_MAIN' };

    expect(distinctGround([first, second, { ...first }, base, { ...base }])).toEqual([
      first,
      second,
      base,
    ]);
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

  const readMark = (
    metadata: unknown,
    owedIfUnreadable = owedBefore,
    knownSeries?: readonly string[],
  ) => {
    const write = jest.fn(async (_field: string, _ranges: WalkWindow[]) => undefined);

    return {
      write,
      ranges: readPendingMark({ field: FIELD, metadata, owedIfUnreadable, knownSeries, write }),
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

  describe('for a walk of several series', () => {
    const KNOWN = ['MAIN_FUNDING', 'FUNDING_MAIN'];
    const typedPoint = { start: 10, end: 12, kind: 'point', series: 'MAIN_FUNDING' };
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warn.mockRestore();
    });

    it('reads a list whose points all name a known series, and writes nothing', async () => {
      const stored = [{ start: 1, end: 2 }, typedPoint];
      const { ranges, write } = readMark({ [FIELD]: stored }, owedBefore, KNOWN);

      expect(await ranges).toEqual(stored);
      expect(write).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });

    it.each([
      ['a point of a series the walk does not know', { ...typedPoint, series: 'MAIN_MARS' }],
      ['a point that names no series', { start: 10, end: 12, kind: 'point' }],
    ])('repairs the list like a malformed one for %s', async (_label, stray) => {
      const { ranges, write } = readMark({ [FIELD]: [typedPoint, stray] }, owedBefore, KNOWN);

      expect(await ranges).toEqual([owedBefore]);
      expect(write).toHaveBeenCalledWith(FIELD, [owedBefore]);
      expect(warn).toHaveBeenCalledWith('[binance sync] pending overlap ranges unreadable', {
        name: 'BinanceWalkStop',
        code: 'pending-malformed',
      });
    });

    it('repairs a typed point in the list of a walk that has no series: it could never leave', async () => {
      const { ranges, write } = readMark({ [FIELD]: [typedPoint] });

      expect(await ranges).toEqual([owedBefore]);
      expect(write).toHaveBeenCalledWith(FIELD, [owedBefore]);
    });
  });
});

describe('readPointCursor', () => {
  const FIELD = 'binancePayPointCursor';
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const readCursor = (metadata: unknown) => {
    const write = jest.fn(async (_field: string, _cursorMs: number) => undefined);

    return { write, cursor: readPointCursor({ field: FIELD, metadata, write }) };
  };

  it('reads the stored cursor of one walk, and writes nothing', async () => {
    const { cursor, write } = readCursor({ [FIELD]: 5_000 });

    expect(await cursor).toBe(5_000);
    expect(write).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('starts at the oldest point (null) with nothing stored, and logs and writes nothing', async () => {
    const first = readCursor({ binanceAsset: 'BTC' });
    const second = readCursor(null);

    expect(await first.cursor).toBeNull();
    expect(await second.cursor).toBeNull();
    expect(first.write).not.toHaveBeenCalled();
    expect(second.write).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  describe('for a stored value that is no number', () => {
    const malformed = [
      ['text', '5000'],
      ['not a finite number', Number.NaN],
      ['null', null],
      ['a list', [1]],
    ] as const;

    it.each(malformed)(
      'starts before every point, logging one fixed code and never throwing, for %s',
      async (_label, value) => {
        const { cursor } = readCursor({ [FIELD]: value });

        expect(await cursor).toBe(Number.MIN_SAFE_INTEGER);
        expect(warn.mock.calls).toEqual([
          [
            '[binance sync] point cursor unreadable',
            { name: 'BinanceWalkStop', code: 'point-cursor-malformed' },
          ],
        ]);
      },
    );

    it.each(malformed)(
      'repairs it at once, storing that start, so the next run reads a number: %s',
      async (_label, value) => {
        const { cursor, write } = readCursor({ [FIELD]: value });

        await cursor;

        expect(write).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenCalledWith(FIELD, Number.MIN_SAFE_INTEGER);
      },
    );

    it('is read as a number by the next run, which logs nothing', async () => {
      const first = readCursor({ [FIELD]: 'x' });
      const stored = await first.cursor;
      warn.mockClear();

      const next = readCursor({ [FIELD]: stored });

      expect(await next.cursor).toBe(Number.MIN_SAFE_INTEGER);
      expect(next.write).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });
  });
});

describe('storePointCursor', () => {
  const FIELD = 'binanceHistoryPointCursor';
  const marksOf = (pointCursor: number | null): WalkMarks => ({
    cursor: null,
    rescanCursor: null,
    pointCursor,
    rangeCursor: null,
    hints: NO_HINTS,
    pending: [],
  });

  it('stores the start of the point that was read, and keeps it in the marks', async () => {
    const marks = marksOf(null);
    const write = jest.fn(async (_field: string, _cursorMs: number) => undefined);

    await storePointCursor({ window: { start: 700, end: 702 }, marks, field: FIELD, write });

    expect(write).toHaveBeenCalledWith(FIELD, 700);
    expect(marks.pointCursor).toBe(700);
  });

  it('writes nothing when that start already is the stored cursor', async () => {
    const write = jest.fn(async (_field: string, _cursorMs: number) => undefined);

    await storePointCursor({
      window: { start: 700, end: 702 },
      marks: marksOf(700),
      field: FIELD,
      write,
    });

    expect(write).not.toHaveBeenCalled();
  });
});

describe('readRangeCursor', () => {
  const FIELD = 'binancePayRangeCursor';
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const readCursor = (metadata: unknown) => {
    const write = jest.fn(async (_field: string, _cursorMs: number) => undefined);

    return { write, cursor: readRangeCursor({ field: FIELD, metadata, write }) };
  };

  it('reads the stored cursor of one walk, and writes nothing', async () => {
    const { cursor, write } = readCursor({ [FIELD]: 5_000 });

    expect(await cursor).toBe(5_000);
    expect(write).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('starts at the oldest range (null) with nothing stored, and logs and writes nothing', async () => {
    const first = readCursor({ binanceAsset: 'BTC' });
    const second = readCursor(null);

    expect(await first.cursor).toBeNull();
    expect(await second.cursor).toBeNull();
    expect(first.write).not.toHaveBeenCalled();
    expect(second.write).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  describe.each([
    ['text', '5000'],
    ['not a finite number', Number.NaN],
    ['null', null],
    ['a list', [1]],
  ])('for a stored value that is %s', (_label, value) => {
    it('starts before every range, logging one fixed code and never throwing', async () => {
      const { cursor } = readCursor({ [FIELD]: value });

      expect(await cursor).toBe(Number.MIN_SAFE_INTEGER);
      expect(warn.mock.calls).toEqual([
        [
          '[binance sync] range cursor unreadable',
          { name: 'BinanceWalkStop', code: 'range-cursor-malformed' },
        ],
      ]);
    });

    it('repairs it at once, storing that start, so the next run reads a number', async () => {
      const { cursor, write } = readCursor({ [FIELD]: value });

      await cursor;

      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith(FIELD, Number.MIN_SAFE_INTEGER);
    });
  });
});

describe('storeRangeCursor', () => {
  const FIELD = 'binanceHistoryRangeCursor';
  const marksOf = (rangeCursor: number | null): WalkMarks => ({
    cursor: null,
    rescanCursor: null,
    pointCursor: null,
    rangeCursor,
    hints: NO_HINTS,
    pending: [],
  });

  it('stores the end of the window that was read, and keeps it in the marks', async () => {
    const marks = marksOf(null);
    const write = jest.fn(async (_field: string, _cursorMs: number) => undefined);

    await storeRangeCursor({ window: { start: 700, end: 760 }, marks, field: FIELD, write });

    expect(write).toHaveBeenCalledWith(FIELD, 760);
    expect(marks.rangeCursor).toBe(760);
  });

  it('writes nothing when that end already is the stored cursor', async () => {
    const write = jest.fn(async (_field: string, _cursorMs: number) => undefined);

    await storeRangeCursor({
      window: { start: 700, end: 760 },
      marks: marksOf(760),
      field: FIELD,
      write,
    });

    expect(write).not.toHaveBeenCalled();
  });
});

describe('readSpanHints', () => {
  const FIELD = 'binancePaySpanHints';
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const readHints = (metadata: unknown) => {
    const write = jest.fn(async (_field: string, _hints: unknown) => undefined);

    return { write, hints: readSpanHints({ field: FIELD, metadata, write }) };
  };

  it('reads the stored hints of one walk, and writes nothing', async () => {
    const stored = { ...NO_HINTS, rescan: [{ start: 1, end: 5 }] };
    const { hints, write } = readHints({ [FIELD]: stored });

    expect(await hints).toEqual(stored);
    expect(write).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('is no hint with nothing stored, and logs and writes nothing', async () => {
    const first = readHints({ binanceAsset: 'BTC' });
    const second = readHints(null);

    expect(await first.hints).toEqual(NO_HINTS);
    expect(await second.hints).toEqual(NO_HINTS);
    expect(first.write).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  describe.each([
    ['text', 'x'],
    ['a list', [1]],
    ['a pass that is no list', { forward: 3 }],
    ['an entry that ends before it starts', { point: [{ start: 5, end: 1 }] }],
  ])('for a stored value that is %s', (_label, value) => {
    it('ignores it, logging one fixed code and never throwing', async () => {
      const { hints } = readHints({ [FIELD]: value });

      expect(await hints).toEqual(NO_HINTS);
      expect(warn.mock.calls).toEqual([
        [
          '[binance sync] span hints unreadable',
          { name: 'BinanceWalkStop', code: 'span-hints-malformed' },
        ],
      ]);
    });

    it('repairs it at once, storing no hint, so the next run logs nothing', async () => {
      const { hints, write } = readHints({ [FIELD]: value });

      await hints;

      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith(FIELD, NO_HINTS);
    });
  });
});

describe('storeSpanHints', () => {
  const FIELD = 'binanceTransferSpanHints';

  it('stores the hints and keeps them in the marks', async () => {
    const marks: WalkMarks = {
      cursor: null,
      rescanCursor: null,
      pointCursor: null,
      rangeCursor: null,
      hints: NO_HINTS,
      pending: [],
    };
    const write = jest.fn(async (_field: string, _hints: unknown) => undefined);
    const next = { ...NO_HINTS, forward: [{ start: 1, end: 2 }] };

    await storeSpanHints({ hints: next, marks, field: FIELD, write });

    expect(write).toHaveBeenCalledWith(FIELD, next);
    expect(marks.hints).toEqual(next);
  });
});

describe('the round-robins and hints of a walk', () => {
  const FIELDS = {
    cursor: 'binancePayHistoryCursor',
    rescan: 'binancePayRescanCursor',
    point: 'binancePayPointCursor',
    range: 'binancePayRangeCursor',
    hints: 'binancePaySpanHints',
    pending: 'binancePayPendingOverlap',
  } as const;
  const marksOf = (): WalkMarks => ({
    cursor: null,
    rescanCursor: null,
    pointCursor: null,
    rangeCursor: null,
    hints: NO_HINTS,
    pending: [],
  });
  const writers = () => ({
    writeCursor: jest.fn(async (_field: string, _cursorMs: number) => undefined),
    writeHints: jest.fn(async (_field: string, _hints: BinanceSpanHints) => undefined),
  });

  it('reads each of the three marks of the walk from its own key', async () => {
    const stored = { ...NO_HINTS, point: [{ start: 1, end: 3 }] };

    const read = await readWalkRoundRobins({
      fields: FIELDS,
      metadata: {
        binancePayPointCursor: 5,
        binancePayRangeCursor: 9,
        binancePaySpanHints: stored,
      },
      ...writers(),
    });

    expect(read).toEqual({ pointCursor: 5, rangeCursor: 9, hints: stored });
  });

  it('writes a repair for each mark through its own writer', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { writeCursor, writeHints } = writers();

    await readWalkRoundRobins({
      fields: FIELDS,
      metadata: {
        binancePayPointCursor: 'x',
        binancePayRangeCursor: 'y',
        binancePaySpanHints: 'z',
      },
      writeCursor,
      writeHints,
    });

    expect(writeCursor.mock.calls).toEqual([
      ['binancePayPointCursor', Number.MIN_SAFE_INTEGER],
      ['binancePayRangeCursor', Number.MIN_SAFE_INTEGER],
    ]);
    expect(writeHints.mock.calls).toEqual([['binancePaySpanHints', NO_HINTS]]);
    warn.mockRestore();
  });

  it('marks a point by its start and a range by its end, each in its own field, and stores hints in theirs', async () => {
    const marks = marksOf();
    const { writeCursor, writeHints } = writers();
    const hooks = roundRobinHooksOf({ marks, fields: FIELDS, writeCursor, writeHints });
    const next = { ...NO_HINTS, rescan: [{ start: 4, end: 6 }] };

    await hooks.markPointRead({ start: 10, end: 20 });
    await hooks.markRangeRead({ start: 30, end: 40 });
    await hooks.hints.store(next);

    expect(writeCursor.mock.calls).toEqual([
      ['binancePayPointCursor', 10],
      ['binancePayRangeCursor', 40],
    ]);
    expect(writeHints.mock.calls).toEqual([['binancePaySpanHints', next]]);
    expect(marks).toMatchObject({ pointCursor: 10, rangeCursor: 40, hints: next });
  });

  it('hands runWalkPlan the hints the marks hold', () => {
    const marks = { ...marksOf(), hints: { ...NO_HINTS, forward: [{ start: 1, end: 2 }] } };

    const hooks = roundRobinHooksOf({ marks, fields: FIELDS, ...writers() });

    expect(hooks.hints.stored).toEqual(marks.hints);
  });
});

describe('runWalkPlan with the range cursor', () => {
  const ran = (started = true): WindowOutcome => ({
    imported: 0,
    complete: true,
    owed: false,
    started,
  });
  const span = (start: number, end = start + 10): WalkWindow => ({ start, end });

  it('marks each pending window once its read has started, in the order they are read, and no other window', async () => {
    const events: string[] = [];

    await runWalkPlan({
      plan: planOf({
        forward: [span(0)],
        pending: [span(20), span(40, 55)],
        points: [span(60)],
        rescan: [span(80)],
      }),
      canAfford: () => true,
      runWindow: async (window, pass) => {
        events.push(`read:${window.start}:${pass}`);

        return ran();
      },
      markPointRead: async (window) => {
        events.push(`point:${window.start}`);
      },
      markRangeRead: async (window) => {
        events.push(`range:${window.start}:${window.end}`);
      },
    });

    expect(events).toEqual([
      'read:0:forward',
      'read:20:pending',
      'range:20:30',
      'read:40:pending',
      'range:40:55',
      'read:80:rescan',
      'read:60:pending',
      'point:60',
    ]);
  });

  it('marks a pending window whose read did not finish, and none whose read never started', async () => {
    const marked: number[] = [];

    await runWalkPlan({
      plan: planOf({ pending: [span(1), span(2), span(3)] }),
      canAfford: () => true,
      runWindow: async (window) => ({
        imported: 0,
        complete: false,
        owed: true,
        started: window.start !== 2,
      }),
      markRangeRead: async (window) => {
        marked.push(window.start);
      },
    });

    expect(marked).toEqual([1, 3]);
  });

  it('marks no window the budget skipped', async () => {
    let calls = 1;
    const marked: number[] = [];

    await runWalkPlan({
      plan: planOf({ pending: [span(1), span(2)] }),
      canAfford: () => {
        calls -= 1;

        return calls >= 0;
      },
      runWindow: async () => ran(),
      markRangeRead: async (window) => {
        marked.push(window.start);
      },
    });

    expect(marked).toEqual([1]);
  });
});

describe('runWalkPlan with span hints', () => {
  const span = (start: number, end = start + 100): WalkWindow => ({ start, end });
  const outcome = (over: Partial<WindowOutcome> = {}): WindowOutcome => ({
    imported: 0,
    complete: false,
    owed: false,
    started: true,
    ...over,
  });
  const hintsOf = (over: Partial<BinanceSpanHints> = {}): BinanceSpanHints => ({
    ...NO_HINTS,
    ...over,
  });
  type RunWindow = (
    window: OwedWindow,
    pass: WalkPass,
    keep: number,
    hint?: WalkWindow,
  ) => Promise<WindowOutcome>;
  const run = (input: { plan: WalkPlan; stored?: BinanceSpanHints; runWindow: RunWindow }) => {
    const store = jest.fn(async (_next: BinanceSpanHints) => undefined);

    return {
      store,
      done: runWalkPlan({
        plan: input.plan,
        canAfford: () => true,
        runWindow: input.runWindow,
        hints: { stored: input.stored ?? NO_HINTS, store },
      }),
    };
  };

  it('gives a window the hint of its pass that starts where the window starts, and no other', async () => {
    const given: [number, string, WalkWindow | undefined][] = [];

    await run({
      plan: planOf({ forward: [span(0)], pending: [span(200), span(300)], rescan: [span(500)] }),
      stored: hintsOf({
        forward: [span(0, 40)],
        pending: [span(300, 330), span(250, 260)],
        rescan: [span(501, 510)],
      }),
      runWindow: async (window, pass, _keep, hint) => {
        given.push([window.start, pass, hint]);

        return outcome();
      },
    }).done;

    expect(given).toEqual([
      [0, 'forward', span(0, 40)],
      [200, 'pending', undefined],
      [300, 'pending', span(300, 330)],
      [500, 'rescan', undefined],
    ]);
  });

  it('gives a point window the hint of the points, not that of the pending pass', async () => {
    const given: [string, WalkWindow | undefined][] = [];

    await run({
      plan: planOf({ pending: [span(7)], points: [span(7, 9)] }),
      stored: hintsOf({ pending: [span(7, 8)], point: [span(7, 8)] }),
      runWindow: async (window, pass, _keep, hint) => {
        given.push([`${window.end}:${pass}`, hint]);

        return outcome();
      },
    }).done;

    expect(given).toEqual([
      ['107:pending', span(7, 8)],
      ['9:pending', span(7, 8)],
    ]);
  });

  it('keeps the hint of a pass apart from the other passes: a pending hint is not a point hint', async () => {
    const given: (WalkWindow | undefined)[] = [];

    await run({
      plan: planOf({ points: [span(7, 9)] }),
      stored: hintsOf({ pending: [span(7, 8)] }),
      runWindow: async (_window, _pass, _keep, hint) => {
        given.push(hint);

        return outcome();
      },
    }).done;

    expect(given).toEqual([undefined]);
  });

  it('stores the span a window was left at, in the list of its own pass', async () => {
    const { store, done } = run({
      plan: planOf({ forward: [span(0)], rescan: [span(500)] }),
      runWindow: async (window) => outcome({ hint: span(window.start, window.start + 25) }),
    });

    await done;

    expect(store).toHaveBeenLastCalledWith(
      hintsOf({ forward: [span(0, 25)], rescan: [span(500, 525)] }),
    );
  });

  it('keeps the hints of two passes cut short in one run: neither overwrites the other', async () => {
    const { store, done } = run({
      plan: planOf({ forward: [span(0)], rescan: [span(500)] }),
      runWindow: async (window, pass) =>
        outcome({ hint: span(window.start, window.start + (pass === 'forward' ? 25 : 30)) }),
    });

    await done;

    const last = store.mock.calls.at(-1)?.[0];
    expect(last?.forward).toEqual([span(0, 25)]);
    expect(last?.rescan).toEqual([span(500, 530)]);
  });

  it('keeps the hints of several windows of one pass, one for each start', async () => {
    const { store, done } = run({
      plan: planOf({ pending: [span(10), span(300)] }),
      stored: hintsOf({ pending: [span(10, 20)] }),
      runWindow: async (window) =>
        outcome({ hint: window.start === 300 ? span(300, 310) : span(10, 15) }),
    });

    await done;

    expect(store.mock.calls.at(-1)?.[0].pending).toEqual([span(10, 15), span(300, 310)]);
  });

  it('drops the hint of a window whose outcome says no span is left to resume', async () => {
    const { store, done } = run({
      plan: planOf({ rescan: [span(500), span(900)] }),
      stored: hintsOf({ rescan: [span(500, 520), span(900, 910)] }),
      runWindow: async (window) => outcome(window.start === 500 ? { hint: null } : {}),
    });

    await done;

    expect(store.mock.calls.at(-1)?.[0].rescan).toEqual([span(900, 910)]);
  });

  it('drops a stored hint no window of its pass starts at any more, once, before it reads', async () => {
    const order: string[] = [];
    const store = jest.fn(async (next: BinanceSpanHints) => {
      order.push(
        `store:${[next.forward, next.pending, next.rescan, next.point].map((list) => list.length).join('')}`,
      );
    });

    await runWalkPlan({
      plan: planOf({ forward: [span(0)], pending: [span(200)] }),
      canAfford: () => true,
      runWindow: async (window) => {
        order.push(`read:${window.start}`);

        return outcome();
      },
      hints: {
        stored: hintsOf({
          forward: [span(0, 10)],
          pending: [span(201, 210)],
          rescan: [span(500, 510)],
          point: [span(0, 5)],
        }),
        store,
      },
    });

    expect(order).toEqual(['store:1000', 'read:0', 'read:200']);
  });

  it('stores nothing when no hint changed', async () => {
    const { store, done } = run({
      plan: planOf({ forward: [span(0)] }),
      stored: hintsOf({ forward: [span(0, 10)] }),
      runWindow: async () => outcome({ hint: span(0, 10) }),
    });

    await done;

    expect(store).not.toHaveBeenCalled();
  });

  it('stores the hint of a point window under the points', async () => {
    const { store, done } = run({
      plan: planOf({ points: [span(7, 9)] }),
      runWindow: async () => outcome({ hint: span(7, 8) }),
    });

    await done;

    expect(store.mock.calls.at(-1)?.[0]).toEqual(hintsOf({ point: [span(7, 8)] }));
  });

  it('reads as before when no hints are given', async () => {
    const seen: (WalkWindow | undefined)[] = [];

    await runWalkPlan({
      plan: planOf({ forward: [span(0)] }),
      canAfford: () => true,
      runWindow: async (_window, _pass, _keep, hint) => {
        seen.push(hint);

        return outcome({ hint: span(0, 5) });
      },
    });

    expect(seen).toEqual([undefined]);
  });
});

describe('walkSpans', () => {
  const window = { start: 0, end: 100 };
  const WIDEST_PAGE = 25;

  /** A read that finds any span wider than a page too full, and a page of the span otherwise. */
  const readByWidth = () =>
    jest.fn(
      async (span: WalkWindow, _keep?: number): Promise<SpanRead<WalkWindow> | undefined> =>
        span.end - span.start > WIDEST_PAGE
          ? { kind: 'split', half: halfOf(span) as WalkWindow }
          : { kind: 'page', page: span },
    );

  const commitCount = (count: number, committed: WalkWindow[] = [], owed = false) =>
    jest.fn(async (span: WalkWindow, _page: WalkWindow): Promise<SpanCommit | undefined> => {
      committed.push(span);

      return { imported: count, owed, returned: [], stuck: [] };
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

  it('passes the calls to keep to every read of the window, none by default', async () => {
    const kept = readByWidth();
    const byDefault = readByWidth();

    await walkSpans({ window, read: kept, commit: commitCount(1), keep: 3 });
    await walkSpans({ window, read: byDefault, commit: commitCount(1) });

    expect(kept.mock.calls.length).toBeGreaterThan(1);
    expect(kept.mock.calls.every(([, keep]) => keep === 3)).toBe(true);
    expect(byDefault.mock.calls.every(([, keep]) => keep === 0)).toBe(true);
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
    expect(result).toEqual({
      imported: 8,
      complete: true,
      owed: false,
      started: true,
      hint: null,
    });
  });

  it('hands the commit the page the read gave for that span', async () => {
    const commit = jest.fn(
      async (_span: WalkWindow, _page: string): Promise<SpanCommit> => ({
        imported: 0,
        owed: false,
        returned: [],
        stuck: [],
      }),
    );

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

    const result = await walkSpans({
      window,
      read,
      commit: commitCount(3, committed),
    });

    expect(read).toHaveBeenCalledTimes(3);
    expect(committed).toEqual([half]);
    expect(result).toEqual({
      imported: 3,
      complete: false,
      owed: false,
      started: true,
      hint: null,
    });
  });

  it('stops, reading no further span, when the commit gives up', async () => {
    const read = readByWidth();
    const commit = jest.fn(async () => undefined);

    const result = await walkSpans({ window, read, commit });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      imported: 0,
      complete: false,
      owed: false,
      started: true,
      hint: { start: 0, end: 25 },
    });
  });

  describe('with a span that left ground owed', () => {
    it('goes on to the next span, and reports the window as one that left ground owed', async () => {
      const committed: WalkWindow[] = [];
      const commit = jest.fn(async (span: WalkWindow, _page: WalkWindow): Promise<SpanCommit> => {
        committed.push(span);

        return { imported: 1, owed: span.start === 25, returned: [], stuck: [] };
      });

      const result = await walkSpans({ window, read: readByWidth(), commit });

      expect(committed).toHaveLength(4);
      expect(result).toEqual({
        imported: 4,
        complete: true,
        owed: true,
        started: true,
        hint: null,
      });
    });

    it('is not owed when no span left ground owed', async () => {
      const result = await walkSpans({ window, read: readByWidth(), commit: commitCount(1) });

      expect(result.owed).toBe(false);
    });

    it('keeps what it found owed when the read gives up after it', async () => {
      const half = { start: 0, end: 50 };
      const reads = [
        { kind: 'split' as const, half },
        { kind: 'page' as const, page: half },
        undefined,
      ];

      const result = await walkSpans({
        window,
        read: jest.fn(async () => reads.shift()),
        commit: commitCount(2, [], true),
      });

      expect(result).toEqual({
        imported: 2,
        complete: false,
        owed: true,
        started: true,
        hint: null,
      });
    });
  });

  it('is complete, reading nothing, for a window with no width', async () => {
    const read = readByWidth();

    const result = await walkSpans({
      window: { start: 5, end: 5 },
      read,
      commit: commitCount(1),
    });

    expect(read).not.toHaveBeenCalled();
    expect(result).toEqual({
      imported: 0,
      complete: true,
      owed: false,
      started: false,
      hint: null,
    });
  });

  describe('the points of the records the window returned, once it completes', () => {
    const pointA: OwedGround = { start: 9, end: 11, kind: 'point' };
    const pointB: OwedGround = { start: 40, end: 42, kind: 'point' };

    /** A commit that reports, per span start, the points its records returned and left owed. */
    const commitReturning = (
      bySpanStart: Record<number, { returned?: OwedGround[]; stuck?: OwedGround[] }>,
      events: string[] = [],
    ) =>
      jest.fn(async (span: WalkWindow, _page: WalkWindow): Promise<SpanCommit> => {
        events.push(`commit ${span.start}`);
        const { returned = [], stuck = [] } = bySpanStart[span.start] ?? {};

        return { imported: 0, owed: stuck.length > 0, returned, stuck };
      });

    it('hands them to onComplete once, after the commit of the last span', async () => {
      const events: string[] = [];
      const onComplete = jest.fn(async (_read: OwedGround[]) => {
        events.push('complete');
      });

      await walkSpans({
        window,
        read: readByWidth(),
        commit: commitReturning({ 0: { returned: [pointA] }, 75: { returned: [pointB] } }, events),
        onComplete,
      });

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith([pointA, pointB]);
      expect(events.at(-1)).toBe('complete');
    });

    it('lists a point once, though several spans returned it', async () => {
      const onComplete = jest.fn(async (_read: OwedGround[]) => undefined);

      await walkSpans({
        window,
        read: readByWidth(),
        commit: commitReturning({ 0: { returned: [pointA] }, 25: { returned: [pointA] } }),
        onComplete,
      });

      expect(onComplete).toHaveBeenCalledWith([pointA]);
    });

    it('leaves out a point that a record of a later span left owed, though an earlier span returned it for a record it could trust', async () => {
      const onComplete = jest.fn(async (_read: OwedGround[]) => undefined);

      await walkSpans({
        window,
        read: readByWidth(),
        commit: commitReturning({
          0: { returned: [pointA] },
          50: { returned: [pointA], stuck: [pointA] },
        }),
        onComplete,
      });

      expect(onComplete).toHaveBeenCalledWith([]);
    });

    describe('in several series', () => {
      const typed = (series: string): OwedGround => ({ ...pointA, series });

      it('lists the points of one window in two series as two points, each once', async () => {
        const onComplete = jest.fn(async (_read: OwedGround[]) => undefined);

        await walkSpans({
          window,
          read: readByWidth(),
          commit: commitReturning({
            0: { returned: [typed('MAIN_FUNDING'), typed('FUNDING_MAIN')] },
            25: { returned: [typed('MAIN_FUNDING')] },
          }),
          onComplete,
        });

        expect(onComplete).toHaveBeenCalledWith([typed('MAIN_FUNDING'), typed('FUNDING_MAIN')]);
      });

      it('leaves out only the point of the series a record left owed, not the twin of another series at the same window', async () => {
        const onComplete = jest.fn(async (_read: OwedGround[]) => undefined);

        await walkSpans({
          window,
          read: readByWidth(),
          commit: commitReturning({
            0: { returned: [typed('MAIN_FUNDING'), typed('FUNDING_MAIN')] },
            50: { stuck: [typed('MAIN_FUNDING')] },
          }),
          onComplete,
        });

        expect(onComplete).toHaveBeenCalledWith([typed('FUNDING_MAIN')]);
      });

      it('leaves out a point whose window a stuck span owes as a range, in whatever series it was read', async () => {
        const onComplete = jest.fn(async (_read: OwedGround[]) => undefined);
        const { start, end } = pointA;

        await walkSpans({
          window,
          read: readByWidth(),
          commit: commitReturning({
            0: { returned: [typed('MAIN_FUNDING')], stuck: [{ start, end }] },
          }),
          onComplete,
        });

        expect(onComplete).toHaveBeenCalledWith([]);
      });
    });

    it('is not called when the read gives up before the window is covered, though a span returned the point', async () => {
      const half = { start: 0, end: 50 };
      const reads = [
        { kind: 'split' as const, half },
        { kind: 'page' as const, page: half },
        undefined,
      ];
      const onComplete = jest.fn(async (_read: OwedGround[]) => undefined);

      await walkSpans({
        window,
        read: jest.fn(async () => reads.shift()),
        commit: commitReturning({ 0: { returned: [pointA] } }),
        onComplete,
      });

      expect(onComplete).not.toHaveBeenCalled();
    });

    it('is not called when the commit gives up', async () => {
      const onComplete = jest.fn(async (_read: OwedGround[]) => undefined);

      await walkSpans({
        window,
        read: readByWidth(),
        commit: jest.fn(async () => undefined),
        onComplete,
      });

      expect(onComplete).not.toHaveBeenCalled();
    });

    it('needs no onComplete', async () => {
      const result = await walkSpans({
        window,
        read: readByWidth(),
        commit: commitReturning({ 0: { returned: [pointA] } }),
      });

      expect(result.complete).toBe(true);
    });
  });

  describe('whether the window was started', () => {
    it('is started once a read returned a page', async () => {
      const result = await walkSpans({ window, read: readByWidth(), commit: commitCount(1) });

      expect(result.started).toBe(true);
    });

    it('is started by a read that returned only the half to read instead, though nothing committed', async () => {
      const half = { start: 0, end: 50 };
      const reads = [{ kind: 'split' as const, half }, undefined];
      const commit = commitCount(1);

      const result = await walkSpans({
        window,
        read: jest.fn(async () => reads.shift()),
        commit,
      });

      expect(commit).not.toHaveBeenCalled();
      expect(result).toEqual({
        imported: 0,
        complete: false,
        owed: false,
        started: true,
        hint: half,
      });
    });

    it('is not started when the first read gives up', async () => {
      const result = await walkSpans({
        window,
        read: jest.fn(async () => undefined),
        commit: commitCount(1),
      });

      expect(result).toEqual({
        imported: 0,
        complete: false,
        owed: false,
        started: false,
        hint: null,
      });
    });
  });

  describe('the span a window is left at', () => {
    const page = (span: WalkWindow): SpanRead<WalkWindow> => ({ kind: 'page', page: span });
    const split = (span: WalkWindow): SpanRead<WalkWindow> => ({
      kind: 'split',
      half: halfOf(span) as WalkWindow,
    });

    it('begins with the hint when it starts where the window starts', async () => {
      const read = readByWidth();

      await walkSpans({ window, read, commit: commitCount(1), hint: { start: 0, end: 20 } });

      expect(read.mock.calls.slice(0, 2).map(([span]) => span)).toEqual([
        { start: 0, end: 20 },
        { start: 20, end: 60 },
      ]);
    });

    it('goes on as it does from any committed span: from where it ended, twice as wide', async () => {
      const committed: WalkWindow[] = [];

      const result = await walkSpans({
        window,
        read: readByWidth(),
        commit: commitCount(1, committed),
        hint: { start: 0, end: 10 },
      });

      expect(committed).toEqual([
        { start: 0, end: 10 },
        { start: 10, end: 30 },
        { start: 30, end: 50 },
        { start: 50, end: 70 },
        { start: 70, end: 85 },
        { start: 85, end: 100 },
      ]);
      expect(result.complete).toBe(true);
    });

    it('never begins wider than the window', async () => {
      const read = readByWidth();

      await walkSpans({
        window: { start: 0, end: 20 },
        read,
        commit: commitCount(1),
        hint: { start: 0, end: 90 },
      });

      expect(read.mock.calls[0][0]).toEqual({ start: 0, end: 20 });
    });

    it('ignores a hint that starts anywhere else, so it can only narrow a read, never skip ground', async () => {
      const read = readByWidth();

      await walkSpans({ window, read, commit: commitCount(1), hint: { start: 10, end: 20 } });
      await walkSpans({ window, read, commit: commitCount(1), hint: { start: -5, end: 20 } });

      expect(read.mock.calls[0][0]).toEqual({ start: 0, end: 100 });
      expect(read.mock.calls.filter(([span]) => span.start === -5 || span.start === 10)).toEqual(
        [],
      );
    });

    it('is the half the chain had reached when the budget ends it before any span committed', async () => {
      const reads = [split(window), split({ start: 0, end: 50 }), undefined];

      const result = await walkSpans({
        window,
        read: jest.fn(async () => reads.shift()),
        commit: commitCount(1),
      });

      expect(result.hint).toEqual({ start: 0, end: 25 });
    });

    it('is the hint itself, narrowed again, when a chain resumed from it is cut short', async () => {
      const reads = [split({ start: 0, end: 40 }), undefined];

      const result = await walkSpans({
        window,
        read: jest.fn(async () => reads.shift()),
        commit: commitCount(1),
        hint: { start: 0, end: 40 },
      });

      expect(result.hint).toEqual({ start: 0, end: 20 });
    });

    it('is the span that was read when its commit gives up before any span committed', async () => {
      const reads = [split(window), page({ start: 0, end: 50 })];

      const result = await walkSpans({
        window,
        read: jest.fn(async () => reads.shift()),
        commit: jest.fn(async () => undefined),
      });

      expect(result.hint).toEqual({ start: 0, end: 50 });
    });

    it('is no span when the window itself was the span asked, and nothing was narrowed', async () => {
      const result = await walkSpans({
        window,
        read: jest.fn(async () => undefined),
        commit: commitCount(1),
      });

      expect(result.hint).toBeNull();
    });

    it('is no span once a span of the window committed, though the run stops after it', async () => {
      const reads = [split(window), page({ start: 0, end: 50 }), undefined];

      const result = await walkSpans({
        window,
        read: jest.fn(async () => reads.shift()),
        commit: commitCount(1),
      });

      expect(result.imported).toBe(1);
      expect(result.hint).toBeNull();
    });

    it('is no span once the window was read to its end', async () => {
      const result = await walkSpans({ window, read: readByWidth(), commit: commitCount(1) });

      expect(result.hint).toBeNull();
    });
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
