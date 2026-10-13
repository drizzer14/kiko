import type { HoldingRow } from '@kiko/db';

import {
  commitSettledSpan,
  instantAt,
  joinSettled,
  placeWalletRows,
  settleRecords,
  settleUnreadable,
} from './binance.history-records';
import { BinanceWalkStop, type OwedGround, type WalkWindow } from './binance.history-walk';
import { type BinanceWalletKey, EARN_KEY, FUNDING_KEY, SPOT_KEY } from './binance.holding-keys';

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

  describe('with a reach wider than the span, where a read returns a record', () => {
    const SECOND_SPAN = { start: 5_400, end: 9_000 };
    const REACH = { start: 5_000, end: SECOND_SPAN.end };
    const settleWith = (records: Entry[], reach: WalkWindow | undefined) =>
      settleRecords({
        span: SECOND_SPAN,
        reach,
        records,
        rowsOf: (record) => {
          throw new BinanceWalkStop(`stuck-${record.id}`);
        },
        extentOf: atTime,
      });
    const settleReaching = (records: Entry[]) => settleWith(records, REACH);

    it('owes the point, not the span, of a stuck record before the span but inside the reach', () => {
      const settled = settleReaching([entry('s', 5_000, true)]);

      expect(settled.owed).toEqual([pointOf(4_999, 5_001)]);
      expect(settled.returned).toEqual([{ start: 4_999, end: 5_001 }]);
    });

    it('owes the span for a stuck record before the reach', () => {
      expect(settleReaching([entry('s', 4_999, true)]).owed).toEqual([SECOND_SPAN]);
    });

    it('owes the span for a stuck record after the span, the reach never moving its end', () => {
      expect(settleReaching([entry('s', 9_001, true)]).owed).toEqual([SECOND_SPAN]);
    });

    it('owes the span, not the reach, for a stuck record with no time', () => {
      expect(settleReaching([entry('s', undefined, true)]).owed).toEqual([SECOND_SPAN]);
    });

    it('reads a span with no reach by the span itself', () => {
      expect(settleWith([entry('s', 5_000, true)], undefined).owed).toEqual([SECOND_SPAN]);
    });

    it('lets settleUnreadable reach too', () => {
      const settled = settleUnreadable({
        span: SECOND_SPAN,
        reach: REACH,
        unreadable: [{ time: 5_000 }, { time: 4_999 }],
        code: 'row-unreadable',
        extentOf: (row) => instantAt(row.time),
      });

      expect(settled.owed).toEqual([pointOf(4_999, 5_001), SECOND_SPAN]);
      expect(settled.returned).toEqual([{ start: 4_999, end: 5_001 }]);
    });
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

  describe('with a series of its own for each record', () => {
    type Typed = Entry & { series: string };

    const typed = (id: string, time: number | undefined, series: string, stuck = false): Typed => ({
      ...entry(id, time, stuck),
      series,
    });
    const settleTyped = (records: Typed[]) =>
      settleRecords({
        span: SPAN,
        records,
        rowsOf: (record) => {
          if (record.stuck) {
            throw new BinanceWalkStop(`stuck-${record.id}`);
          }

          return [record.id];
        },
        extentOf: atTime,
        seriesOf: (record) => record.series,
      });

    it('owes the point of a stuck record in the series it was read under', () => {
      const settled = settleTyped([typed('s', 3_000, 'MAIN_FUNDING', true)]);

      expect(settled.owed).toEqual([{ ...pointOf(2_999, 3_001), series: 'MAIN_FUNDING' }]);
    });

    it('gives the point of every returned record in its own series, the trusted ones too', () => {
      const settled = settleTyped([
        typed('a', 2_000, 'FUNDING_MAIN'),
        typed('s', 3_000, 'MAIN_FUNDING', true),
      ]);

      expect(settled.returned).toEqual([
        { start: 1_999, end: 2_001, series: 'FUNDING_MAIN' },
        { start: 2_999, end: 3_001, series: 'MAIN_FUNDING' },
      ]);
    });

    it('owes the points of two records at one time in two series as two points', () => {
      const settled = settleTyped([
        typed('s', 3_000, 'MAIN_FUNDING', true),
        typed('t', 3_000, 'FUNDING_MAIN', true),
        typed('u', 3_000, 'MAIN_FUNDING', true),
      ]);

      expect(settled.owed).toEqual([
        { ...pointOf(2_999, 3_001), series: 'MAIN_FUNDING' },
        { ...pointOf(2_999, 3_001), series: 'FUNDING_MAIN' },
      ]);
    });

    it('owes the span, with no series, for a stuck record that has no usable time', () => {
      const settled = settleTyped([typed('s', undefined, 'MAIN_FUNDING', true)]);

      expect(settled.owed).toEqual([SPAN]);
      expect(settled.returned).toEqual([]);
    });

    it('gives no series to a point when no record names one, as the Pay and capital walks read', () => {
      const settled = settle([entry('s', 3_000, true)], atTime);

      expect(Object.keys(settled.owed[0])).toEqual(['start', 'end', 'kind']);
      expect(Object.keys(settled.returned[0])).toEqual(['start', 'end']);
    });
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

describe('settleUnreadable', () => {
  const rowAt = (time: number | string | undefined) => ({ time });
  const timeOf = (row: { time: number | string | undefined }) =>
    instantAt(typeof row.time === 'number' ? row.time : undefined);
  const settleRows = (rows: { time: number | string | undefined }[]) =>
    settleUnreadable({ span: SPAN, unreadable: rows, code: 'row-unreadable', extentOf: timeOf });

  it('owes the point of an unreadable row with a usable time, and gives no rows', () => {
    expect(settleRows([rowAt(3_000)])).toEqual({
      rows: [],
      codes: ['row-unreadable'],
      owed: [pointOf(2_999, 3_001)],
      returned: [{ start: 2_999, end: 3_001 }],
    });
  });

  it('owes the whole span for an unreadable row with no usable time, and returns no point', () => {
    expect(settleRows([rowAt(undefined)])).toEqual({
      rows: [],
      codes: ['row-unreadable'],
      owed: [SPAN],
      returned: [],
    });
  });

  it('owes the span for a row whose time is outside it, which says nothing of where it sits', () => {
    expect(settleRows([rowAt(90_000)]).owed).toEqual([SPAN]);
  });

  it('settles every row on its own, and owes the span once for several rows with no time', () => {
    const settled = settleRows([rowAt(2_000), rowAt(undefined), rowAt(undefined), rowAt(3_000)]);

    expect(settled.owed).toEqual([pointOf(1_999, 2_001), SPAN, pointOf(2_999, 3_001)]);
    expect(settled.codes).toEqual([
      'row-unreadable',
      'row-unreadable',
      'row-unreadable',
      'row-unreadable',
    ]);
  });

  it('settles nothing for a page with no unreadable row', () => {
    expect(settleRows([])).toEqual({ rows: [], codes: [], owed: [], returned: [] });
  });

  it('owes the point of an unreadable row in the series it was read under', () => {
    const settled = settleUnreadable({
      span: SPAN,
      unreadable: [
        { time: 3_000, series: 'MAIN_FUNDING' },
        { time: undefined, series: 'X' },
      ],
      code: 'row-unreadable',
      extentOf: timeOf,
      seriesOf: (row) => row.series,
    });

    expect(settled.owed).toEqual([{ ...pointOf(2_999, 3_001), series: 'MAIN_FUNDING' }, SPAN]);
    expect(settled.returned).toEqual([{ start: 2_999, end: 3_001, series: 'MAIN_FUNDING' }]);
  });

  it('is what the walk reads, beside the records it can settle, as one span', () => {
    const joined = joinSettled([settle([entry('a', 2_000)], atTime), settleRows([rowAt(3_000)])]);

    expect(joined.rows).toEqual(['a']);
    expect(joined.owed).toEqual([pointOf(2_999, 3_001)]);
  });
});

describe('commitSettledSpan', () => {
  let warn: jest.SpyInstance;
  const calls: string[] = [];
  const add = jest.fn(async (rows: string[]) => {
    calls.push(`add:${rows.join(',')}`);

    return rows.length;
  });
  const advance = jest.fn(async ({ owed }: { owed: OwedGround[] }): Promise<void> => {
    calls.push(`advance:${owed.length}`);
  });

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
      expect(advance).toHaveBeenCalledWith({ owed });
      expect(committed).toEqual({ imported: 2, owed: true, returned, stuck: owed });
    },
  );

  it('writes no rows when there are none, and still moves the marks', async () => {
    const committed = await commit('rescan', { rows: [], codes: [], owed: [] });

    expect(add).not.toHaveBeenCalled();
    expect(advance).toHaveBeenCalledWith({ owed: [] });
    expect(committed).toEqual({ imported: 0, owed: false, returned: [], stuck: [] });
  });

  it('reports the points of the returned records, so the window can take a point off once it completes', async () => {
    const found = { start: 2_999, end: 3_001 };

    const withOne = await commit('pending', { rows: [], codes: [], owed: [], returned: [found] });
    const withNone = await commit('pending', { rows: [], codes: [], owed: [] });

    expect([withOne?.returned, withNone?.returned]).toEqual([[found], []]);
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
    expect(committed).toEqual({ imported: 1, owed: false, returned: [], stuck: [] });
  });

  describe('with a code the forward pass owes and goes past', () => {
    const point = pointOf(3_000, 3_001);
    const commitOwing = (
      settled: { rows: string[]; codes: string[]; owed: OwedGround[] },
      place: (planned: string[]) => Promise<string[]> = async (planned) => planned,
    ) =>
      commitSettledSpan({
        pass: 'forward',
        span: SPAN,
        settled: { returned: [], ...settled },
        place,
        add,
        advance,
        forwardOwes: ['owed-only'],
      });

    it('commits the rows of the span and moves the marks with the ground it owes, so the cursor can pass it', async () => {
      const committed = await commitOwing({ rows: ['a'], codes: ['owed-only'], owed: [point] });

      expect(calls).toEqual(['add:a', 'advance:1']);
      expect(advance).toHaveBeenCalledWith({ owed: [point] });
      expect(committed).toEqual({ imported: 1, owed: true, returned: [], stuck: [point] });
    });

    it('logs the code like any other', async () => {
      await commitOwing({ rows: [], codes: ['owed-only'], owed: [point] });

      expect(warn.mock.calls).toEqual([
        ['[binance sync] history window stopped', { name: 'BinanceWalkStop', code: 'owed-only' }],
      ]);
    });

    it('stops the forward pass, writing nothing, when a code it does not owe is beside it', async () => {
      const committed = await commitOwing({
        rows: ['a'],
        codes: ['owed-only', 'stuck'],
        owed: [point, pointOf(5_000, 5_001)],
      });

      expect(committed).toBeUndefined();
      expect(add).not.toHaveBeenCalled();
      expect(advance).not.toHaveBeenCalled();
    });

    it('stops the forward pass, writing nothing, for that very code when it owes the whole span: the record has no time to owe a point at', async () => {
      const committed = await commitOwing({ rows: ['a'], codes: ['owed-only'], owed: [SPAN] });

      expect(committed).toBeUndefined();
      expect(add).not.toHaveBeenCalled();
      expect(advance).not.toHaveBeenCalled();
    });

    it('stops the forward pass when one record owes a point and another the whole span', async () => {
      const committed = await commitOwing({
        rows: ['a'],
        codes: ['owed-only', 'owed-only'],
        owed: [point, SPAN],
      });

      expect(committed).toBeUndefined();
      expect(add).not.toHaveBeenCalled();
    });

    it('stops the forward pass when the rows cannot be placed, whatever else the span owes', async () => {
      const committed = await commitOwing(
        { rows: ['a'], codes: ['owed-only'], owed: [point] },
        async () => {
          throw new BinanceWalkStop('holding-missing');
        },
      );

      expect(committed).toBeUndefined();
      expect(add).not.toHaveBeenCalled();
      expect(advance).not.toHaveBeenCalled();
    });

    it('stops the forward pass for the same code when none is owed', async () => {
      const committed = await commit('forward', {
        rows: ['a'],
        codes: ['owed-only'],
        owed: [point],
      });

      expect(committed).toBeUndefined();
    });
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
        expect(advance).toHaveBeenCalledWith({ owed: [point, SPAN] });
        expect(committed).toEqual({ imported: 0, owed: true, returned, stuck: [point, SPAN] });
        expect(warn.mock.calls.map(([, detail]) => detail.code)).toEqual([
          'stuck',
          'holding-missing',
        ]);
      },
    );

    it('owes the span once when it is owed already', async () => {
      await commit('pending', { rows: ['a'], codes: [], owed: [SPAN] }, unplaceable);

      expect(advance).toHaveBeenCalledWith({ owed: [SPAN] });
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

describe('placeWalletRows', () => {
  type PlannedRow = {
    wallet: BinanceWalletKey;
    counterpartWallet?: BinanceWalletKey;
    externalId: string;
    amountMinorUnits?: number;
  };

  const holdingOf = (key: string): HoldingRow =>
    ({ id: `h-${key}`, metadata: { binanceAsset: key } }) as unknown as HoldingRow;
  const listHoldings = jest.fn(async (_accountId: string) => [
    holdingOf(SPOT_KEY),
    holdingOf(FUNDING_KEY),
  ]);
  const ensureHoldings = jest.fn(async (_holdings: unknown[]) => undefined);
  const place = (planned: PlannedRow[]) =>
    placeWalletRows({
      accountId: 'acc-1',
      planned,
      listHoldings,
      ensureHoldings,
      missingCode: 'x-holding-missing',
    });

  beforeEach(() => {
    listHoldings.mockClear();
    ensureHoldings.mockClear();
  });

  it('reads no holding for no rows', async () => {
    await expect(place([])).resolves.toEqual([]);
    expect(listHoldings).not.toHaveBeenCalled();
  });

  it('puts a row on its wallet holding, with the source', async () => {
    await expect(
      place([{ wallet: FUNDING_KEY, externalId: 'a', amountMinorUnits: 5 }]),
    ).resolves.toEqual([
      { holdingId: `h-${FUNDING_KEY}`, source: 'binance', externalId: 'a', amountMinorUnits: 5 },
    ]);
  });

  it('puts the other leg of a row on its own holding', async () => {
    await expect(
      place([{ wallet: SPOT_KEY, counterpartWallet: FUNDING_KEY, externalId: 'a' }]),
    ).resolves.toEqual([
      {
        holdingId: `h-${SPOT_KEY}`,
        exchangeCounterpartHoldingId: `h-${FUNDING_KEY}`,
        source: 'binance',
        externalId: 'a',
      },
    ]);
  });

  it('keeps one row of a key, the last one read', async () => {
    const rows = await place([
      { wallet: SPOT_KEY, externalId: 'a', amountMinorUnits: 1 },
      { wallet: FUNDING_KEY, externalId: 'a', amountMinorUnits: 2 },
    ]);

    expect(rows.map((row) => row.amountMinorUnits)).toEqual([2]);
  });

  it('creates a missing wallet a row sits on, once for every row of it', async () => {
    listHoldings
      .mockResolvedValueOnce([holdingOf(SPOT_KEY)])
      .mockResolvedValueOnce([holdingOf(SPOT_KEY), holdingOf(EARN_KEY)]);

    const rows = await place([
      { wallet: EARN_KEY, counterpartWallet: SPOT_KEY, externalId: 'a' },
      { wallet: EARN_KEY, externalId: 'b' },
    ]);

    expect(ensureHoldings).toHaveBeenCalledTimes(1);
    expect(ensureHoldings.mock.calls[0][0]).toEqual([
      expect.objectContaining({ metadataKey: EARN_KEY }),
    ]);
    expect(rows.map((row) => row.holdingId)).toEqual([`h-${EARN_KEY}`, `h-${EARN_KEY}`]);
  });

  it('creates a missing wallet that only the other leg of a row names', async () => {
    listHoldings
      .mockResolvedValueOnce([holdingOf(SPOT_KEY)])
      .mockResolvedValueOnce([holdingOf(SPOT_KEY), holdingOf(EARN_KEY)]);

    const rows = await place([{ wallet: SPOT_KEY, counterpartWallet: EARN_KEY, externalId: 'a' }]);

    expect(ensureHoldings.mock.calls[0][0]).toEqual([
      expect.objectContaining({ metadataKey: EARN_KEY }),
    ]);
    expect(rows[0].exchangeCounterpartHoldingId).toBe(`h-${EARN_KEY}`);
  });

  it('stops with the code when a wallet has no holding even after creation', async () => {
    await expect(place([{ wallet: EARN_KEY, externalId: 'a' }])).rejects.toEqual(
      new BinanceWalkStop('x-holding-missing'),
    );
  });

  it('stops with the code when only the other leg has no holding', async () => {
    await expect(
      place([{ wallet: SPOT_KEY, counterpartWallet: EARN_KEY, externalId: 'a' }]),
    ).rejects.toEqual(new BinanceWalkStop('x-holding-missing'));
  });
});
