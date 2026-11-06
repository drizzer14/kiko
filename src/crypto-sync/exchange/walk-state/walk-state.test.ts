import { WALK_NAMES, type WalkField } from '@kiko/test-support/walk-marks';

import { readPendingMark, readPointCursor, readRangeCursor, readSpanHints } from '../walk';

import {
  type ExchangeState,
  type ParsedExchangeState,
  type ParsedWalkMarks,
  parseExchangeState,
  WALK_IDS,
  type WalkId,
} from './walk-state';

type ReadableState = Extract<ParsedExchangeState, { kind: 'parsed' }>;

type Metadata = Record<string, unknown>;

const NO_HINTS = { forward: [], pending: [], rescan: [], point: [] };

const emptyMarks = (): ParsedWalkMarks => ({
  cursor: null,
  rescan: null,
  pending: [],
  pointCursor: null,
  rangeCursor: null,
  spanHints: NO_HINTS,
});

const EMPTY_TRADES = { symbols: {}, rotation: '', balanceSnapshot: {} };

const EMPTY_STATE: ReadableState = {
  kind: 'parsed',
  walks: Object.fromEntries(WALK_IDS.map((walkId) => [walkId, emptyMarks()])) as Record<
    WalkId,
    ParsedWalkMarks
  >,
  trades: EMPTY_TRADES,
  untrackedCoins: { balance: [], history: [] },
  oversizedCoins: { balance: [], history: [] },
  balanceSyncedAt: undefined,
  keyExpiry: undefined,
  balanceNotes: {},
  notImported: [],
  logKinds: [],
  denseSpans: {},
  unreadable: [],
};

const readableOf = (text: string | null): ReadableState => {
  const parsed = parseExchangeState(text);

  if (parsed.kind === 'malformed') {
    throw new Error(`walk-state test: a state that should read as malformed: ${text}`);
  }

  return parsed;
};

const stateTextOf = (rest: Metadata): string => JSON.stringify({ version: 1, walks: {}, ...rest });

/** The marks of one walk read from the text of its entry, so a test can put raw JSON in it. */
const marksOfRaw = (entryJson: string, walkId: WalkId = 'pay'): ParsedWalkMarks =>
  readableOf(`{"version":1,"walks":{"${walkId}":${entryJson}}}`).walks[walkId];

const marksOf = (entry: unknown, walkId: WalkId = 'pay'): ParsedWalkMarks =>
  marksOfRaw(JSON.stringify(entry), walkId);

const marksOfStoredField = (walkId: WalkId, field: WalkField, stored: unknown): unknown =>
  marksOf({ [field]: stored }, walkId)[field];

const walkEntryOf = (walkId: WalkId, entry: unknown): ReadableState =>
  readableOf(stateTextOf({ walks: { [walkId]: entry } }));

type Write = () => Promise<undefined>;

/**
 * The walk's own reader of each repairable field, with its own repair write. The series a walk
 * reads is its own setting, so the pending reader is given the one series the test values name.
 */
const REPAIRS = {
  pending: (stored: unknown, write: Write) =>
    readPendingMark({
      stored: stored as ParsedWalkMarks['pending'],
      owedIfUnreadable: { start: 0, end: 1 },
      knownSeries: ['MAIN_FUNDING'],
      write,
    }),
  pointCursor: (stored: unknown, write: Write) =>
    readPointCursor({ stored: stored as ParsedWalkMarks['pointCursor'], write }),
  rangeCursor: (stored: unknown, write: Write) =>
    readRangeCursor({ stored: stored as ParsedWalkMarks['rangeCursor'], write }),
  spanHints: (stored: unknown, write: Write) =>
    readSpanHints({ stored: stored as ParsedWalkMarks['spanHints'], write }),
};

const RANGES = [{ start: 1, end: 2 }];
const TYPED_POINT = [{ start: 1, end: 2, kind: 'point', series: 'MAIN_FUNDING' }];
const HINTS = { forward: [{ start: 1, end: 2 }], pending: [], rescan: [], point: [] };

type StoredReads = [label: string, stored: unknown, reads: unknown];

/**
 * The fields this table covers: the multi-coin marks, the backfill cursor and the three turn marks
 * read by their own rules, which `walk-state.multi-coin.test.ts`,
 * `walk-state.backfill-cursor.test.ts`, `walk-state.backfill-turn.test.ts` and
 * `walk-state.behind-run.test.ts` cover, and the convert marks, which
 * `walk-state.log-marks.test.ts` covers.
 */
type TableField = Exclude<
  WalkField,
  | 'multiCoinSince'
  | 'multiCoinSeen'
  | 'backfillCursor'
  | 'backfillTurn'
  | 'behindRun'
  | 'rescanTurn'
  | 'rescanStuck'
  | 'readFailedAt'
  | 'pageIndex'
  | 'passOwed'
>;

/** What a field reads for a stored value: `undefined` is a value that is stored but unreadable. */
const READS: Record<TableField, StoredReads[]> = {
  cursor: [
    ['nothing stored', undefined, null],
    ['a JSON null', null, null],
    ['zero', 0, 0],
    ['a number', 5_000, 5_000],
    ['a number as text', '5000', null],
    ['a boolean', true, null],
    ['a list', [5_000], null],
    ['an object', {}, null],
    ['a list of ranges', RANGES, null],
    ['span hints', HINTS, null],
  ],
  rescan: [
    ['nothing stored', undefined, null],
    ['a JSON null', null, null],
    ['zero', 0, 0],
    ['a number', 5_000, 5_000],
    ['a number as text', '5000', null],
    ['a boolean', true, null],
    ['a list', [5_000], null],
    ['an object', {}, null],
    ['a list of ranges', RANGES, null],
    ['span hints', HINTS, null],
  ],
  pending: [
    ['nothing stored', undefined, []],
    ['a JSON null', null, undefined],
    ['zero', 0, undefined],
    ['a number', 5_000, undefined],
    ['text', '5000', undefined],
    ['a boolean', true, undefined],
    ['an empty list', [], []],
    ['an object', {}, undefined],
    ['a list of numbers', [5_000], undefined],
    ['a range', RANGES, RANGES],
    ['a typed point', TYPED_POINT, TYPED_POINT],
    ['a range that ends before it starts', [{ start: 2, end: 1 }], undefined],
    ['span hints', HINTS, undefined],
  ],
  pointCursor: [
    ['nothing stored', undefined, null],
    ['a JSON null', null, undefined],
    ['zero', 0, 0],
    ['a number', 5_000, 5_000],
    ['a number as text', '5000', undefined],
    ['a boolean', true, undefined],
    ['a list', [5_000], undefined],
    ['an object', {}, undefined],
    ['a list of ranges', RANGES, undefined],
    ['span hints', HINTS, undefined],
  ],
  rangeCursor: [
    ['nothing stored', undefined, null],
    ['a JSON null', null, undefined],
    ['zero', 0, 0],
    ['a number', 5_000, 5_000],
    ['a number as text', '5000', undefined],
    ['a boolean', true, undefined],
    ['a list', [5_000], undefined],
    ['an object', {}, undefined],
    ['a list of ranges', RANGES, undefined],
    ['span hints', HINTS, undefined],
  ],
  spanHints: [
    ['nothing stored', undefined, NO_HINTS],
    ['a JSON null', null, undefined],
    ['zero', 0, undefined],
    ['a number', 5_000, undefined],
    ['text', '5000', undefined],
    ['a boolean', true, undefined],
    ['a list', [], undefined],
    ['a list of ranges', RANGES, undefined],
    ['an empty object', {}, NO_HINTS],
    ['hints', HINTS, HINTS],
    ['hints whose pass is no list', { forward: { start: 1, end: 2 } }, undefined],
  ],
};

const FIELDS: TableField[] = [
  'cursor',
  'rescan',
  'pending',
  'pointCursor',
  'rangeCursor',
  'spanHints',
];

describe('parseExchangeState', () => {
  describe('the top level', () => {
    it('reads no stored text as a state with nothing in it', () => {
      expect(parseExchangeState(null)).toEqual(EMPTY_STATE);
    });

    it.each([
      ['text that is not JSON', '{not json'],
      ['an empty text', ''],
      ['JSON null', 'null'],
      ['a list', '[]'],
      ['a JSON text', '"x"'],
      ['a number', '5'],
      ['an object with no version', '{"walks":{}}'],
      ['a newer version', '{"version":2,"walks":{}}'],
      ['a version that is text', '{"version":"1","walks":{}}'],
      ['an object with no walks', '{"version":1}'],
      ['walks that are a list', '{"version":1,"walks":[]}'],
      ['walks that are null', '{"version":1,"walks":null}'],
      ['walks that are text', '{"version":1,"walks":"x"}'],
    ])('is malformed for %s', (_label, text) => {
      expect(parseExchangeState(text)).toEqual({ kind: 'malformed' });
    });

    it('reads a state with no walk entry as every walk empty', () => {
      expect(parseExchangeState('{"version":1,"walks":{}}')).toEqual(EMPTY_STATE);
    });

    it('reads nothing of a walk id or a key a newer build wrote', () => {
      expect(
        parseExchangeState(
          stateTextOf({ walks: { bybitSpot: { cursor: 5 } }, laterBuildKey: ['p2p-sale:1:2'] }),
        ),
      ).toEqual(EMPTY_STATE);
    });

    it('reads each walk entry on its own', () => {
      const stored = {
        version: 1,
        walks: {
          capital: { cursor: 1_000 },
          pay: { cursor: 2_000, pointCursor: 7 },
          transfer: { rescan: 3_000 },
          earn: { rangeCursor: 9 },
        },
      } satisfies ExchangeState;
      const { walks } = readableOf(JSON.stringify(stored));

      expect(walks.capital).toEqual({ ...emptyMarks(), cursor: 1_000 });
      expect(walks.pay).toEqual({ ...emptyMarks(), cursor: 2_000, pointCursor: 7 });
      expect(walks.transfer).toEqual({ ...emptyMarks(), rescan: 3_000 });
      expect(walks.earn).toEqual({ ...emptyMarks(), rangeCursor: 9 });
      expect(walks.convert).toEqual(emptyMarks());
    });

    it.each(WALK_IDS)('reads the entry of the %s walk the same way', (walkId) => {
      expect(marksOf({ cursor: 5_000, pending: [{ start: 1, end: 2 }] }, walkId)).toEqual({
        ...emptyMarks(),
        cursor: 5_000,
        pending: [{ start: 1, end: 2 }],
      });
    });
  });

  describe('a walk entry that is not an object', () => {
    it.each([
      ['text', 'x'],
      ['null', null],
      ['a number', 5],
      ['a list', [{ cursor: 5 }]],
    ])('reads as every field empty, for %s, and is named', (_label, entry) => {
      const parsed = readableOf(
        JSON.stringify({ version: 1, walks: { pay: entry, capital: { cursor: 1_000 } } }),
      );

      expect(parsed.walks.pay).toEqual(emptyMarks());
      expect(parsed.walks.capital).toEqual({ ...emptyMarks(), cursor: 1_000 });
      expect(parsed.unreadable).toEqual(['walks.pay']);
    });
  });

  describe('a malformed field', () => {
    const good = {
      cursor: 1_000,
      rescan: 900,
      pending: [{ start: 1, end: 2 }],
      pointCursor: 7,
      rangeCursor: 8,
      spanHints: { forward: [{ start: 100, end: 150 }], pending: [], rescan: [], point: [] },
    };

    it.each([
      ['cursor', 'soon', null],
      ['rescan', 'soon', null],
      ['pending', 'x', undefined],
      ['pointCursor', 'x', undefined],
      ['rangeCursor', 'x', undefined],
      ['spanHints', 'x', undefined],
    ])('never empties its siblings: the %s', (field, bad, reads) => {
      expect(marksOf({ ...good, [field]: bad })).toStrictEqual({ ...good, [field]: reads });
    });

    it.each([
      ['a text', 'x'],
      ['a boolean', true],
      ['an object', { start: 1, end: 2 }],
    ])(
      'of the Pay pending value being %s leaves Pay and every other walk as stored',
      (_label, bad) => {
        const parsed = readableOf(
          JSON.stringify({
            version: 1,
            walks: { capital: good, pay: { ...good, pending: bad }, transfer: good, earn: good },
          }),
        );

        expect(parsed.walks.pay).toStrictEqual({ ...good, pending: undefined });
        expect(parsed.walks.capital).toStrictEqual(good);
        expect(parsed.walks.transfer).toStrictEqual(good);
        expect(parsed.walks.earn).toStrictEqual(good);
        expect(parsed.unreadable).toEqual([]);
      },
    );
  });

  describe('a field stored as JSON null', () => {
    it.each([
      ['cursor', null],
      ['rescan', null],
      ['pending', undefined],
      ['pointCursor', undefined],
      ['rangeCursor', undefined],
      ['spanHints', undefined],
    ] as const)(
      'reads a stored null as no value for a cursor, malformed for the rest: the %s',
      (field, reads) => {
        for (const walkName of WALK_NAMES) {
          expect(marksOfStoredField(walkName, field, null)).toStrictEqual(reads);
        }
      },
    );
  });

  describe('a stored value', () => {
    it.each(FIELDS)('reads as the field reads it, for every walk: the %s', (field) => {
      for (const walkName of WALK_NAMES) {
        for (const [label, stored, reads] of READS[field]) {
          expect([walkName, label, marksOfStoredField(walkName, field, stored)]).toStrictEqual([
            walkName,
            label,
            reads,
          ]);
        }
      }
    });

    it.each(['pending', 'pointCursor', 'rangeCursor', 'spanHints'] as const)(
      'is malformed exactly when the walk repairs it: the %s',
      async (field) => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        for (const walkName of WALK_NAMES) {
          for (const [label, stored] of READS[field]) {
            const write = jest.fn(async () => undefined);
            const parsed = marksOfStoredField(walkName, field, stored);

            await REPAIRS[field](parsed, write);

            expect([walkName, label, write.mock.calls.length > 0]).toEqual([
              walkName,
              label,
              parsed === undefined,
            ]);
          }
        }

        warn.mockRestore();
      },
    );
  });

  describe('the cursors', () => {
    it('are read from the entry of their own walk', () => {
      const { walks } = readableOf(
        JSON.stringify({
          version: 1,
          walks: {
            capital: { cursor: 1_000, rescan: 1_500 },
            pay: { cursor: 2_000, rescan: 2_500 },
            transfer: { cursor: 3_000, rescan: 3_500 },
            earn: { cursor: 4_000, rescan: 4_500 },
          },
        }),
      );
      const own = [walks.capital, walks.pay, walks.transfer, walks.earn];

      expect(own.map((marks) => marks.cursor)).toEqual([1_000, 2_000, 3_000, 4_000]);
      expect(own.map((marks) => marks.rescan)).toEqual([1_500, 2_500, 3_500, 4_500]);
    });

    it.each([
      ['text', '"soon"'],
      ['not a finite number', '1e999'],
    ])('read null when the value is %s', (_label, raw) => {
      expect(marksOfRaw(`{"cursor":${raw},"rescan":${raw}}`)).toEqual(emptyMarks());
    });
  });

  describe('the pending overlap lists', () => {
    const range = { start: 1_000, end: 2_000 };
    const pendingOf = (stored: unknown, walkId: WalkId = 'pay') =>
      marksOf({ pending: stored }, walkId).pending;

    it('reads each stored list on its own', () => {
      for (const walkId of ['capital', 'pay', 'transfer', 'earn'] as const) {
        expect(pendingOf([range, { start: 5, end: 9 }], walkId)).toEqual([
          range,
          { start: 5, end: 9 },
        ]);
        expect(pendingOf([], walkId)).toEqual([]);
      }

      expect(walkEntryOf('capital', { pending: [range] }).walks.pay.pending).toEqual([]);
    });

    it('reads an entry with no kind as a range, and one tagged "point" as a point', () => {
      const point = { start: 999, end: 1_001, kind: 'point' };

      expect(pendingOf([range, point])).toEqual([range, point]);
    });

    it('round-trips the series of a point, the one series its record was read in', () => {
      const typed = { start: 999, end: 1_001, kind: 'point', series: 'MAIN_FUNDING' };

      expect(pendingOf([range, typed], 'transfer')).toEqual([range, typed]);
    });

    it('parses a list with a series the walk does not read as stored', () => {
      const other = { start: 999, end: 1_001, kind: 'point', series: 'NOT_READ_BY_THE_WALK' };

      expect(pendingOf([range, other], 'transfer')).toEqual([range, other]);
    });

    it('reads a point with no series as a point with none', () => {
      const point = { start: 999, end: 1_001, kind: 'point' };

      expect(pendingOf([point], 'transfer')).toEqual([point]);
    });

    it('round-trips the series of a range, the one series it is owed in', () => {
      const owedInOne = { start: 1_000, end: 2_000, series: 'MAIN_FUNDING' };

      expect(pendingOf([range, owedInOne], 'transfer')).toEqual([range, owedInOne]);
    });

    it.each([
      ['a range with an empty series', { start: 1_000, end: 2_000, series: '' }],
      ['a range with a blank series', { start: 1_000, end: 2_000, series: '  ' }],
      ['a range whose series is not text', { start: 1_000, end: 2_000, series: 7 }],
      ['a range whose series is null', { start: 1_000, end: 2_000, series: null }],
      ['a point with an empty series', { start: 999, end: 1_001, kind: 'point', series: '' }],
      ['a point with a blank series', { start: 999, end: 1_001, kind: 'point', series: '  ' }],
      ['a point whose series is not text', { start: 999, end: 1_001, kind: 'point', series: 7 }],
      ['a point whose series is null', { start: 999, end: 1_001, kind: 'point', series: null }],
    ])('is malformed for a stored value with %s', (_label, entry) => {
      expect(pendingOf([entry], 'transfer')).toBeUndefined();
    });

    it('reads a short entry with no kind as a range: only the tag makes a point', () => {
      const sliver = { start: 1_000, end: 1_002 };

      expect(pendingOf([sliver])).toEqual([sliver]);
    });

    describe('the time a point was first owed (`since`)', () => {
      const point = { start: 999, end: 1_001, kind: 'point' };

      it.each([0, 1_700_000_000_000])('keeps a stored `since` of %s on a point', (since) => {
        expect(pendingOf([range, { ...point, since }])).toEqual([range, { ...point, since }]);
      });

      it('round-trips `since` beside the series of a point', () => {
        const typed = { ...point, series: 'MAIN_FUNDING', since: 1_700_000_000_000 };

        expect(pendingOf([typed], 'transfer')).toEqual([typed]);
      });

      it('reads a point an older build stored, with no `since`, as a point with none', () => {
        expect(pendingOf([point])).toEqual([point]);
        expect(pendingOf([point])?.[0]).not.toHaveProperty('since');
      });

      it.each([
        ['text', '1700000000000'],
        ['a negative number', -1],
        ['a fraction', 1.5],
        ['null', null],
        ['a list', [1]],
        ['true', true],
      ])(
        'reads a `since` that is %s as none, and keeps the point and the list',
        (_label, since) => {
          const read = pendingOf([range, { ...point, since }]);

          expect(read).toEqual([range, point]);
          expect(read?.[1]).not.toHaveProperty('since');
        },
      );

      it('reads a `since` that is not a finite number as none', () => {
        const read = marksOfRaw(
          '{"pending":[{"start":999,"end":1001,"kind":"point","since":1e999}]}',
        ).pending;

        expect(read).toEqual([point]);
      });

      it('never keeps a `since` on a range: only a point carries one', () => {
        const read = pendingOf([{ ...range, since: 1_700_000_000_000 }]);

        expect(read).toEqual([range]);
        expect(read?.[0]).not.toHaveProperty('since');
      });
    });

    it('is an empty list when the field is absent or the entry is not an object', () => {
      expect(marksOf({}).pending).toEqual([]);
      expect(walkEntryOf('pay', 'x').walks.pay.pending).toEqual([]);
      expect(walkEntryOf('pay', null).walks.pay.pending).toEqual([]);
    });

    it.each([
      ['not a list', { start: 1, end: 2 }],
      ['a list of numbers', [1_000, 2_000]],
      ['an entry with a missing end', [{ start: 1_000 }]],
      ['a text bound', [{ start: '1000', end: 2_000 }]],
      ['an empty range', [{ start: 2_000, end: 2_000 }]],
      ['a backwards range', [{ start: 3_000, end: 2_000 }]],
      ['one good and one bad entry', [range, { start: 'x', end: 1 }]],
      ['an entry of an unknown kind', [{ start: 1_000, end: 2_000, kind: 'range' }]],
      ['an entry whose kind is not text', [{ start: 1_000, end: 2_000, kind: 1 }]],
      ['a point that is empty', [{ start: 2_000, end: 2_000, kind: 'point' }]],
    ])('is malformed for a stored value that is %s', (_label, value) => {
      expect(pendingOf(value)).toBeUndefined();
    });

    it('is malformed for a bound that is not a finite number', () => {
      expect(marksOfRaw('{"pending":[{"start":1e999,"end":2000}]}').pending).toBeUndefined();
    });
  });

  describe.each([
    ['point', 'pointCursor'],
    ['range', 'rangeCursor'],
  ] as const)('the %s cursors', (_kind, field) => {
    it('reads each stored cursor on its own', () => {
      for (const walkId of ['capital', 'pay', 'transfer', 'earn'] as const) {
        expect(marksOf({ [field]: 5_000 }, walkId)[field]).toBe(5_000);
      }

      expect(walkEntryOf('capital', { [field]: 5_000 }).walks.pay[field]).toBeNull();
    });

    it('is null when the field is absent or the entry is not an object', () => {
      expect(marksOf({})[field]).toBeNull();
      expect(walkEntryOf('pay', 'x').walks.pay[field]).toBeNull();
      expect(walkEntryOf('pay', null).walks.pay[field]).toBeNull();
    });

    it.each([
      ['text', '"5000"'],
      ['not a finite number', '1e999'],
      ['null', 'null'],
      ['a list', '[5000]'],
    ])('is malformed for a stored value that is %s', (_label, raw) => {
      expect(marksOfRaw(`{"${field}":${raw}}`)[field]).toBeUndefined();
    });
  });

  describe('the span hints', () => {
    const hints = {
      forward: [{ start: 100, end: 150 }],
      pending: [
        { start: 200, end: 220 },
        { start: 300, end: 301 },
      ],
      rescan: [],
      point: [{ start: 400, end: 402 }],
    };
    const hintsOf = (stored: unknown, walkId: WalkId = 'pay') =>
      marksOf({ spanHints: stored }, walkId).spanHints;

    it('reads each stored value on its own', () => {
      for (const walkId of ['capital', 'pay', 'transfer', 'earn'] as const) {
        expect(hintsOf(hints, walkId)).toEqual(hints);
      }

      expect(walkEntryOf('capital', { spanHints: hints }).walks.pay.spanHints).toEqual(NO_HINTS);
    });

    it('is no hint at all when the field is absent or the entry is not an object', () => {
      expect(marksOf({}).spanHints).toEqual(NO_HINTS);
      expect(walkEntryOf('pay', 'x').walks.pay.spanHints).toEqual(NO_HINTS);
      expect(walkEntryOf('pay', null).walks.pay.spanHints).toEqual(NO_HINTS);
    });

    it('reads a pass left out as no hint for it', () => {
      expect(hintsOf({ rescan: [{ start: 1, end: 2 }] })).toEqual({
        ...NO_HINTS,
        rescan: [{ start: 1, end: 2 }],
      });
    });

    it.each([
      ['text', 'x'],
      ['null', null],
      ['a list', [{ start: 1, end: 2 }]],
      ['a pass that is no list', { ...hints, forward: { start: 1, end: 2 } }],
      ['an entry that is no object', { ...hints, point: [5] }],
      ['an entry with a text start', { ...hints, point: [{ start: '1', end: 2 }] }],
      ['an entry with no end', { ...hints, point: [{ start: 1 }] }],
      ['an entry that ends where it starts', { ...hints, forward: [{ start: 2, end: 2 }] }],
      ['an entry that ends before it starts', { ...hints, forward: [{ start: 3, end: 2 }] }],
    ])('is malformed for a stored value that is %s', (_label, value) => {
      expect(hintsOf(value)).toBeUndefined();
    });

    it('is malformed for a start that is not a finite number', () => {
      const text =
        '{"spanHints":{"forward":[{"start":1e999,"end":2}],"pending":[],"rescan":[],"point":[]}}';

      expect(marksOfRaw(text).spanHints).toBeUndefined();
    });

    describe('the resume of a point window', () => {
      const resume = {
        from: 401,
        returned: [{ start: 400, end: 402, kind: 'point', series: 'MAIN_FUNDING' }],
        stuck: [
          { start: 400, end: 402, kind: 'point' },
          { start: 390, end: 410 },
        ],
        series: ['MAIN_FUNDING', 'FUNDING_MAIN'],
      };
      const resumed = { ...hints, point: [{ start: 400, end: 450, resume }] };

      it('is read with the points a record returned and the ground a record left owed', () => {
        expect(hintsOf(resumed)).toEqual(resumed);
      });

      it('is read for a resume that starts exactly where its window starts', () => {
        const start = 400;
        const stored = {
          ...hints,
          point: [{ start, end: 450, resume: { ...resume, from: start } }],
        };

        expect(stored.point[0].resume.from).toBe(stored.point[0].start);
        expect(hintsOf(stored)).toEqual(stored);
      });

      it('is read with no series for a walk that reads one series', () => {
        const { series: _series, ...single } = resume;
        const stored = { ...hints, point: [{ start: 400, end: 450, resume: single }] };

        expect(hintsOf(stored)).toEqual(stored);
      });

      it('is dropped from a hint of any other pass, which keeps its span', () => {
        expect(
          hintsOf({
            forward: [{ start: 1, end: 5, resume }],
            pending: [{ start: 2, end: 6, resume }],
            rescan: [{ start: 3, end: 7, resume }],
            point: [],
          }),
        ).toEqual({
          forward: [{ start: 1, end: 5 }],
          pending: [{ start: 2, end: 6 }],
          rescan: [{ start: 3, end: 7 }],
          point: [],
        });
      });

      it.each([
        ['a resume that is no object', 'x'],
        ['a resume that starts at a text', { ...resume, from: '401' }],
        ['a resume that starts before its window', { ...resume, from: 399 }],
        ['a resume that starts where its span ends', { ...resume, from: 450 }],
        ['a resume that starts after its span ends', { ...resume, from: 451 }],
        ['a resume with no list of returned points', { ...resume, returned: undefined }],
        ['a resume whose returned points are no list', { ...resume, returned: 'x' }],
        [
          'a resume with a returned point that is no range',
          { ...resume, returned: [{ start: 1 }] },
        ],
        ['a resume with no list of stuck ground', { ...resume, stuck: undefined }],
        [
          'a resume with a stuck entry of kind other than a point',
          { ...resume, stuck: [{ start: 1, end: 2, kind: 'range' }] },
        ],
        ['a resume whose series are no list', { ...resume, series: 'MAIN_FUNDING' }],
        ['a resume with an empty list of series', { ...resume, series: [] }],
        ['a resume with a series that is blank', { ...resume, series: [' '] }],
        [
          'a resume with one series that is blank beside a good one',
          { ...resume, series: ['MAIN_FUNDING', ' '] },
        ],
        [
          'a resume with one series that is no text beside a good one',
          { ...resume, series: ['MAIN_FUNDING', 7] },
        ],
      ])('makes the stored value malformed for %s', (_label, bad) => {
        const stored = { ...hints, point: [{ start: 400, end: 450, resume: bad }] };

        expect(hintsOf(stored)).toBeUndefined();
      });
    });
  });

  describe('the six fields of the Earn walk', () => {
    const point = { start: 5, end: 7, kind: 'point', series: 'flexibleRewards' };
    const hints = { forward: [], pending: [{ start: 200, end: 220 }], rescan: [], point: [] };

    it('are read as the other walks read theirs: a list with a point of a kind, a cursor, a number, the hints', () => {
      const stored = {
        cursor: 4_000,
        rescan: 3_000,
        pending: [point],
        pointCursor: 6,
        rangeCursor: 9,
        spanHints: hints,
      };

      expect(marksOf(stored, 'earn')).toEqual(stored);
    });
  });

  describe('the trades', () => {
    const trades = {
      symbols: { BTCUSDT: { fromId: 5, heldOrderId: 9 }, ETHUSDT: { fromId: null } },
      rotation: 'BTCUSDT',
      balanceSnapshot: { BTC: '0.5', USDT: '120.25' },
    };

    it('are read as stored', () => {
      expect(readableOf(stateTextOf({ trades })).trades).toEqual(trades);
    });

    it('are empty when absent, and nothing is named', () => {
      const parsed = readableOf(stateTextOf({}));

      expect(parsed.trades).toEqual(EMPTY_TRADES);
      expect(parsed.unreadable).toEqual([]);
    });

    it.each([
      ['text', 'x'],
      ['null', null],
      ['a list', []],
    ])(
      'read as empty and are named when they are %s, and nothing else is emptied',
      (_label, bad) => {
        const parsed = readableOf(
          stateTextOf({
            trades: bad,
            walks: { capital: { cursor: 1_000 } },
            untrackedCoins: { balance: ['PEPE'] },
          }),
        );

        expect(parsed.trades).toEqual(EMPTY_TRADES);
        expect(parsed.unreadable).toEqual(['trades']);
        expect(parsed.walks.capital.cursor).toBe(1_000);
        expect(parsed.untrackedCoins.balance).toEqual(['PEPE']);
      },
    );

    it.each([
      ['no object', 5],
      ['an object with a text fromId', { fromId: '5' }],
      ['an object with no fromId', {}],
      ['an object with a heldOrderId that is text', { fromId: 5, heldOrderId: '9' }],
    ])('drop a symbol that is %s alone, and name it', (_label, bad) => {
      const parsed = readableOf(
        stateTextOf({ trades: { ...trades, symbols: { ...trades.symbols, OLDUSDT: bad } } }),
      );

      expect(parsed.trades).toEqual(trades);
      expect(parsed.unreadable).toEqual(['trades.symbols.OLDUSDT']);
    });

    it('read the symbols that are good when one is bad, in the order stored', () => {
      const parsed = readableOf(
        stateTextOf({
          trades: {
            ...trades,
            symbols: { A: { fromId: 1 }, BAD: { fromId: '5' }, B: { fromId: 2 } },
          },
        }),
      );

      expect(parsed.trades.symbols).toEqual({ A: { fromId: 1 }, B: { fromId: 2 } });
      expect(Object.keys(parsed.trades.symbols)).toEqual(['A', 'B']);
      expect(parsed.trades.rotation).toBe('BTCUSDT');
      expect(parsed.trades.balanceSnapshot).toEqual(trades.balanceSnapshot);
      expect(parsed.unreadable).toEqual(['trades.symbols.BAD']);
    });

    it('read a symbol with a cleared heldOrderId as a symbol without one', () => {
      const parsed = readableOf(
        stateTextOf({
          trades: { ...trades, symbols: { BTCUSDT: { fromId: 5, heldOrderId: null } } },
        }),
      );

      expect(parsed.trades.symbols).toStrictEqual({ BTCUSDT: { fromId: 5 } });
      expect(parsed.unreadable).toEqual([]);
    });

    it('read no symbols and name them when the symbols are no object', () => {
      for (const bad of [[], 'x', null]) {
        const parsed = readableOf(stateTextOf({ trades: { ...trades, symbols: bad } }));

        expect(parsed.trades).toEqual({ ...trades, symbols: {} });
        expect(parsed.unreadable).toEqual(['trades.symbols']);
      }
    });

    it.each([
      ['a number', 3],
      ['null', null],
      ['an object', {}],
    ])(
      'read the rotation as the start and name it when it is %s, and keep the rest',
      (_label, bad) => {
        const parsed = readableOf(stateTextOf({ trades: { ...trades, rotation: bad } }));

        expect(parsed.trades).toEqual({ ...trades, rotation: '' });
        expect(parsed.unreadable).toEqual(['trades.rotation']);
      },
    );

    it('keeps a rotation that names a symbol no longer listed', () => {
      const parsed = readableOf(stateTextOf({ trades: { ...trades, rotation: 'GONEUSDT' } }));

      expect(parsed.trades).toEqual({ ...trades, rotation: 'GONEUSDT' });
      expect(parsed.unreadable).toEqual([]);
    });

    it('read a rotation or symbols left out as the start and empty, and name nothing', () => {
      const parsed = readableOf(stateTextOf({ trades: { balanceSnapshot: { BTC: '1' } } }));

      expect(parsed.trades).toEqual({ symbols: {}, rotation: '', balanceSnapshot: { BTC: '1' } });
      expect(parsed.unreadable).toEqual([]);
    });

    it('read a balance snapshot that is no object as empty, and name it', () => {
      for (const bad of [['0.5'], 'x', null]) {
        const parsed = readableOf(stateTextOf({ trades: { ...trades, balanceSnapshot: bad } }));

        expect(parsed.trades).toEqual({ ...trades, balanceSnapshot: {} });
        expect(parsed.unreadable).toEqual(['trades.balanceSnapshot']);
      }
    });

    it('drop the balance of a coin that is no text alone, and name it', () => {
      const parsed = readableOf(
        stateTextOf({ trades: { ...trades, balanceSnapshot: { BTC: 0.5, USDT: '120.25' } } }),
      );

      expect(parsed.trades).toEqual({ ...trades, balanceSnapshot: { USDT: '120.25' } });
      expect(parsed.unreadable).toEqual(['trades.balanceSnapshot.BTC']);
    });

    it('name each part it could not read, in a fixed order', () => {
      const parsed = readableOf(
        stateTextOf({
          trades: {
            symbols: { B: 1, A: { fromId: 1 }, C: null },
            rotation: 5,
            balanceSnapshot: { USDT: 1, BTC: '1' },
          },
        }),
      );

      expect(parsed.unreadable).toEqual([
        'trades.symbols.B',
        'trades.symbols.C',
        'trades.rotation',
        'trades.balanceSnapshot.USDT',
      ]);
    });
  });

  describe('the coin lists', () => {
    const stored = {
      untrackedCoins: { balance: ['PEPE'], history: ['XYZ'] },
      oversizedCoins: { balance: ['SHIB'], history: ['DOGE', 'FLOKI'] },
    };
    const KINDS = ['untrackedCoins', 'oversizedCoins'] as const;
    const SOURCES = ['balance', 'history'] as const;

    it('are read as stored', () => {
      const parsed = readableOf(stateTextOf(stored));

      expect(parsed.untrackedCoins).toEqual(stored.untrackedCoins);
      expect(parsed.oversizedCoins).toEqual(stored.oversizedCoins);
      expect(parsed.unreadable).toEqual([]);
    });

    it('are empty when absent, and nothing is named', () => {
      const parsed = readableOf(stateTextOf({}));

      expect(parsed.untrackedCoins).toEqual({ balance: [], history: [] });
      expect(parsed.oversizedCoins).toEqual({ balance: [], history: [] });
      expect(parsed.unreadable).toEqual([]);
    });

    it('read a list left out of a kind as empty, and name nothing', () => {
      const parsed = readableOf(stateTextOf({ untrackedCoins: { history: ['XYZ'] } }));

      expect(parsed.untrackedCoins).toEqual({ balance: [], history: ['XYZ'] });
      expect(parsed.unreadable).toEqual([]);
    });

    describe.each(KINDS.flatMap((kind) => SOURCES.map((source) => [kind, source] as const)))(
      'the %s %s list',
      (kind, source) => {
        it.each([
          ['text', 'x'],
          ['null', null],
          ['an object', { 0: 'PEPE' }],
          ['a list holding a number', ['PEPE', 5]],
          ['a list holding null', [null]],
        ])(
          'parses alone: empty and named when it is %s, the others keep their values',
          (_label, bad) => {
            const other = kind === 'untrackedCoins' ? 'oversizedCoins' : 'untrackedCoins';
            const parsed = readableOf(
              stateTextOf({ ...stored, [kind]: { ...stored[kind], [source]: bad } }),
            );

            expect(parsed[kind]).toEqual({ ...stored[kind], [source]: [] });
            expect(parsed[other]).toEqual(stored[other]);
            expect(parsed.unreadable).toEqual([`${kind}.${source}`]);
          },
        );
      },
    );

    describe('the oversized balanceByWallet', () => {
      const withByWallet = (balanceByWallet: unknown) =>
        readableOf(
          stateTextOf({
            oversizedCoins: { balance: ['ETH', 'SOL'], history: ['BTC'], balanceByWallet },
          }),
        );

      it('reads as stored, and names nothing', () => {
        const parsed = withByWallet({ spot: ['ETH'], funding: ['SOL'] });

        expect(parsed.oversizedCoins).toEqual({ balance: ['ETH', 'SOL'], history: ['BTC'] });
        expect(parsed.unreadable).toEqual([]);
      });

      it.each([
        ['text', 'x'],
        ['null', null],
        ['a list', ['ETH']],
      ])('keeps balance as stored and is named when it is %s', (_label, bad) => {
        const parsed = withByWallet(bad);

        expect(parsed.oversizedCoins).toEqual({ balance: ['ETH', 'SOL'], history: ['BTC'] });
        expect(parsed.unreadable).toEqual(['oversizedCoins.balanceByWallet']);
      });

      it('names a wallet array it cannot read, and the others stay readable', () => {
        const parsed = withByWallet({ spot: 5, funding: ['SOL', 7], earn: ['ETH'] });

        expect(parsed.oversizedCoins).toEqual({ balance: ['ETH', 'SOL'], history: ['BTC'] });
        expect(parsed.unreadable).toEqual([
          'oversizedCoins.balanceByWallet.spot',
          'oversizedCoins.balanceByWallet.funding',
        ]);
      });
    });

    it.each(KINDS)('read as empty and are named when the %s are no object', (kind) => {
      for (const bad of ['x', null, ['PEPE']]) {
        const parsed = readableOf(stateTextOf({ ...stored, [kind]: bad }));

        expect(parsed[kind]).toEqual({ balance: [], history: [] });
        expect(parsed.unreadable).toEqual([kind]);
      }
    });
  });

  describe('the balance sync stamp', () => {
    it('is read as stored, and names nothing', () => {
      const parsed = readableOf(stateTextOf({ balanceSyncedAt: 1_700_000_000_000 }));

      expect(parsed.balanceSyncedAt).toBe(1_700_000_000_000);
      expect(parsed.unreadable).toEqual([]);
    });

    it('is absent when not stored, and names nothing', () => {
      const parsed = readableOf(stateTextOf({}));

      expect(parsed.balanceSyncedAt).toBeUndefined();
      expect(parsed.unreadable).toEqual([]);
    });

    it.each([
      ['text', '"x"'],
      ['numeric text', '"5"'],
      ['null', 'null'],
      ['a list', '[5]'],
      ['an object', '{"at":5}'],
      ['a number past the double range, which JSON reads as infinity', '1e999'],
    ])('reads as absent and is named when it is %s, the rest stays readable', (_label, bad) => {
      const parsed = readableOf(
        `{"version":1,"walks":{"pay":{"cursor":7}},"balanceSyncedAt":${bad}}`,
      );

      expect(parsed.balanceSyncedAt).toBeUndefined();
      expect(parsed.walks.pay.cursor).toBe(7);
      expect(parsed.unreadable).toEqual(['balanceSyncedAt']);
    });
  });

  it('names every entry it could not read, in a fixed order', () => {
    const parsed = readableOf(
      stateTextOf({
        walks: { earn: 'x', capital: 5 },
        trades: 'x',
        oversizedCoins: { history: 'x' },
        untrackedCoins: { balance: 'x', history: 'x' },
        balanceSyncedAt: 'x',
      }),
    );

    expect(parsed.unreadable).toEqual([
      'walks.capital',
      'walks.earn',
      'trades',
      'untrackedCoins.balance',
      'untrackedCoins.history',
      'oversizedCoins.history',
      'balanceSyncedAt',
    ]);
  });
});
