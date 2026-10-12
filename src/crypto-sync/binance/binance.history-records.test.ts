import {
  commitSettledSpan,
  instantAt,
  joinSettled,
  settleRecords,
} from './binance.history-records';
import { BinanceWalkStop, type OwedGround, type WalkWindow } from './binance.history-walk';

const SPAN = { start: 1_000, end: 5_000 };

type Entry = { id: string; time: number | undefined; stuck: boolean };

const entry = (id: string, time: number | undefined, stuck = false): Entry => ({
  id,
  time,
  stuck,
});

const settle = (records: Entry[], extentOf: (record: Entry) => WalkWindow | undefined) =>
  settleRecords({
    span: SPAN,
    records,
    rowsOf: (record) => {
      if (record.stuck) {
        throw new BinanceWalkStop(`stuck-${record.id}`);
      }

      return [record.id];
    },
    extentOf,
  });

const atTime = (record: Entry) => instantAt(record.time);

const pointOf = (start: number, end: number): OwedGround => ({ start, end, kind: 'point' });

describe('instantAt', () => {
  it('is the one millisecond of a time', () => {
    expect(instantAt(7)).toEqual({ start: 7, end: 7 });
  });

  it('is nothing without a time', () => {
    expect(instantAt(undefined)).toBeUndefined();
  });
});

describe('settleRecords', () => {
  it('keeps the rows of the records it can trust, and owes nothing for them', () => {
    expect(settle([entry('a', 2_000), entry('b', 3_000)], atTime)).toEqual({
      rows: ['a', 'b'],
      codes: [],
      owed: [],
      returned: [
        { start: 1_999, end: 2_001 },
        { start: 2_999, end: 3_001 },
      ],
    });
  });

  it('gives the point of every record the read returned, the stuck ones too', () => {
    expect(settle([entry('a', 2_000), entry('s', 3_000, true)], atTime).returned).toEqual([
      { start: 1_999, end: 2_001 },
      { start: 2_999, end: 3_001 },
    ]);
    expect(settle([], atTime).returned).toEqual([]);
  });

  it('gives no point for a record with no time, one outside the span or one with no finite extent', () => {
    const records = [
      entry('none', undefined),
      entry('before', 10),
      entry('after', 90_000),
      entry('nan', Number.NaN),
    ];

    expect(settle(records, atTime).returned).toEqual([]);
  });

  it('owes only the point of a stuck record: its millisecond and one on each side', () => {
    expect(settle([entry('a', 2_000), entry('s', 3_000, true)], atTime)).toEqual({
      rows: ['a'],
      codes: ['stuck-s'],
      owed: [pointOf(2_999, 3_001)],
      returned: [
        { start: 1_999, end: 2_001 },
        { start: 2_999, end: 3_001 },
      ],
    });
  });

  it.each([
    ['last', SPAN.end],
    ['first', SPAN.start],
  ])(
    'owes the same point, uncut, for a record on the %s millisecond of the span',
    (_label, time) => {
      expect(settle([entry('s', time, true)], atTime).owed).toEqual([pointOf(time - 1, time + 1)]);
    },
  );

  it('owes one point to a record on the boundary two spans share, whichever span reads it', () => {
    const boundary = SPAN.end;
    const next = { start: SPAN.end, end: SPAN.end + 4_000 };
    const fromNext = settleRecords({
      span: next,
      records: [entry('s', boundary, true)],
      rowsOf: () => {
        throw new BinanceWalkStop('stuck');
      },
      extentOf: atTime,
    });

    expect(settle([entry('s', boundary, true)], atTime).owed).toEqual(fromNext.owed);
  });

  it('owes the whole extent of a record that has one, and one millisecond on each side', () => {
    const second = () => ({ start: 3_000, end: 3_999 });

    expect(settle([entry('s', 3_000, true)], second).owed).toEqual([pointOf(2_999, 4_000)]);
  });

  it('does not cut the point to the span', () => {
    const wide = () => ({ start: 500, end: 9_000 });

    expect(settle([entry('s', 3_000, true)], wide).owed).toEqual([pointOf(499, 9_001)]);
  });

  it.each([
    ['no time', undefined],
    ['a time before the span', 10],
    ['a time after the span', 90_000],
    ['a time that is no number', Number.NaN],
    ['a time that is not finite', Number.POSITIVE_INFINITY],
  ])('owes the whole span, as a range, for a stuck record with %s', (_label, time) => {
    expect(settle([entry('s', time, true)], atTime).owed).toEqual([SPAN]);
  });

  it('owes the whole span for an extent that is not finite', () => {
    const open = () => ({ start: 3_000, end: Number.POSITIVE_INFINITY });

    expect(settle([entry('s', 3_000, true)], open).owed).toEqual([SPAN]);
  });

  it('owes a point once for two stuck records at the same time', () => {
    const settled = settle([entry('s', 3_000, true), entry('t', 3_000, true)], atTime);

    expect(settled.owed).toEqual([pointOf(2_999, 3_001)]);
    expect(settled.codes).toEqual(['stuck-s', 'stuck-t']);
  });

  it('owes two points for two stuck records one millisecond apart, and never merges them', () => {
    expect(settle([entry('s', 3_000, true), entry('t', 3_001, true)], atTime).owed).toEqual([
      pointOf(2_999, 3_001),
      pointOf(3_000, 3_002),
    ]);
  });

  it('owes the whole span once, and the point of the record that has a time, side by side', () => {
    const settled = settle([entry('s', 3_000, true), entry('t', undefined, true)], atTime);

    expect(settled.owed).toEqual([pointOf(2_999, 3_001), SPAN]);
  });

  it('keeps a point that reaches past the span beside the whole span', () => {
    const settled = settle([entry('s', SPAN.start, true), entry('t', undefined, true)], atTime);

    expect(settled.owed).toEqual([pointOf(SPAN.start - 1, SPAN.start + 1), SPAN]);
  });

  it("keeps a one-millisecond span's record as its own point, not as the span it sits in", () => {
    const tiny = { start: 3_000, end: 3_001 };
    const settled = settleRecords({
      span: tiny,
      records: [entry('s', 3_001, true)],
      rowsOf: () => {
        throw new BinanceWalkStop('stuck');
      },
      extentOf: atTime,
    });

    expect(settled.owed).toEqual([pointOf(3_000, 3_002)]);
  });

  it('rethrows a failure that is not a stop', () => {
    expect(() =>
      settleRecords({
        span: SPAN,
        records: [1],
        rowsOf: () => {
          throw new Error('boom');
        },
        extentOf: () => undefined,
      }),
    ).toThrow('boom');
  });
});

describe('joinSettled', () => {
  it('is empty for no parts', () => {
    expect(joinSettled([])).toEqual({ rows: [], codes: [], owed: [], returned: [] });
  });

  it('puts the rows, the codes and the returned points of the parts together', () => {
    const first = { start: 1, end: 3 };
    const second = { start: 5, end: 7 };

    const joined = joinSettled([
      { rows: [1], codes: ['a'], owed: [], returned: [first] },
      { rows: [2], codes: ['b'], owed: [], returned: [second] },
    ]);

    expect(joined).toEqual({
      rows: [1, 2],
      codes: ['a', 'b'],
      owed: [],
      returned: [first, second],
    });
  });

  it('owes the whole span and the points inside it as separate entries, a point never absorbed', () => {
    const inside = pointOf(1_999, 2_001);
    const reaching = pointOf(SPAN.end - 1, SPAN.end + 1);

    const joined = joinSettled([
      { rows: [], codes: ['page'], owed: [SPAN], returned: [] },
      { rows: [], codes: ['one'], owed: [inside, reaching, reaching], returned: [] },
    ]);

    expect(joined.owed).toEqual([SPAN, inside, reaching]);
  });

  it('keeps a range and a point of one window as two entries, and the same entry once', () => {
    const window = { start: 3_000, end: 3_002 };

    const joined = joinSettled([
      { rows: [], codes: [], owed: [window, { ...window, kind: 'point' }], returned: [] },
      { rows: [], codes: [], owed: [window], returned: [] },
    ]);

    expect(joined.owed).toEqual([window, { ...window, kind: 'point' }]);
  });
});

describe('commitSettledSpan', () => {
  let warn: jest.SpyInstance;
  const calls: string[] = [];
  const add = jest.fn(async (rows: string[]) => {
    calls.push(`add:${rows.join(',')}`);

    return rows.length;
  });
  const advance = jest.fn(
    async ({ owed }: { owed: OwedGround[]; returned: WalkWindow[] }): Promise<void> => {
      calls.push(`advance:${owed.length}`);
    },
  );

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    calls.length = 0;
    add.mockClear();
    advance.mockClear();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const commit = (
    pass: 'forward' | 'pending' | 'rescan',
    settled: {
      rows: string[];
      codes: string[];
      owed: OwedGround[];
      returned?: WalkWindow[];
    },
    place: (planned: string[]) => Promise<string[]> = async (planned) => planned,
  ) =>
    commitSettledSpan({
      pass,
      span: SPAN,
      settled: { returned: [], ...settled },
      place,
      add,
      advance,
    });

  it.each(['pending', 'rescan'] as const)(
    'writes the rows before it moves the marks, in the %s pass, and says what is owed',
    async (pass) => {
      const owed = [pointOf(3_000, 3_001)];
      const returned = [{ start: 3_000, end: 3_001 }];

      const committed = await commit(pass, { rows: ['a', 'b'], codes: ['stuck'], owed, returned });

      expect(calls).toEqual(['add:a,b', 'advance:1']);
      expect(advance).toHaveBeenCalledWith({ owed, returned });
      expect(committed).toEqual({ imported: 2, owed: true });
    },
  );

  it('writes no rows when there are none, and still moves the marks', async () => {
    const committed = await commit('rescan', { rows: [], codes: [], owed: [] });

    expect(add).not.toHaveBeenCalled();
    expect(advance).toHaveBeenCalledWith({ owed: [], returned: [] });
    expect(committed).toEqual({ imported: 0, owed: false });
  });

  it('hands the points of the returned records on, so a point stays after a read that found none', async () => {
    const found = { start: 2_999, end: 3_001 };

    await commit('pending', { rows: [], codes: [], owed: [], returned: [found] });
    await commit('pending', { rows: [], codes: [], owed: [] });

    expect(advance.mock.calls.map(([result]) => result.returned)).toEqual([[found], []]);
  });

  it('logs each code once', async () => {
    await commit('pending', { rows: [], codes: ['same', 'same', 'other'], owed: [SPAN] });

    expect(warn.mock.calls).toEqual([
      ['[binance sync] history window stopped', { name: 'BinanceWalkStop', code: 'same' }],
      ['[binance sync] history window stopped', { name: 'BinanceWalkStop', code: 'other' }],
    ]);
  });

  it('stops the forward pass on any stop, before it places or writes anything', async () => {
    const place = jest.fn(async (planned: string[]) => planned);

    const committed = await commit(
      'forward',
      { rows: ['a'], codes: ['stuck'], owed: [pointOf(3_000, 3_001)] },
      place,
    );

    expect(committed).toBeUndefined();
    expect(place).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('commits a forward span with nothing stuck', async () => {
    const committed = await commit('forward', { rows: ['a'], codes: [], owed: [] });

    expect(calls).toEqual(['add:a', 'advance:0']);
    expect(committed).toEqual({ imported: 1, owed: false });
  });

  describe('when the rows cannot be placed', () => {
    const unplaceable = async (): Promise<string[]> => {
      throw new BinanceWalkStop('holding-missing');
    };

    it.each(['pending', 'rescan'] as const)(
      'writes no row and owes the whole span beside the points of the stuck records, in the %s pass',
      async (pass) => {
        const point = pointOf(3_000, 3_001);
        const returned = [{ start: 3_000, end: 3_001 }];

        const committed = await commit(
          pass,
          { rows: ['a'], codes: ['stuck'], owed: [point], returned },
          unplaceable,
        );

        expect(add).not.toHaveBeenCalled();
        expect(advance).toHaveBeenCalledWith({ owed: [point, SPAN], returned });
        expect(committed).toEqual({ imported: 0, owed: true });
        expect(warn.mock.calls.map(([, detail]) => detail.code)).toEqual([
          'stuck',
          'holding-missing',
        ]);
      },
    );

    it('owes the span once when it is owed already', async () => {
      await commit('pending', { rows: ['a'], codes: [], owed: [SPAN] }, unplaceable);

      expect(advance).toHaveBeenCalledWith({ owed: [SPAN], returned: [] });
    });

    it('stops the forward pass, writing nothing', async () => {
      const committed = await commit('forward', { rows: ['a'], codes: [], owed: [] }, unplaceable);

      expect(committed).toBeUndefined();
      expect(add).not.toHaveBeenCalled();
      expect(advance).not.toHaveBeenCalled();
    });

    it('rethrows a failure that is not a stop', async () => {
      await expect(
        commit('pending', { rows: ['a'], codes: [], owed: [] }, async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
    });
  });
});
