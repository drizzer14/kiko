import { commitSettledSpan, joinSettled, notImportedWriterOf, type SettledSpan } from './records';

const SPAN = { start: 1_000, end: 5_000 };

/** A settled span of no rows, whatever the test gives it. */
const settled = (over: Partial<SettledSpan<string>> = {}): SettledSpan<string> => ({
  rows: [],
  codes: [],
  owed: [],
  returned: [],
  ...over,
});

describe('joinSettled with not-imported entries', () => {
  it('joins the entries of every part once', () => {
    const joined = joinSettled([
      settled({ notImported: ['p2p-sale:1:2'] }),
      settled(),
      settled({ notImported: ['convert-unrecognized:3:4', 'p2p-sale:1:2'] }),
    ]);

    expect(joined.notImported).toEqual(['p2p-sale:1:2', 'convert-unrecognized:3:4']);
  });

  it('has none when no part has one', () => {
    expect(joinSettled([settled(), settled()])).not.toHaveProperty('notImported');
  });
});

describe('commitSettledSpan with not-imported entries', () => {
  const calls: string[] = [];
  const writeNotImported = jest.fn(async (entries: readonly string[]): Promise<void> => {
    calls.push(`notImported:${entries.join(',')}`);
  });

  beforeEach(() => {
    calls.length = 0;
    writeNotImported.mockClear();
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
      writeUntracked: async (tickers) => {
        calls.push(`untracked:${tickers.join(',')}`);
      },
      writeNotImported,
    });

  it.each(['forward', 'pending', 'rescan'] as const)(
    'writes the entries after the rows and before the marks, in the %s pass',
    async (pass) => {
      await commit(pass, settled({ rows: ['a'], notImported: ['p2p-sale:1:2', 'p2p-amount:3:4'] }));

      expect(calls).toEqual(['add:a', 'notImported:p2p-sale:1:2,p2p-amount:3:4', 'advance']);
    },
  );

  it('writes them after the untracked tickers of the same span, as one more write', async () => {
    await commit('forward', settled({ untracked: ['PEPE'], notImported: ['p2p-sale:1:2'] }));

    expect(calls).toEqual(['untracked:PEPE', 'notImported:p2p-sale:1:2', 'advance']);
  });

  it('writes them for a span that imports no row', async () => {
    await commit('forward', settled({ notImported: ['p2p-sale:1:2'] }));

    expect(calls).toEqual(['notImported:p2p-sale:1:2', 'advance']);
  });

  it('writes nothing when the span holds no entry', async () => {
    await commit('forward', settled({ rows: ['a'] }));

    expect(writeNotImported).not.toHaveBeenCalled();
    expect(calls).toEqual(['add:a', 'advance']);
  });

  it('writes no entry for a forward span that stops, as it commits nothing of its span', async () => {
    const committed = await commit('forward', {
      ...settled({ notImported: ['p2p-sale:1:2'], codes: ['stuck'] }),
      owed: [{ start: 1_999, end: 2_001, kind: 'point' }],
    });

    expect(committed).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('hands a span that holds entries to the writer, all of them, before the marks move', async () => {
    const committed = await commit(
      'forward',
      settled({ rows: ['a'], notImported: ['p2p-sale:1:2', 'convert-unrecognized:3:4'] }),
    );

    expect(writeNotImported).toHaveBeenCalledTimes(1);
    expect(writeNotImported).toHaveBeenCalledWith(['p2p-sale:1:2', 'convert-unrecognized:3:4']);
    expect(calls).toEqual([
      'add:a',
      'notImported:p2p-sale:1:2,convert-unrecognized:3:4',
      'advance',
    ]);
    expect(committed?.imported).toBe(1);
  });
});

describe('notImportedWriterOf', () => {
  it('writes the entries of a span as one patch for the account', async () => {
    const patchExchangeState = jest.fn(async () => undefined);

    await notImportedWriterOf({ patchExchangeState }, 'acc-1')(['p2p-sale:1:2', 'p2p-amount:3:4']);

    expect(patchExchangeState).toHaveBeenCalledTimes(1);
    expect(patchExchangeState).toHaveBeenCalledWith('acc-1', [
      { kind: 'notImported', entries: ['p2p-sale:1:2', 'p2p-amount:3:4'] },
    ]);
  });
});
