import type { WalkMarkPatch } from '../walk-state';

import {
  advanceWalkMarks,
  multiCoinPatchesOf,
  NO_HINTS,
  planWalkPasses,
  type WalkMarks,
  type WalkPass,
} from './walk';

const FLOOR_MS = 1_000;

const FIRST_RUN: WalkMarkPatch[] = [
  { field: 'multiCoinSeen', value: true },
  { field: 'multiCoinSince', value: 5_000 },
];

const planOf = () =>
  planWalkPasses({
    cursor: 5_000,
    rescanCursor: null,
    pointCursor: null,
    rangeCursor: null,
    pending: [],
    floorMs: FLOOR_MS,
    endTime: 20_000,
    windowMs: 4_000,
    overlapMs: 500,
    maxWindows: 10,
  });

const marksOf = (multiCoinPatches: WalkMarkPatch[]): WalkMarks => ({
  cursor: 5_000,
  rescanCursor: null,
  pointCursor: null,
  rangeCursor: null,
  hints: NO_HINTS,
  pending: [],
  multiCoinPatches,
});

const advance = async (pass: WalkPass, marks: WalkMarks, span: { start: number; end: number }) => {
  const write = jest.fn(async (_patches: readonly WalkMarkPatch[]) => undefined);

  await advanceWalkMarks({
    pass,
    span,
    series: undefined,
    plan: planOf(),
    marks,
    restartMs: FLOOR_MS,
    write,
  });

  return write.mock.calls.map(([patches]) => patches.map(({ field }) => field));
};

describe('multiCoinPatchesOf', () => {
  it('names the seen mark and the plan cursor on a walk that was never seen', () => {
    expect(multiCoinPatchesOf({ stored: {}, planCursor: 5_000 })).toEqual(FIRST_RUN);
  });

  it.each([FLOOR_MS, FLOOR_MS - 1])(
    'records a plan cursor of %d, at or below the floor, as the start it is',
    (planCursor) => {
      expect(multiCoinPatchesOf({ stored: {}, planCursor })).toEqual([
        { field: 'multiCoinSeen', value: true },
        { field: 'multiCoinSince', value: planCursor },
      ]);
    },
  );

  it('names the seen mark alone when the plan cursor is null', () => {
    expect(multiCoinPatchesOf({ stored: {}, planCursor: null })).toEqual([
      { field: 'multiCoinSeen', value: true },
    ]);
  });

  it('names nothing on a walk that was seen', () => {
    expect(
      multiCoinPatchesOf({ stored: { multiCoinSeen: true, multiCoinSince: 3_000 }, planCursor: 9 }),
    ).toEqual([]);
    expect(multiCoinPatchesOf({ stored: { multiCoinSeen: true }, planCursor: 9 })).toEqual([]);
  });

  it('keeps an earlier range start a walk with a lost seen mark already holds', () => {
    expect(multiCoinPatchesOf({ stored: { multiCoinSince: 3_000 }, planCursor: 5_000 })).toEqual([
      { field: 'multiCoinSeen', value: true },
      { field: 'multiCoinSince', value: 3_000 },
    ]);
    expect(multiCoinPatchesOf({ stored: { multiCoinSince: 8_000 }, planCursor: 5_000 })).toEqual(
      FIRST_RUN,
    );
    expect(multiCoinPatchesOf({ stored: { multiCoinSince: 3_000 }, planCursor: null })).toEqual([
      { field: 'multiCoinSeen', value: true },
      { field: 'multiCoinSince', value: 3_000 },
    ]);
  });
});

describe('advanceWalkMarks and the multi-coin marks', () => {
  it('writes both marks in the one write of the first forward span with the cursor', async () => {
    const marks = marksOf(FIRST_RUN);

    expect(await advance('forward', marks, { start: 5_000, end: 7_000 })).toEqual([
      ['pending', 'multiCoinSeen', 'multiCoinSince', 'cursor'],
    ]);
    expect(marks.multiCoinPatches).toEqual([]);
  });

  it('writes neither again with the cursor of a later forward span', async () => {
    const marks = marksOf(FIRST_RUN);

    await advance('forward', marks, { start: 5_000, end: 7_000 });

    expect(await advance('forward', marks, { start: 7_000, end: 9_000 })).toEqual([['cursor']]);
  });

  it.each<WalkPass>(['pending', 'rescan'])(
    'leaves both marks for the forward span when a %s span commits first',
    async (pass) => {
      const marks = marksOf(FIRST_RUN);
      const written = await advance(pass, marks, { start: 1_000, end: 2_000 });

      expect(written.flat()).not.toContain('multiCoinSeen');
      expect(written.flat()).not.toContain('multiCoinSince');
      expect(marks.multiCoinPatches).toEqual(FIRST_RUN);
    },
  );
});
