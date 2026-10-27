import { DAY_MS } from '@kiko/dates';
import maybe, { foldMap } from 'fnts/maybe';

import {
  advanceWalkMarks,
  dropReadPoints,
  NO_HINTS,
  type OwedGround,
  planWalkPasses,
  runWalkPlan,
  type WalkMarks,
  type WalkPass,
  type WalkPlan,
  type WalkWindow,
  walkSpans,
} from './walk';

const END_MS = Date.UTC(2026, 9, 10);

const rangeOf = (start: number, end: number, scope?: 'backfill', series?: string): OwedGround => ({
  start,
  end,
  ...foldMap(maybe(series), (name) => ({ series: name })),
  ...foldMap(maybe(scope), (name) => ({ scope: name })),
});

const pointOf = (start: number, end: number, scope?: 'backfill', series?: string): OwedGround => ({
  ...rangeOf(start, end, scope, series),
  kind: 'point',
});

const planOf = (over: Partial<WalkPlan> = {}): WalkPlan => ({
  forward: [],
  pending: [],
  points: [],
  rescan: [],
  rescanEnd: 1_000_000,
  pendingRanges: [],
  ranAt: 0,
  ...over,
});

describe('planWalkPasses, with ground that is owed to the backfill', () => {
  const input = {
    floorMs: Date.UTC(2017, 6, 14),
    endTime: END_MS,
    windowMs: 30 * DAY_MS,
    overlapMs: DAY_MS,
    maxWindows: 12,
    cursor: END_MS - 2 * DAY_MS,
    rescanCursor: null,
    pointCursor: null,
    rangeCursor: null,
  };
  const start = END_MS - 100 * DAY_MS;

  it('never merges a backfill range with a range owed for every coin', () => {
    const plan = planWalkPasses({
      ...input,
      pending: [rangeOf(start, start + 1_000), rangeOf(start + 1_000, start + 2_000, 'backfill')],
    });

    expect(plan.pendingRanges.filter(({ end }) => end <= start + 2_000)).toEqual([
      rangeOf(start, start + 1_000),
      rangeOf(start + 1_000, start + 2_000, 'backfill'),
    ]);
  });

  it('merges the touching backfill ranges with each other', () => {
    const plan = planWalkPasses({
      ...input,
      pending: [
        rangeOf(start, start + 1_000, 'backfill'),
        rangeOf(start + 1_000, start + 2_000, 'backfill'),
      ],
    });

    expect(plan.pendingRanges.filter(({ end }) => end <= start + 2_000)).toEqual([
      rangeOf(start, start + 2_000, 'backfill'),
    ]);
  });

  it('keeps the backfill ranges of two series apart', () => {
    const plan = planWalkPasses({
      ...input,
      pending: [
        rangeOf(start, start + 1_000, 'backfill', 'MAIN_FUNDING'),
        rangeOf(start + 1_000, start + 2_000, 'backfill', 'FUNDING_MAIN'),
      ],
    });

    expect(plan.pendingRanges.filter(({ end }) => end <= start + 2_000)).toHaveLength(2);
  });

  it('merges the nearest backfill ranges past the limit, and never into a range owed for every coin', () => {
    const owed = Array.from({ length: 14 }, (_unused, index) =>
      rangeOf(start + index * 10_000, start + index * 10_000 + 1_000, 'backfill'),
    );
    const other = rangeOf(start + 5_500, start + 5_600);

    const plan = planWalkPasses({ ...input, pending: [...owed, other] });

    expect(plan.pendingRanges.filter(({ scope }) => scope === undefined)).toContainEqual(other);
    expect(plan.pendingRanges.filter(({ scope }) => scope === 'backfill')).toHaveLength(12);
  });

  it('reads the window of a backfill range as a window of the backfill', () => {
    const plan = planWalkPasses({ ...input, pending: [rangeOf(start, start + 1_000, 'backfill')] });

    expect(plan.pending).toEqual([{ start, end: start + 1_000, scope: 'backfill' }]);
  });

  it('reads two ranges of one start in two windows, one for each scope', () => {
    const plan = planWalkPasses({
      ...input,
      pending: [rangeOf(start, start + 1_000, 'backfill'), rangeOf(start, start + 1_000)],
    });

    expect(plan.pending.map(({ scope }) => scope)).toEqual([undefined, 'backfill']);
  });

  it('reads a backfill range in every Transfer series', () => {
    const plan = planWalkPasses({ ...input, pending: [rangeOf(start, start + 1_000, 'backfill')] });

    expect(plan.pending).toHaveLength(1);
    expect(plan.pending[0].series).toBeUndefined();
  });

  it('reads the window of a backfill range owed in one Transfer series in that series and the backfill', () => {
    const plan = planWalkPasses({
      ...input,
      pending: [rangeOf(start, start + 1_000, 'backfill', 'MAIN_FUNDING')],
    });

    expect(plan.pending).toEqual([
      { start, end: start + 1_000, series: ['MAIN_FUNDING'], scope: 'backfill' },
    ]);
  });

  it('reads a point owed to the backfill in a window of the backfill', () => {
    const plan = planWalkPasses({ ...input, pending: [pointOf(start, start + 10, 'backfill')] });

    expect(plan.points).toEqual([{ start, end: start + 10, scope: 'backfill' }]);
  });

  it('reads points of one start in a window for every coin when one of them is owed for every coin', () => {
    const plan = planWalkPasses({
      ...input,
      pending: [pointOf(start, start + 10, 'backfill'), pointOf(start, start + 20)],
    });

    expect(plan.points).toEqual([{ start, end: start + 20 }]);
  });
});

describe('advanceWalkMarks, with ground that is owed to the backfill', () => {
  const whole = { start: 70_000, end: 90_000 };

  const advance = async (input: {
    pass: WalkPass;
    span?: WalkWindow;
    pending: OwedGround[];
    scope?: 'backfill';
    series?: string[];
    owed?: OwedGround[];
  }) => {
    const marks: WalkMarks = {
      cursor: 900,
      rescanCursor: 50_000,
      pointCursor: null,
      rangeCursor: null,
      hints: NO_HINTS,
      pending: input.pending,
    };

    await advanceWalkMarks({
      pass: input.pass,
      span: input.span ?? whole,
      series: input.series,
      scope: input.scope,
      owed: input.owed ?? [],
      plan: planOf(),
      marks,
      restartMs: 5,
      write: async () => undefined,
    });

    return marks.pending;
  };

  it('takes backfill ground out by a read for every coin', async () => {
    const pending = await advance({
      pass: 'pending',
      pending: [rangeOf(70_000, 90_000, 'backfill'), rangeOf(70_000, 90_000)],
    });

    expect(pending).toEqual([]);
  });

  it('takes backfill ground out by a re-scan span', async () => {
    const pending = await advance({
      pass: 'rescan',
      pending: [rangeOf(70_000, 90_000, 'backfill')],
    });

    expect(pending).toEqual([]);
  });

  it('keeps ground owed for every coin after a backfill read of it', async () => {
    const pending = await advance({
      pass: 'pending',
      scope: 'backfill',
      pending: [rangeOf(70_000, 90_000), rangeOf(70_000, 90_000, 'backfill')],
    });

    expect(pending).toEqual([rangeOf(70_000, 90_000)]);
  });

  it('keeps what is left of a backfill range after a backfill read of part of it', async () => {
    const pending = await advance({
      pass: 'pending',
      scope: 'backfill',
      span: { start: 70_000, end: 80_000 },
      pending: [rangeOf(70_000, 90_000, 'backfill')],
    });

    expect(pending).toEqual([rangeOf(80_000, 90_000, 'backfill')]);
  });

  it('keeps a backfill range owed in every series after a read of one series', async () => {
    const pending = await advance({
      pass: 'pending',
      series: ['MAIN_FUNDING'],
      pending: [rangeOf(70_000, 90_000, 'backfill')],
    });

    expect(pending).toEqual([rangeOf(70_000, 90_000, 'backfill')]);
  });

  it('takes a backfill range owed in one series out by a backfill read of that series', async () => {
    const pending = await advance({
      pass: 'pending',
      scope: 'backfill',
      series: ['MAIN_FUNDING'],
      pending: [rangeOf(70_000, 90_000, 'backfill', 'MAIN_FUNDING')],
    });

    expect(pending).toEqual([]);
  });

  it('owes a point found in a backfill window to the backfill', async () => {
    const pending = await advance({
      pass: 'pending',
      scope: 'backfill',
      pending: [],
      owed: [pointOf(75_000, 75_010)],
    });

    expect(pending).toEqual([{ ...pointOf(75_000, 75_010, 'backfill'), since: 0 }]);
  });

  it('owes the span a backfill window could not commit to the backfill', async () => {
    const pending = await advance({
      pass: 'pending',
      scope: 'backfill',
      pending: [rangeOf(70_000, 90_000, 'backfill')],
      owed: [rangeOf(70_000, 90_000)],
    });

    expect(pending).toEqual([rangeOf(70_000, 90_000, 'backfill')]);
  });

  it('owes a point found in a window for every coin to every coin', async () => {
    const pending = await advance({
      pass: 'pending',
      pending: [],
      owed: [pointOf(75_000, 75_010)],
    });

    expect(pending).toEqual([{ ...pointOf(75_000, 75_010), since: 0 }]);
  });

  it('keeps a point owed to the backfill and one owed for every coin of one window as two', async () => {
    const pending = await advance({
      pass: 'pending',
      span: { start: 10, end: 20 },
      pending: [pointOf(75_000, 75_010, 'backfill')],
      owed: [pointOf(75_000, 75_010)],
    });

    expect(pending.map(({ scope }) => scope)).toEqual([undefined, 'backfill']);
  });
});

describe('walkSpans and dropReadPoints, with a window of the backfill', () => {
  const window = { start: 0, end: 100, scope: 'backfill' as const };

  const readOnce = async (span: WalkWindow) => ({ kind: 'page' as const, page: span });

  it('hands the points its records returned over as points of the backfill', async () => {
    const onComplete = jest.fn(async (_read: OwedGround[]) => undefined);

    await walkSpans({
      window,
      read: readOnce,
      commit: async () => ({
        imported: 0,
        owed: false,
        returned: [pointOf(9, 11)],
        stuck: [],
      }),
      onComplete,
    });

    expect(onComplete).toHaveBeenCalledWith([pointOf(9, 11, 'backfill')]);
  });

  it('hands the points a window for every coin returned over as points for every coin', async () => {
    const onComplete = jest.fn(async (_read: OwedGround[]) => undefined);

    await walkSpans({
      window: { start: 0, end: 100 },
      read: readOnce,
      commit: async () => ({
        imported: 0,
        owed: false,
        returned: [pointOf(9, 11)],
        stuck: [],
      }),
      onComplete,
    });

    expect(onComplete).toHaveBeenCalledWith([pointOf(9, 11)]);
  });

  const stopsAfterFirstFifty = async (span: WalkWindow) => {
    if (span.end - span.start > 50) {
      return { kind: 'split' as const, half: { start: span.start, end: span.start + 50 } };
    }

    return span.start >= 50 ? undefined : { kind: 'page' as const, page: span };
  };

  it('leaves a resume made for the backfill when a window of it stops after a span committed', async () => {
    const outcome = await walkSpans({
      window: { start: 0, end: 1_000, scope: 'backfill' },
      read: stopsAfterFirstFifty,
      commit: async () => ({ imported: 0, owed: false, returned: [], stuck: [] }),
    });

    expect(outcome.hint?.resume?.scope).toBe('backfill');
  });

  it('leaves a resume made for every coin with no scope', async () => {
    const outcome = await walkSpans({
      window: { start: 0, end: 1_000 },
      read: stopsAfterFirstFifty,
      commit: async () => ({ imported: 0, owed: false, returned: [], stuck: [] }),
    });

    expect(outcome.hint?.resume).not.toHaveProperty('scope');
  });

  const dropped = async (stored: OwedGround[], read: OwedGround[]) => {
    const marks: WalkMarks = {
      cursor: 900,
      rescanCursor: null,
      pointCursor: null,
      rangeCursor: null,
      hints: NO_HINTS,
      pending: stored,
    };

    await dropReadPoints({
      pass: 'pending',
      window: { start: 0, end: 100 },
      read,
      marks,
      write: async () => undefined,
    });

    return marks.pending;
  };

  it('takes a point owed to the backfill off the list when a backfill window returned its record', async () => {
    expect(await dropped([pointOf(9, 11, 'backfill')], [pointOf(9, 11, 'backfill')])).toEqual([]);
  });

  it('keeps a point owed for every coin when only a backfill window returned its record', async () => {
    expect(await dropped([pointOf(9, 11)], [pointOf(9, 11, 'backfill')])).toEqual([pointOf(9, 11)]);
  });

  it('takes a point owed to the backfill off the list when a window for every coin returned its record', async () => {
    expect(await dropped([pointOf(9, 11, 'backfill')], [pointOf(9, 11)])).toEqual([]);
  });
});

describe('runWalkPlan, with a resume made for the backfill', () => {
  const point = { start: 10, end: 40 };
  const resume = { from: 20, returned: [], stuck: [] };

  const given = async (
    resumeScope: 'backfill' | undefined,
    windowScope: 'backfill' | undefined,
  ) => {
    const runWindow = jest.fn(async () => ({
      imported: 0,
      complete: true,
      owed: false,
      started: true,
    }));

    await runWalkPlan({
      plan: planOf({
        points: [{ ...point, ...foldMap(maybe(windowScope), (scope) => ({ scope })) }],
      }),
      canAfford: () => true,
      runWindow,
      hints: {
        stored: {
          ...NO_HINTS,
          point: [
            {
              ...point,
              resume: { ...resume, ...foldMap(maybe(resumeScope), (scope) => ({ scope })) },
            },
          ],
        },
        store: async () => undefined,
      },
    });

    return runWindow.mock.calls[0] as unknown[];
  };

  it('gives it to a window of the backfill', async () => {
    expect((await given('backfill', 'backfill'))[3]).toMatchObject({ resume: { from: 20 } });
  });

  it('never gives it to a window for every coin', async () => {
    expect((await given('backfill', undefined))[3]).toBeUndefined();
  });

  it('never gives a resume made for every coin to a window of the backfill', async () => {
    expect((await given(undefined, 'backfill'))[3]).toBeUndefined();
  });
});
