import {
  commitSettledSpan,
  instantAt,
  joinSettled,
  type OwedGround,
  type SettledSpan,
  settleRecords,
} from '@kiko/crypto-sync/exchange/walk';

const SPAN = { start: 1_000, end: 5_000 };

type Entry = { id: string; time: number | undefined; ticker: string };

const entry = (id: string, ticker: string, time: number | undefined = 2_000): Entry => ({
  id,
  time,
  ticker,
});

const settle = (records: Entry[], tracked: readonly string[] = ['BTC']) =>
  settleRecords({
    span: SPAN,
    records,
    rowsOf: (record) => [record.id],
    extentOf: (record) => instantAt(record.time),
    untrackedOf: (record) => (tracked.includes(record.ticker) ? undefined : record.ticker),
  });

const pointOf = (start: number, end: number): OwedGround => ({ start, end, kind: 'point' });

/** A settled span of no rows, whatever the test gives it. */
const settled = (over: Partial<SettledSpan<string>> = {}): SettledSpan<string> => ({
  rows: [],
  codes: [],
  owed: [],
  returned: [],
  ...over,
});

describe('settleRecords with an untracked record', () => {
  it('counts it by its point, imports no row, and names its ticker', () => {
    expect(settle([entry('a', 'PEPE', 2_000)])).toEqual({
      rows: [],
      codes: [],
      owed: [],
      returned: [{ start: 1_999, end: 2_001 }],
      untracked: ['PEPE'],
    });
  });

  it('imports the other records of the span beside it', () => {
    const result = settle([entry('a', 'BTC', 2_000), entry('b', 'PEPE', 3_000)]);

    expect(result.rows).toEqual(['a']);
    expect(result.returned).toEqual([
      { start: 1_999, end: 2_001 },
      { start: 2_999, end: 3_001 },
    ]);
    expect(result.untracked).toEqual(['PEPE']);
  });

  it('counts it with no point when its time is unusable, and owes nothing for it', () => {
    const result = settle([{ ...entry('a', 'PEPE'), time: undefined }]);

    expect(result.returned).toEqual([]);
    expect(result.owed).toEqual([]);
    expect(result.untracked).toEqual(['PEPE']);
  });

  it('names a ticker once, however many of its records the span holds', () => {
    const result = settle([entry('a', 'PEPE'), entry('b', 'PEPE'), entry('c', 'DOGE')]);

    expect(result.untracked).toEqual(['PEPE', 'DOGE']);
  });

  it('has no untracked list when every record is tracked', () => {
    expect(settle([entry('a', 'BTC')])).not.toHaveProperty('untracked');
  });

  it('reads every record as a row when the walk gives no untrackedOf', () => {
    const result = settleRecords({
      span: SPAN,
      records: [entry('a', 'PEPE')],
      rowsOf: (record) => [record.id],
      extentOf: (record) => instantAt(record.time),
    });

    expect(result.rows).toEqual(['a']);
    expect(result).not.toHaveProperty('untracked');
  });
});

describe('joinSettled with untracked tickers', () => {
  it('lists each ticker of the parts once', () => {
    const joined = joinSettled([
      settled({ untracked: ['PEPE'] }),
      settled(),
      settled({ untracked: ['DOGE', 'PEPE'] }),
    ]);

    expect(joined.untracked).toEqual(['PEPE', 'DOGE']);
  });

  it('has none when no part has one', () => {
    expect(joinSettled([settled(), settled()])).not.toHaveProperty('untracked');
  });
});

describe('commitSettledSpan with untracked tickers', () => {
  const calls: string[] = [];
  const writeUntracked = jest.fn(async (tickers: readonly string[]): Promise<void> => {
    calls.push(`untracked:${tickers.join(',')}`);
  });

  beforeEach(() => {
    calls.length = 0;
    writeUntracked.mockClear();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const commit = (pass: 'forward' | 'pending' | 'rescan', span: SettledSpan<string>) =>
    commitSettledSpan({
      pass,
      span: SPAN,
      settled: span,
      place: async (planned: string[]) => planned,
      add: async (rows: string[]) => {
        calls.push(`add:${rows.join(',')}`);

        return rows.length;
      },
      advance: async () => {
        calls.push('advance');
      },
      writeOversized: async () => undefined,
      writeUntracked,
    });

  it.each(['forward', 'pending', 'rescan'] as const)(
    'writes them once between the rows and the marks, in the %s pass',
    async (pass) => {
      await commit(pass, settled({ rows: ['a'], untracked: ['PEPE', 'DOGE'] }));

      expect(calls).toEqual(['add:a', 'untracked:PEPE,DOGE', 'advance']);
    },
  );

  it('writes them for a span that imports no row', async () => {
    await commit('forward', settled({ untracked: ['PEPE'] }));

    expect(calls).toEqual(['untracked:PEPE', 'advance']);
  });

  it('writes none when the span met none', async () => {
    await commit('forward', settled({ rows: ['a'] }));

    expect(writeUntracked).not.toHaveBeenCalled();
    expect(calls).toEqual(['add:a', 'advance']);
  });

  it('writes none when the forward pass stops, as it commits nothing of its span', async () => {
    const committed = await commit('forward', {
      ...settled({ untracked: ['PEPE'], codes: ['stuck'] }),
      owed: [pointOf(1_999, 2_001)],
    });

    expect(committed).toBeUndefined();
    expect(calls).toEqual([]);
  });
});
