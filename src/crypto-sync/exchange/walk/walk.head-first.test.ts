import { DAY_MS } from '@kiko/dates';

import * as walkModule from './index';
import { type OwedGround, planWalkPasses } from './walk';

// The helper is looked up by name at run time: this suite is written before the export exists, and
// the pre-commit typecheck runs on the staged index.
type HeadFirstInput = {
  cursor: number | null;
  pending: OwedGround[];
  floorMs: number;
  endTime: number;
  windowMs: number;
  write: (patches: readonly { field: string; value: unknown }[]) => Promise<void>;
};

type HeadFirstResult = {
  cursor: number | null;
  pending: OwedGround[];
  rangeCursor?: number | null;
};

const FLOOR_MS = Date.UTC(2017, 6, 14);
const END_MS = Date.UTC(2026, 9, 10);
const WINDOW_MS = 30 * DAY_MS;
const HEAD_START = END_MS - WINDOW_MS;
const BEFORE_EVERY_GROUND = Number.MIN_SAFE_INTEGER;

const headFirstGroundOf = (input: HeadFirstInput): Promise<HeadFirstResult> => {
  const helper = (walkModule as unknown as Record<string, unknown>).headFirstGroundOf;

  if (typeof helper !== 'function') {
    throw new Error('the walk barrel does not export headFirstGroundOf');
  }

  return helper(input);
};

const writes: { field: string; value: unknown }[][] = [];

const run = (
  cursor: number | null,
  pending: OwedGround[] = [],
  over: Partial<HeadFirstInput> = {},
) =>
  headFirstGroundOf({
    cursor,
    pending,
    floorMs: FLOOR_MS,
    endTime: END_MS,
    windowMs: WINDOW_MS,
    write: async (patches) => {
      writes.push([...patches]);
    },
    ...over,
  });

const valueWritten = (field: string): unknown =>
  writes.flat().find((patch) => patch.field === field)?.value;

const isRangeCursorReset = (value: unknown): boolean =>
  value === null || value === BEFORE_EVERY_GROUND;

beforeEach(() => {
  writes.length = 0;
});

describe('headFirstGroundOf', () => {
  it('is exported by the walk barrel', () => {
    expect(typeof (walkModule as unknown as Record<string, unknown>).headFirstGroundOf).toBe(
      'function',
    );
  });

  it('owes the ground from the floor to the head window and moves the cursor to the head, in one write', async () => {
    const result = await run(null);

    expect(writes).toHaveLength(1);
    expect(writes[0].map(({ field }) => field).sort()).toEqual([
      'cursor',
      'pending',
      'rangeCursor',
    ]);
    expect(valueWritten('pending')).toEqual([{ start: FLOOR_MS, end: HEAD_START }]);
    expect(valueWritten('cursor')).toBe(HEAD_START);
    expect(isRangeCursorReset(valueWritten('rangeCursor'))).toBe(true);
    expect(result.cursor).toBe(HEAD_START);
    expect(result.pending).toEqual([{ start: FLOOR_MS, end: HEAD_START }]);
    expect(isRangeCursorReset(result.rangeCursor)).toBe(true);
  });

  it('starts the owed ground at the stored cursor of an account that has read part of its history', async () => {
    const stored = Date.UTC(2024, 0, 1);

    const result = await run(stored);

    expect(valueWritten('pending')).toEqual([{ start: stored, end: HEAD_START }]);
    expect(valueWritten('cursor')).toBe(HEAD_START);
    expect(result.pending).toEqual([{ start: stored, end: HEAD_START }]);
  });

  it('starts the owed ground at the floor for a cursor before it, as a disconnect leaves one', async () => {
    await run(FLOOR_MS - 5 * DAY_MS);

    expect(valueWritten('pending')).toEqual([{ start: FLOOR_MS, end: HEAD_START }]);
  });

  it('leaves no ground between the owed range and the head window, and none inside both', async () => {
    const stored = Date.UTC(2025, 2, 3);

    const result = await run(stored);
    const [range] = result.pending;

    expect(range.start).toBe(stored);
    expect(range.end).toBe(result.cursor);
    expect(result.cursor).toBe(END_MS - WINDOW_MS);
  });

  it('keeps the ground and the points that were already owed in front of the new range', async () => {
    const owedRange = { start: Date.UTC(2020, 0, 1), end: Date.UTC(2020, 0, 3) };
    const owedPoint = {
      start: Date.UTC(2022, 4, 1),
      end: Date.UTC(2022, 4, 1) + 2,
      kind: 'point' as const,
      series: 'BUY',
      since: END_MS,
    };

    const result = await run(Date.UTC(2024, 0, 1), [owedRange, owedPoint]);

    expect(result.pending).toEqual([
      owedRange,
      owedPoint,
      { start: Date.UTC(2024, 0, 1), end: HEAD_START },
    ]);
    expect(valueWritten('pending')).toEqual(result.pending);
  });

  it.each([
    ['at the head start', HEAD_START],
    ['inside the head window', HEAD_START + 10 * DAY_MS],
    ['at the end', END_MS],
    ['past the end', END_MS + DAY_MS],
  ])('writes nothing and changes nothing for a cursor %s', async (_label, cursor) => {
    const pending = [{ start: Date.UTC(2020, 0, 1), end: Date.UTC(2020, 0, 3) }];

    const result = await run(cursor, pending);

    expect(writes).toEqual([]);
    expect(result.cursor).toBe(cursor);
    expect(result.pending).toEqual(pending);
  });

  it('writes nothing when the clock stands so near the floor that the head window starts before it', async () => {
    const result = await run(null, [], { endTime: FLOOR_MS + 10 * DAY_MS });

    expect(writes).toEqual([]);
    expect(result.cursor).toBeNull();
  });

  describe('with the limit of owed ranges', () => {
    const owedRanges = (count: number): OwedGround[] =>
      Array.from({ length: count }, (_unused, index) => ({
        start: Date.UTC(2019, 0, 1) + index * 10 * DAY_MS,
        end: Date.UTC(2019, 0, 1) + index * 10 * DAY_MS + DAY_MS,
      }));

    it('loses no ground when the new range goes over the limit: the plan still holds every range', async () => {
      const owed = owedRanges(12);
      const stored = Date.UTC(2024, 0, 1);

      const result = await run(stored, owed);
      const plan = planWalkPasses({
        cursor: result.cursor,
        rescanCursor: null,
        pointCursor: null,
        rangeCursor: null,
        pending: result.pending,
        floorMs: FLOOR_MS,
        endTime: END_MS,
        windowMs: WINDOW_MS,
        overlapMs: DAY_MS,
        maxWindows: 80,
      });
      const holds = (ground: { start: number; end: number }): boolean =>
        plan.pendingRanges.some(({ start, end }) => start <= ground.start && ground.end <= end);

      expect(
        [...owed, { start: stored, end: HEAD_START }].filter((ground) => !holds(ground)),
      ).toEqual([]);
    });
  });
});

describe('the jump with the walk planner', () => {
  it('plans the head window as the forward pass and the ground behind it as the owed ground', async () => {
    const result = await run(null);
    const plan = planWalkPasses({
      cursor: result.cursor,
      rescanCursor: null,
      pointCursor: null,
      rangeCursor: null,
      pending: result.pending,
      floorMs: FLOOR_MS,
      endTime: END_MS,
      windowMs: WINDOW_MS,
      overlapMs: DAY_MS,
      maxWindows: 80,
    });

    expect(plan.forward).toEqual([{ start: HEAD_START, end: END_MS }]);
    expect(plan.pendingRanges).toEqual([{ start: FLOOR_MS, end: HEAD_START }]);
  });
});
