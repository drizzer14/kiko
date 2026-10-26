import { DAY_MS } from '@kiko/dates';
import maybe, { foldMap } from 'fnts/maybe';

import {
  advanceWalkMarks,
  distinctGround,
  dropReadPoints,
  NO_HINTS,
  type OwedGround,
  planWalkPasses,
  storePlannedList,
  type WalkMarks,
  type WalkPass,
  type WalkPlan,
  type WalkWindow,
  walkSpans,
} from './walk';

const FIRST_RUN = 1_700_000_000_000;
const LATER_RUN = FIRST_RUN + 3 * DAY_MS;

const pointOf = (start: number, end: number, since?: number): OwedGround => ({
  start,
  end,
  kind: 'point',
  ...foldMap(maybe(since), (stamp) => ({ since: stamp })),
});

const rangeOf = (start: number, end: number): OwedGround => ({ start, end });

const planOf = (over: Partial<WalkPlan> = {}): WalkPlan => ({
  forward: [],
  pending: [],
  points: [],
  rescan: [],
  rescanEnd: 1_000_000,
  pendingRanges: [],
  ranAt: FIRST_RUN,
  ...over,
});

const marksOf = (pending: OwedGround[]): WalkMarks => ({
  cursor: 100,
  rescanCursor: null,
  pointCursor: null,
  rangeCursor: null,
  hints: NO_HINTS,
  pending,
});

type Patch = Parameters<Parameters<typeof advanceWalkMarks>[0]['write']>[0][number];

/** The writes one `advanceWalkMarks` makes, and the list the walk holds after it. */
const advanced = async (input: {
  pass: WalkPass;
  stored: OwedGround[];
  owed: OwedGround[];
  ranAt?: number;
  plannedList?: OwedGround[];
}) => {
  const { pass, stored, owed, ranAt = FIRST_RUN, plannedList = stored } = input;
  const marks = marksOf(stored);
  const writes: Patch[][] = [];

  await advanceWalkMarks({
    pass,
    span: { start: 100, end: 200 },
    series: undefined,
    owed,
    plan: planOf({ ranAt, pendingRanges: plannedList }),
    marks,
    restartMs: 5,
    write: async (patches) => {
      writes.push([...patches]);
    },
  });

  return { writes, held: marks.pending };
};

const PASSES: readonly WalkPass[] = ['forward', 'pending', 'rescan'];

describe('the first run that owes a point stamps `since` on it', () => {
  it.each(PASSES)('in a %s span: the point carries the time of the run', async (pass) => {
    const { held } = await advanced({ pass, stored: [], owed: [pointOf(10, 12)] });

    expect(held).toEqual([pointOf(10, 12, FIRST_RUN)]);
  });

  it.each(PASSES)('in a %s span: a range is never stamped', async (pass) => {
    const { held } = await advanced({ pass, stored: [], owed: [rangeOf(300, 400)] });

    expect(held).toEqual([rangeOf(300, 400)]);
    expect(held.every((ground) => !('since' in ground))).toBe(true);
  });

  it.each(PASSES)(
    'in a %s span: a later run that owes it again does not move it, and writes nothing for it',
    async (pass) => {
      const stored = [pointOf(10, 12, FIRST_RUN)];
      const { held, writes } = await advanced({
        pass,
        stored,
        owed: [pointOf(10, 12)],
        ranAt: LATER_RUN,
      });

      expect(held).toEqual(stored);
      expect(writes.flat().filter(({ field }) => field === 'pending')).toEqual([]);
    },
  );

  it.each(PASSES)(
    'in a %s span: a point an older build stored without it is stamped when the run owes it again, though nothing else changed',
    async (pass) => {
      const { held, writes } = await advanced({
        pass,
        stored: [pointOf(10, 12)],
        owed: [pointOf(10, 12)],
        ranAt: LATER_RUN,
      });

      expect(held).toEqual([pointOf(10, 12, LATER_RUN)]);
      expect(writes.flat()).toContainEqual({
        field: 'pending',
        value: [pointOf(10, 12, LATER_RUN)],
      });
    },
  );

  it('leaves a point an older build stored without it alone while no run owes it again', async () => {
    const { held } = await advanced({
      pass: 'pending',
      stored: [pointOf(10, 12)],
      owed: [],
      ranAt: LATER_RUN,
    });

    expect(held).toEqual([pointOf(10, 12)]);
  });
});

describe('every writer of the list keeps the first `since` of a point owed again', () => {
  const SINCE = FIRST_RUN - 5 * DAY_MS;
  const stored = [pointOf(10, 12, SINCE), pointOf(20, 22, SINCE + 1)];
  const owedAgain = [pointOf(10, 12), pointOf(20, 22, LATER_RUN)];
  const expected = [pointOf(10, 12, SINCE), pointOf(20, 22, SINCE + 1)];

  const byStart = (list: OwedGround[]): OwedGround[] =>
    [...list].sort((left, right) => left.start - right.start);

  const afterPass = (pass: WalkPass) => async (): Promise<OwedGround[]> =>
    (await advanced({ pass, stored, owed: owedAgain, ranAt: LATER_RUN })).held;

  const WRITERS: [string, () => Promise<OwedGround[]>][] = [
    ['a forward span', afterPass('forward')],
    ['a pending span', afterPass('pending')],
    ['a re-scan span', afterPass('rescan')],
    [
      'the forward span after an earlier forward span of the run owed it',
      async () => {
        const marks = marksOf(stored);
        const plan = planOf({ ranAt: LATER_RUN, pendingRanges: stored });
        const advance = (span: WalkWindow, owed: OwedGround[]) =>
          advanceWalkMarks({
            pass: 'forward',
            span,
            series: undefined,
            owed,
            plan,
            marks,
            restartMs: 5,
            write: async () => undefined,
          });

        await advance({ start: 100, end: 200 }, [owedAgain[0]]);
        await advance({ start: 200, end: 300 }, [owedAgain[1]]);

        return marks.pending;
      },
    ],
    [
      'the plan of a run',
      async () =>
        planWalkPasses({
          cursor: 5 * DAY_MS,
          rescanCursor: null,
          pointCursor: null,
          rangeCursor: null,
          pending: [...stored, ...owedAgain],
          floorMs: 0,
          endTime: 10 * DAY_MS,
          windowMs: 3 * DAY_MS,
          overlapMs: DAY_MS,
          maxWindows: 12,
        }).pendingRanges.filter((ground) => ground.kind === 'point'),
    ],
    [
      'the list a run stores before any pass',
      async () => {
        const marks = marksOf([]);

        await storePlannedList({
          plan: planOf({ pendingRanges: distinctGround([...stored, ...owedAgain]) }),
          marks,
          write: async () => undefined,
        });

        return marks.pending;
      },
    ],
    ['the dedupe of owed ground', async () => distinctGround([...stored, ...owedAgain])],
    [
      'the dedupe of owed ground, the stamped entry last',
      async () => distinctGround([...owedAgain, ...stored]),
    ],
  ];

  it.each(WRITERS)('%s', async (_label, write) => {
    expect(byStart(await write())).toEqual(expected);
  });

  it('a read that settles one point keeps the stamp of every point it leaves', async () => {
    const marks = marksOf(stored);

    await dropReadPoints({
      pass: 'pending',
      window: { start: 0, end: 15 },
      read: [pointOf(10, 12)],
      marks,
      write: async () => undefined,
    });

    expect(marks.pending).toEqual([pointOf(20, 22, SINCE + 1)]);
  });

  it('a point that the plan carries keeps its stamp into the list the forward span stores', async () => {
    const { writes } = await advanced({
      pass: 'forward',
      stored: [],
      plannedList: stored,
      owed: [],
      ranAt: LATER_RUN,
    });

    expect(writes.flat()).toContainEqual({ field: 'pending', value: stored });
  });
});

describe('a point owed again is still the same point', () => {
  const window: WalkWindow = { start: 0, end: 100 };
  const readOnce = (span: WalkWindow) =>
    Promise.resolve({ kind: 'page' as const, page: span, imported: 0 });

  it.each([
    ['a stamped point owed again by an unstamped one', pointOf(9, 11, FIRST_RUN), pointOf(9, 11)],
    ['an unstamped point owed again by a stamped one', pointOf(9, 11), pointOf(9, 11, FIRST_RUN)],
  ])('holds back the returned point of its record: %s', async (_label, stuck, returned) => {
    const onComplete = jest.fn(async (_read: OwedGround[]) => undefined);

    await walkSpans({
      window,
      read: readOnce,
      commit: async () => ({ imported: 0, owed: true, returned: [returned], stuck: [stuck] }),
      onComplete,
    });

    expect(onComplete).toHaveBeenCalledWith([]);
  });

  it('reads two points of one ground as one, whichever is stamped', async () => {
    const onComplete = jest.fn(async (_read: OwedGround[]) => undefined);

    await walkSpans({
      window,
      read: readOnce,
      commit: async () => ({
        imported: 0,
        owed: false,
        returned: [pointOf(9, 11), pointOf(9, 11, FIRST_RUN)],
        stuck: [],
      }),
      onComplete,
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toHaveLength(1);
  });

  it('keeps the first stamp of a stuck point in the resume a stopped window leaves', async () => {
    const outcome = await walkSpans({
      window,
      read: async (span) => {
        if (span.end - span.start > 50) {
          return { kind: 'split', half: { start: span.start, end: span.start + 50 } };
        }

        return span.start >= 50 ? undefined : { kind: 'page', page: span };
      },
      commit: async () => ({
        imported: 0,
        owed: true,
        returned: [],
        stuck: [pointOf(9, 11), pointOf(9, 11, FIRST_RUN)],
      }),
    });

    expect(outcome.hint?.resume?.stuck).toEqual([pointOf(9, 11, FIRST_RUN)]);
  });
});
