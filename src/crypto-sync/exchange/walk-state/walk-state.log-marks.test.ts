import { type ParsedExchangeState, parseExchangeState, WALK_IDS } from './walk-state';

type ReadableState = Extract<ParsedExchangeState, { kind: 'parsed' }>;

const readableOf = (rest: Record<string, unknown>): ReadableState => {
  const parsed = parseExchangeState(JSON.stringify({ version: 1, walks: {}, ...rest }));

  if (parsed.kind === 'malformed') {
    throw new Error('walk-state log marks test: a state that should parse');
  }

  return parsed;
};

const marksOf = (entry: unknown, walkId: 'convert' | 'log' = 'convert') =>
  readableOf({ walks: { [walkId]: entry } }).walks[walkId];

describe('the walk ids', () => {
  it('lists the eight walks of the Binance state, in order, then the log walk', () => {
    expect(WALK_IDS).toEqual([
      'capital',
      'pay',
      'transfer',
      'earn',
      'convert',
      'p2p',
      'fiatOrders',
      'fiatPayments',
      'log',
    ]);
  });

  it('reads a log entry of marks on its own, like any other walk', () => {
    expect(marksOf({ cursor: 900, pending: [{ start: 1, end: 3 }] }, 'log')).toMatchObject({
      cursor: 900,
      pending: [{ start: 1, end: 3 }],
    });
  });
});

describe('the convert marks pageIndex and passOwed', () => {
  const point = { start: 1_000, end: 1_002, kind: 'point', series: 'convert', since: 7 };

  it('reads each stored mark as stored', () => {
    expect(marksOf({ cursor: 5, pageIndex: 3, passOwed: [point] })).toMatchObject({
      pageIndex: 3,
      passOwed: [point],
    });
  });

  it('reads an owed list of none as a list of none: the pass has begun and owes nothing yet', () => {
    expect(marksOf({ pageIndex: 2, passOwed: [] })).toMatchObject({ pageIndex: 2, passOwed: [] });
  });

  it('reads an entry that holds neither mark with neither, as a Binance entry is', () => {
    const marks = marksOf({ cursor: 5, pending: [] });

    expect(marks).not.toHaveProperty('pageIndex');
    expect(marks).not.toHaveProperty('passOwed');
  });

  it.each([
    ['zero', 0],
    ['a negative number', -1],
    ['a fraction', 1.5],
    ['text', '3'],
    ['null', null],
    ['a boolean', true],
  ])(
    'reads a pageIndex stored as %s as absent, so the pass starts again at page 1',
    (_label, stored) => {
      expect(marksOf({ pageIndex: stored })).not.toHaveProperty('pageIndex');
    },
  );

  it.each([
    ['text', 'x'],
    ['null', null],
    ['a list with an entry that is no range', [{ start: 'a', end: 1 }]],
  ])(
    'reads a passOwed stored as %s as absent, so the pass owes again what it reads',
    (_label, stored) => {
      expect(marksOf({ pageIndex: 4, passOwed: stored })).not.toHaveProperty('passOwed');
    },
  );
});

describe('the mark cursorReadAt', () => {
  it('reads the stored clock as stored, beside the cursor it belongs to', () => {
    expect(marksOf({ cursor: 5, cursorReadAt: 9 }, 'log')).toMatchObject({
      cursor: 5,
      cursorReadAt: 9,
    });
  });

  it('reads an entry that holds none with none, as a Binance entry is', () => {
    expect(marksOf({ cursor: 5, pending: [] })).not.toHaveProperty('cursorReadAt');
  });

  it.each([
    ['a negative number', -1],
    ['a fraction', 1.5],
    ['text', '9'],
    ['null', null],
    ['a boolean', true],
  ])(
    'reads a cursorReadAt stored as %s as absent, so the overlap day is owed',
    (_label, stored) => {
      expect(marksOf({ cursor: 5, cursorReadAt: stored }, 'log')).not.toHaveProperty(
        'cursorReadAt',
      );
    },
  );
});

describe('the log kinds', () => {
  it('are none when the state holds none, and nothing is named', () => {
    const parsed = readableOf({});

    expect(parsed.logKinds).toEqual([]);
    expect(parsed.unreadable).toEqual([]);
  });

  it('are read as stored, once each', () => {
    expect(readableOf({ logKinds: ['transfer', 'settlement', 'transfer'] }).logKinds).toEqual([
      'transfer',
      'settlement',
    ]);
  });

  it('are none and are named when the stored value is no list of text', () => {
    const parsed = readableOf({ logKinds: ['transfer', 7] });

    expect(parsed.logKinds).toEqual([]);
    expect(parsed.unreadable).toEqual(['logKinds']);
  });
});

describe('the dense spans', () => {
  it('are none when the state holds none, and nothing is named', () => {
    const parsed = readableOf({});

    expect(parsed.denseSpans).toEqual({});
    expect(parsed.unreadable).toEqual([]);
  });

  it('are read as stored: one start per series', () => {
    expect(
      readableOf({ denseSpans: { log: 1_700_000_000_000, fundingLedger: 5 } }).denseSpans,
    ).toEqual({
      log: 1_700_000_000_000,
      fundingLedger: 5,
    });
  });

  it('read no more than the two series, whatever else a newer build stored', () => {
    expect(readableOf({ denseSpans: { log: 5, other: 6, third: 7 } }).denseSpans).toEqual({
      log: 5,
    });
  });

  it('drop a start that is no time and name it, and the other start stays', () => {
    const parsed = readableOf({ denseSpans: { log: 'x', fundingLedger: 9 } });

    expect(parsed.denseSpans).toEqual({ fundingLedger: 9 });
    expect(parsed.unreadable).toEqual(['denseSpans.log']);
  });

  it('are none and are named when the stored value is no record', () => {
    const parsed = readableOf({ denseSpans: 5 });

    expect(parsed.denseSpans).toEqual({});
    expect(parsed.unreadable).toEqual(['denseSpans']);
  });
});
