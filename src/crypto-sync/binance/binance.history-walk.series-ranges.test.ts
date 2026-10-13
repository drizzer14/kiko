import { DAY_MS } from '@kiko/dates';

import {
  advanceWalkMarks,
  NO_HINTS,
  type OwedGround,
  planWalkPasses,
  readPendingMark,
  type WalkMarks,
  type WalkPass,
  type WalkPlan,
  type WalkWindow,
  withoutRead,
} from './binance.history-walk';
import { commitSettledSpan } from './binance.history-records';

const FIELDS = {
  cursor: 'binanceTransferHistoryCursor',
  rescan: 'binanceTransferRescanCursor',
  point: 'binanceTransferPointCursor',
  range: 'binanceTransferRangeCursor',
  hints: 'binanceTransferSpanHints',
  pending: 'binanceTransferPendingOverlap',
} as const;

const KNOWN = ['MAIN_FUNDING', 'FUNDING_MAIN'];

const rangeOf = (start: number, end: number, series?: string): OwedGround =>
  series === undefined ? { start, end } : { start, end, series };

const planOf = (over: Partial<WalkPlan> = {}): WalkPlan => ({
  forward: [],
  pending: [],
  points: [],
  rescan: [],
  rescanEnd: 0,
  pendingRanges: [],
  ...over,
});

describe('withoutRead, for ranges that are owed in one series', () => {
  it('keeps the series of what is left of a range', () => {
    const left = withoutRead([rangeOf(100, 200, 'MAIN_FUNDING')], { start: 120, end: 180 });

    expect(left).toEqual([rangeOf(100, 120, 'MAIN_FUNDING'), rangeOf(180, 200, 'MAIN_FUNDING')]);
  });
});

describe('planWalkPasses, with ranges that are owed in one series', () => {
  const END_MS = Date.UTC(2026, 9, 10);
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

  it('reads the window of a range in its series alone', () => {
    const plan = planWalkPasses({
      ...input,
      pending: [rangeOf(start, start + 1_000, 'MAIN_FUNDING')],
    });

    expect(plan.pending).toEqual([{ start, end: start + 1_000, series: ['MAIN_FUNDING'] }]);
  });

  it('reads the window of a range with no series in every series', () => {
    const plan = planWalkPasses({ ...input, pending: [rangeOf(start, start + 1_000)] });

    expect(plan.pending).toEqual([{ start, end: start + 1_000 }]);
  });

  it('reads two ranges of one start in two windows, one for each series', () => {
    const plan = planWalkPasses({
      ...input,
      pending: [
        rangeOf(start, start + 1_000, 'FUNDING_MAIN'),
        rangeOf(start, start + 1_000, 'MAIN_FUNDING'),
      ],
    });

    expect(plan.pending.map(({ series }) => series)).toEqual([['FUNDING_MAIN'], ['MAIN_FUNDING']]);
  });

  it('merges the touching ranges of one series and never those of two', () => {
    const plan = planWalkPasses({
      ...input,
      pending: [
        rangeOf(start, start + 1_000, 'MAIN_FUNDING'),
        rangeOf(start + 1_000, start + 2_000, 'MAIN_FUNDING'),
        rangeOf(start + 1_000, start + 3_000, 'FUNDING_MAIN'),
      ],
    });

    expect(plan.pendingRanges.filter(({ end }) => end <= start + 3_000)).toEqual([
      rangeOf(start, start + 2_000, 'MAIN_FUNDING'),
      rangeOf(start + 1_000, start + 3_000, 'FUNDING_MAIN'),
    ]);
  });

  it('drops a range owed in one series that lies below the floor, like any owed range', () => {
    const plan = planWalkPasses({
      ...input,
      floorMs: start + 5_000,
      pending: [rangeOf(start, start + 1_000, 'MAIN_FUNDING')],
    });

    expect(plan.pending).toEqual([]);
  });

  it('merges the nearest ranges of one series past the limit, and never into another series', () => {
    const owed = Array.from({ length: 14 }, (_unused, index) =>
      rangeOf(start + index * 10_000, start + index * 10_000 + 1_000, 'MAIN_FUNDING'),
    );
    const other = rangeOf(start + 5_500, start + 5_600, 'FUNDING_MAIN');

    const plan = planWalkPasses({ ...input, pending: [...owed, other] });

    expect(plan.pendingRanges.filter(({ series }) => series === 'FUNDING_MAIN')).toEqual([other]);
    expect(plan.pendingRanges.filter(({ series }) => series === 'MAIN_FUNDING')).toHaveLength(12);
    expect(plan.pendingRanges.filter(({ series }) => series === undefined)).toHaveLength(1);
  });
});

describe('advanceWalkMarks, with ranges that are owed in one series', () => {
  const markOf = (pending: OwedGround[]): WalkMarks => ({
    cursor: 900,
    rescanCursor: 50_000,
    pointCursor: null,
    rangeCursor: null,
    hints: NO_HINTS,
    pending,
  });

  const advance = async (input: {
    pass: WalkPass;
    span: WalkWindow;
    pending: OwedGround[];
    series?: string[];
    owed?: OwedGround[];
  }) => {
    const marks = markOf(input.pending);

    await advanceWalkMarks({
      pass: input.pass,
      span: input.span,
      series: input.series,
      owed: input.owed ?? [],
      plan: planOf({ rescanEnd: 1_000_000 }),
      marks,
      restartMs: 5,
      fields: FIELDS,
      write: async () => undefined,
      writePending: async () => undefined,
    });

    return marks.pending;
  };

  const whole = { start: 70_000, end: 90_000 };

  it('takes the ground a pending span reads out of the ranges of its series only', async () => {
    const pending = await advance({
      pass: 'pending',
      span: whole,
      series: ['MAIN_FUNDING'],
      pending: [
        rangeOf(70_000, 90_000, 'MAIN_FUNDING'),
        rangeOf(70_000, 90_000, 'FUNDING_MAIN'),
        rangeOf(70_000, 90_000),
      ],
    });

    expect(pending).toEqual([rangeOf(70_000, 90_000), rangeOf(70_000, 90_000, 'FUNDING_MAIN')]);
  });

  it('takes the ground a pending span reads in every series out of every range, whatever its series', async () => {
    const pending = await advance({
      pass: 'pending',
      span: whole,
      pending: [
        rangeOf(70_000, 90_000, 'MAIN_FUNDING'),
        rangeOf(70_000, 90_000, 'FUNDING_MAIN'),
        rangeOf(70_000, 90_000),
      ],
    });

    expect(pending).toEqual([]);
  });

  it('takes the ground a re-scan span reads out of the ranges of every series', async () => {
    const pending = await advance({
      pass: 'rescan',
      span: whole,
      pending: [rangeOf(70_000, 90_000, 'MAIN_FUNDING'), rangeOf(80_000, 95_000, 'FUNDING_MAIN')],
    });

    expect(pending).toEqual([rangeOf(90_000, 95_000, 'FUNDING_MAIN')]);
  });

  it('keeps what is left of a range of the series read, in that series', async () => {
    const pending = await advance({
      pass: 'pending',
      span: { start: 70_000, end: 80_000 },
      series: ['MAIN_FUNDING'],
      pending: [rangeOf(70_000, 90_000, 'MAIN_FUNDING')],
    });

    expect(pending).toEqual([rangeOf(80_000, 90_000, 'MAIN_FUNDING')]);
  });

  it('stores the same ground owed again once, merged with the range it touches', async () => {
    const pending = await advance({
      pass: 'pending',
      span: { start: 10, end: 20 },
      pending: [rangeOf(70_000, 90_000, 'MAIN_FUNDING')],
      owed: [rangeOf(90_000, 90_500, 'MAIN_FUNDING'), rangeOf(70_000, 90_000, 'MAIN_FUNDING')],
    });

    expect(pending).toEqual([rangeOf(70_000, 90_500, 'MAIN_FUNDING')]);
  });

  it('stores the ground a forward span owes in one series, before the cursor moves past it', async () => {
    const owed = rangeOf(1_000, 1_900, 'MAIN_FUNDING');
    const marks = markOf([]);
    const writes: string[] = [];

    await advanceWalkMarks({
      pass: 'forward',
      span: { start: 100, end: 2_000 },
      owed: [owed],
      plan: planOf({ rescanEnd: 1_000_000 }),
      marks,
      restartMs: 5,
      fields: FIELDS,
      write: async (field) => {
        writes.push(field);
      },
      writePending: async (field, ranges) => {
        writes.push(`${field}:${JSON.stringify(ranges)}`);
      },
    });

    expect(writes).toEqual([`${FIELDS.pending}:${JSON.stringify([owed])}`, FIELDS.cursor]);
  });
});

describe('readPendingMark, for ranges that are owed in one series', () => {
  const FIELD = 'binanceTransferPendingOverlap';
  const owedBefore = { start: 1_000, end: 5_000 };

  const readMark = (stored: OwedGround[], knownSeries?: string[]) => {
    const write = jest.fn(async () => undefined);

    return {
      write,
      ranges: readPendingMark({
        field: FIELD,
        metadata: { [FIELD]: stored },
        owedIfUnreadable: owedBefore,
        knownSeries,
        write,
      }),
    };
  };

  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('reads a range of a series the walk knows, and writes nothing', async () => {
    const stored = [rangeOf(10, 12, 'MAIN_FUNDING')];
    const { ranges, write } = readMark(stored, KNOWN);

    expect(await ranges).toEqual(stored);
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    ['a series the walk does not know', KNOWN],
    ['a walk that reads one series', undefined],
  ])('repairs the list like a malformed one for a range of %s', async (_label, known) => {
    const { ranges, write } = readMark([rangeOf(10, 12, 'MAIN_MARS')], known);

    expect(await ranges).toEqual([owedBefore]);
    expect(write).toHaveBeenCalledWith(FIELD, [owedBefore]);
  });
});

describe('commitSettledSpan, for ground that is owed in one series', () => {
  const span = { start: 100, end: 2_000 };

  const commit = (pass: WalkPass, owed: OwedGround[]) =>
    commitSettledSpan({
      pass,
      span,
      settled: { rows: [], codes: [], owed, returned: [] },
      place: async (planned) => planned,
      add: async (rows) => rows.length,
      advance: jest.fn(async () => undefined),
    });

  it('goes past it in the forward pass: it stays owed and holds nothing back', async () => {
    const committed = await commit('forward', [rangeOf(1_000, 1_900, 'MAIN_FUNDING')]);

    expect(committed).toEqual({
      imported: 0,
      owed: true,
      returned: [],
      stuck: [rangeOf(1_000, 1_900, 'MAIN_FUNDING')],
    });
  });

  it('holds the forward pass back for ground owed in every series', async () => {
    expect(await commit('forward', [rangeOf(1_000, 1_900)])).toBeUndefined();
  });
});
