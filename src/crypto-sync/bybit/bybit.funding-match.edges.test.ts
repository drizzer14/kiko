import { DAY_MS } from '@kiko/dates';

import {
  FUNDING_MATCH_HOLD_MS,
  FUNDING_MATCH_WINDOW_MS,
  type FundingWalkMarks,
} from './bybit.funding-match';
import {
  NOW,
  atDay,
  ledgerRowOf,
  settledMarks,
  sourceRowOf,
  verdictsOf,
} from './bybit.funding-test-fixtures';

const MOMENT = atDay(10);

const WINDOW = FUNDING_MATCH_WINDOW_MS;

const walkOwing = (...pending: FundingWalkMarks['pending'][number][]): FundingWalkMarks => ({
  cursor: NOW,
  pending,
});

describe('the forms of a source amount', () => {
  it.each([
    ['the amount less the deposit fee', '95'],
    ['the amount plus the deposit fee', '105'],
    ['the amount itself', '100'],
  ])('explains an In row of %s', (_title, amount) => {
    const rows = [
      sourceRowOf('source', 'deposit', MOMENT, { amount: '100', fee: '5' }),
      ledgerRowOf('ledger', MOMENT, { amount }),
    ];

    expect(verdictsOf(rows)).toEqual({ ledger: 'explained' });
  });

  it('explains an Out row of the withdrawal amount plus its fee and its tax', () => {
    const rows = [
      sourceRowOf('source', 'withdraw', MOMENT, { amount: '100', fee: '5', tax: '2' }),
      ledgerRowOf('ledger', MOMENT, { direction: 'O', amount: '107' }),
    ];

    expect(verdictsOf(rows)).toEqual({ ledger: 'explained' });
  });

  it('never subtracts a withdrawal fee, which only a deposit can hold', () => {
    const rows = [
      sourceRowOf('source', 'withdraw', MOMENT, { amount: '100', fee: '5' }),
      ledgerRowOf('ledger', MOMENT, { direction: 'O', amount: '95' }),
    ];

    expect(verdictsOf(rows)).toEqual({ ledger: 'held' });
  });

  it('makes no fee form from an empty or unreadable fee and keeps the plain form', () => {
    const rows = [
      sourceRowOf('source-empty', 'deposit', MOMENT, { amount: '100', fee: '' }),
      sourceRowOf('source-junk', 'deposit', atDay(40), { amount: '200', fee: 'n/a' }),
      ledgerRowOf('ledger-empty', MOMENT, { amount: '105' }),
      ledgerRowOf('ledger-plain', atDay(40), { amount: '200' }),
    ];

    expect(verdictsOf(rows)).toEqual({ 'ledger-empty': 'held', 'ledger-plain': 'explained' });
  });

  it('makes no tax form from an unreadable tax and keeps the fee form', () => {
    const rows = [
      sourceRowOf('source', 'withdraw', MOMENT, { amount: '100', fee: '5', tax: '' }),
      ledgerRowOf('ledger-fee', MOMENT, { direction: 'O', amount: '105' }),
      ledgerRowOf('ledger-tax', MOMENT, { direction: 'O', amount: '107' }),
    ];

    expect(verdictsOf(rows)).toEqual({ 'ledger-fee': 'explained', 'ledger-tax': 'listed' });
  });

  it('makes no form of an amount that is not above zero', () => {
    const rows = [
      sourceRowOf('source', 'deposit', MOMENT, { amount: '5', fee: '5' }),
      ledgerRowOf('ledger', MOMENT, { amount: '0' }),
    ];

    expect(verdictsOf(rows)).toEqual({ ledger: 'held' });
  });

  it('tries the plain form before the fee form, and the fee form before distance', () => {
    const rows = [
      sourceRowOf('source-fee', 'deposit', atDay(10), { amount: '105', fee: '5' }),
      sourceRowOf('source-plain', 'deposit', atDay(16), { amount: '100' }),
      ledgerRowOf('ledger', atDay(10), { amount: '100' }),
      ledgerRowOf('ledger-near-fee-source', atDay(3), { amount: '7' }),
    ];

    expect(verdictsOf(rows)).toEqual({ ledger: 'explained', 'ledger-near-fee-source': 'held' });
  });
});

describe('equal amounts', () => {
  it.each([
    ['trailing zeros', '100.00', '100'],
    ['leading zeros', '0100', '100'],
    ['a comma mark', '0,5', '0.50'],
  ])('reads %s as the same amount', (_title, sourceAmount, ledgerAmount) => {
    const rows = [
      sourceRowOf('source', 'deposit', MOMENT, { amount: sourceAmount }),
      ledgerRowOf('ledger', MOMENT, { amount: ledgerAmount }),
    ];

    expect(verdictsOf(rows)).toEqual({ ledger: 'explained' });
  });

  it('tells apart two amounts a float cannot', () => {
    const rows = [
      sourceRowOf('source', 'deposit', MOMENT, { amount: '9007199254740993' }),
      ledgerRowOf('ledger', MOMENT, { amount: '9007199254740992' }),
    ];

    expect(verdictsOf(rows)).toEqual({ ledger: 'held' });
  });

  it('never explains a row or a source with an unreadable amount, and a free source still holds', () => {
    const rows = [
      sourceRowOf('source-readable', 'deposit', MOMENT),
      sourceRowOf('source-junk', 'deposit', atDay(50), { amount: 'abc' }),
      ledgerRowOf('ledger-junk', MOMENT, { amount: 'abc' }),
      ledgerRowOf('ledger-near-junk', atDay(50), { amount: 'abc' }),
    ];

    expect(verdictsOf(rows)).toEqual({ 'ledger-junk': 'held', 'ledger-near-junk': 'held' });
  });

  it('pairs only a source of the same coin and the same direction', () => {
    const rows = [
      sourceRowOf('source', 'deposit', MOMENT),
      ledgerRowOf('ledger-coin', MOMENT, { coin: 'BTC' }),
      ledgerRowOf('ledger-direction', MOMENT, { direction: 'O' }),
    ];

    expect(verdictsOf(rows)).toEqual({ 'ledger-coin': 'listed', 'ledger-direction': 'listed' });
  });

  it('holds only for a free source of the same coin and the same direction', () => {
    const rows = [
      sourceRowOf('source', 'deposit', MOMENT),
      ledgerRowOf('ledger-coin', MOMENT, { coin: 'BTC', amount: '99' }),
      ledgerRowOf('ledger-direction', MOMENT, { direction: 'O', amount: '99' }),
      ledgerRowOf('ledger-held', MOMENT, { amount: '99' }),
    ];

    expect(verdictsOf(rows)).toEqual({
      'ledger-coin': 'listed',
      'ledger-direction': 'listed',
      'ledger-held': 'held',
    });
  });

  it('holds no row for a source another row already took', () => {
    const rows = [
      sourceRowOf('source', 'deposit', MOMENT),
      ledgerRowOf('ledger-own', MOMENT),
      ledgerRowOf('ledger-near', MOMENT, { amount: '99' }),
    ];

    expect(verdictsOf(rows)).toEqual({ 'ledger-own': 'explained', 'ledger-near': 'listed' });
  });
});

describe('the window W', () => {
  it('pairs a row exactly W after its source and lists one a millisecond further', () => {
    const rows = (gap: number) => [
      sourceRowOf('source', 'deposit', MOMENT),
      ledgerRowOf('ledger', MOMENT + gap),
    ];

    expect(verdictsOf(rows(WINDOW))).toEqual({ ledger: 'explained' });
    expect(verdictsOf(rows(WINDOW + 1))).toEqual({ ledger: 'listed' });
  });

  it('pairs a row exactly W before its source and lists one a millisecond further', () => {
    const rows = (gap: number) => [
      sourceRowOf('source', 'deposit', MOMENT),
      ledgerRowOf('ledger', MOMENT - gap),
    ];

    expect(verdictsOf(rows(WINDOW))).toEqual({ ledger: 'explained' });
    expect(verdictsOf(rows(WINDOW + 1))).toEqual({ ledger: 'listed' });
  });

  it.each([
    ['after', 1],
    ['before', -1],
  ])(
    'holds a row exactly W %s a free source and lists one a millisecond further',
    (_title, sign) => {
      const rows = (gap: number) => [
        sourceRowOf('source', 'deposit', MOMENT),
        ledgerRowOf('ledger', MOMENT + sign * gap, { amount: '99' }),
      ];

      expect(verdictsOf(rows(WINDOW))).toEqual({ ledger: 'held' });
      expect(verdictsOf(rows(WINDOW + 1))).toEqual({ ledger: 'listed' });
    },
  );

  it('holds a row exactly W past the end of a free extent and not a millisecond further', () => {
    const rows = (gap: number) => [
      sourceRowOf('source', 'withdraw', MOMENT, { until: MOMENT + 10 * DAY_MS }),
      ledgerRowOf('ledger', MOMENT + 10 * DAY_MS + gap, { direction: 'O', amount: '99' }),
    ];

    expect(verdictsOf(rows(WINDOW))).toEqual({ ledger: 'held' });
    expect(verdictsOf(rows(WINDOW + 1))).toEqual({ ledger: 'listed' });
  });

  it('measures a distance of zero anywhere inside the extent of a withdrawal', () => {
    const rows = (time: number) => [
      sourceRowOf('source', 'withdraw', MOMENT, { until: MOMENT + 10 * DAY_MS }),
      ledgerRowOf('ledger', time, { direction: 'O' }),
    ];
    const inside = verdictsOf(rows(MOMENT + 5 * DAY_MS), { windowMs: 0 });
    const atEnd = verdictsOf(rows(MOMENT + 10 * DAY_MS), { windowMs: 0 });
    const pastEnd = verdictsOf(rows(MOMENT + 10 * DAY_MS + 1), { windowMs: 0 });

    expect([inside, atEnd, pastEnd]).toEqual([
      { ledger: 'explained' },
      { ledger: 'explained' },
      { ledger: 'listed' },
    ]);
  });

  it('measures a gap from the end of the extent, not from its start', () => {
    const rows = [
      sourceRowOf('source', 'withdraw', MOMENT, { until: MOMENT + 10 * DAY_MS }),
      ledgerRowOf('ledger', MOMENT + 10 * DAY_MS + WINDOW, { direction: 'O' }),
    ];

    expect(verdictsOf(rows)).toEqual({ ledger: 'explained' });
  });

  it('measures a gap from the start of the extent for a row before it', () => {
    const rows = [
      sourceRowOf('source', 'withdraw', MOMENT, { until: MOMENT + 10 * DAY_MS }),
      ledgerRowOf('ledger', MOMENT - WINDOW, { direction: 'O' }),
    ];

    expect(verdictsOf(rows)).toEqual({ ledger: 'explained' });
  });

  it('finds a source whose long extent starts before the sources after it', () => {
    const rows = [
      sourceRowOf('source-a', 'withdraw', atDay(0), { until: atDay(10) }),
      sourceRowOf('source-b', 'withdraw', atDay(12)),
      ledgerRowOf('ledger-1', atDay(17), { direction: 'O' }),
      ledgerRowOf('ledger-2', atDay(17), { direction: 'O' }),
    ];

    expect(verdictsOf(rows)).toEqual({ 'ledger-1': 'explained', 'ledger-2': 'explained' });
  });
});

describe('the pairing', () => {
  it('gives a source to the row at its own moment, not to an earlier credit', () => {
    const rows = [
      ledgerRowOf('ledger-credit', atDay(7)),
      sourceRowOf('source', 'deposit', atDay(10)),
      ledgerRowOf('ledger-own', atDay(10)),
    ];

    expect(verdictsOf(rows)).toEqual({ 'ledger-credit': 'listed', 'ledger-own': 'explained' });
  });

  it('breaks a tie of form and distance by ledger key, then by source key', () => {
    const rows = [
      sourceRowOf('source-b', 'deposit', atDay(11)),
      sourceRowOf('source-a', 'deposit', atDay(9)),
      ledgerRowOf('ledger-2', atDay(10)),
      ledgerRowOf('ledger-1', atDay(10)),
      ledgerRowOf('ledger-near-a-only', atDay(2), { amount: '7' }),
      ledgerRowOf('ledger-near-b-only', atDay(18), { amount: '7' }),
    ];

    expect(verdictsOf(rows)).toEqual({
      'ledger-1': 'explained',
      'ledger-2': 'explained',
      'ledger-near-a-only': 'listed',
      'ledger-near-b-only': 'listed',
    });
  });

  it('keeps every pair when it moves one: a row nothing can take stays listed', () => {
    const rows = [
      sourceRowOf('source-a', 'deposit', atDay(0)),
      sourceRowOf('source-b', 'deposit', atDay(4)),
      ledgerRowOf('ledger-a', atDay(4)),
      ledgerRowOf('ledger-b', atDay(8)),
      ledgerRowOf('ledger-c', atDay(12)),
    ];

    expect(verdictsOf(rows)).toEqual({
      'ledger-a': 'explained',
      'ledger-b': 'explained',
      'ledger-c': 'listed',
    });
  });

  it('gives a row a source through a chain longer than the pairing before it', () => {
    const rows = Array.from({ length: 12 }, (_unused, index) => [
      sourceRowOf(`source-${String(index).padStart(2, '0')}`, 'deposit', atDay(4 * index)),
      ledgerRowOf(`ledger-${String(index).padStart(2, '0')}`, atDay(4 * index + 4)),
    ]).flat();

    expect(Object.values(verdictsOf(rows)).filter((verdict) => verdict !== 'explained')).toEqual(
      [],
    );
  });
});

describe('Earn and the order of the verdicts', () => {
  it('explains an Earn principal row by a source before the Earn rule reads it', () => {
    const rows = [
      sourceRowOf('source', 'deposit', MOMENT),
      ledgerRowOf('ledger', MOMENT, { earnPrincipal: true }),
    ];

    expect(verdictsOf(rows, { earnClause: 'read' })).toEqual({ ledger: 'explained' });
  });

  it('reads a stored false as not Earn under any clause', () => {
    const rows = [ledgerRowOf('ledger', MOMENT, { earnPrincipal: false })];

    expect(verdictsOf(rows, { earnClause: 'read' })).toEqual({ ledger: 'listed' });
    expect(verdictsOf(rows, { earnClause: 'inBalance' })).toEqual({ ledger: 'listed' });
  });

  it('gives an Earn principal row no row when Earn money counts in the balance', () => {
    const rows = [ledgerRowOf('ledger', MOMENT, { earnPrincipal: true })];

    expect(verdictsOf(rows, { earnClause: 'inBalance' })).toEqual({ ledger: 'earnMove' });
  });

  it('gives an Earn principal row no row before it waits', () => {
    const marks = { ...settledMarks(), capital: { cursor: null, pending: [] } };
    const rows = [ledgerRowOf('ledger', MOMENT, { earnPrincipal: true })];

    expect(verdictsOf(rows, { marks, earnClause: 'read' })).toEqual({ ledger: 'earnMove' });
  });

  it('waits before it holds', () => {
    const marks = { ...settledMarks(), capital: { cursor: null, pending: [] } };
    const rows = [
      sourceRowOf('source', 'deposit', MOMENT),
      ledgerRowOf('ledger', MOMENT, { amount: '99' }),
    ];

    expect(verdictsOf(rows, { marks })).toEqual({ ledger: 'waiting' });
  });
});

describe('a source series that may not have shown its source yet', () => {
  it('waits for a row until its series cursor is a day past it, and not a millisecond sooner', () => {
    const rows = [ledgerRowOf('ledger', MOMENT)];
    const behind = {
      ...settledMarks(),
      capital: { cursor: MOMENT + FUNDING_MATCH_HOLD_MS - 1, pending: [] },
    };
    const level = {
      ...settledMarks(),
      capital: { cursor: MOMENT + FUNDING_MATCH_HOLD_MS, pending: [] },
    };

    expect(verdictsOf(rows, { marks: behind })).toEqual({ ledger: 'waiting' });
    expect(verdictsOf(rows, { marks: level })).toEqual({ ledger: 'listed' });
  });

  it('waits for a row, whatever its age, when a capital or transfer cursor is null', () => {
    const rows = [ledgerRowOf('ledger', atDay(0))];

    expect(
      verdictsOf(rows, { marks: { ...settledMarks(), capital: { cursor: null, pending: [] } } }),
    ).toEqual({ ledger: 'waiting' });
    expect(
      verdictsOf(rows, { marks: { ...settledMarks(), transfer: { cursor: null, pending: [] } } }),
    ).toEqual({ ledger: 'waiting' });
  });

  it.each(['capital', 'transfer', 'convert'] as const)(
    'holds an In row and an Out row alike while the %s cursor is behind',
    (walk) => {
      const marks = { ...settledMarks(), [walk]: { cursor: NOW - 5 * DAY_MS, pending: [] } };
      const rows = [
        ledgerRowOf('ledger-in', NOW - 3 * DAY_MS),
        ledgerRowOf('ledger-out', NOW - 3 * DAY_MS, { direction: 'O' }),
      ];

      expect(verdictsOf(rows, { marks })).toEqual({
        'ledger-in': 'waiting',
        'ledger-out': 'waiting',
      });
    },
  );

  it.each([
    ['deposit', 'waiting', 'listed'],
    ['internal', 'waiting', 'listed'],
    ['withdraw', 'listed', 'waiting'],
    ['transfer', 'waiting', 'waiting'],
  ] as const)(
    'holds by a point owed in the %s series the In row %s and the Out row %s',
    (series, inVerdict, outVerdict) => {
      const walk = series === 'transfer' ? 'transfer' : 'capital';
      const marks = {
        ...settledMarks(),
        [walk]: walkOwing({ start: MOMENT, end: MOMENT + 1_000, kind: 'point', series }),
      };
      const rows = [
        ledgerRowOf('ledger-in', MOMENT),
        ledgerRowOf('ledger-out', MOMENT, { direction: 'O' }),
      ];

      expect(verdictsOf(rows, { marks })).toEqual({
        'ledger-in': inVerdict,
        'ledger-out': outVerdict,
      });
    },
  );

  it('holds both directions by a range of the capital walk that names no series', () => {
    const marks = {
      ...settledMarks(),
      capital: walkOwing({ start: MOMENT, end: MOMENT + DAY_MS }),
    };
    const rows = [
      ledgerRowOf('ledger-in', MOMENT),
      ledgerRowOf('ledger-out', MOMENT, { direction: 'O' }),
    ];

    expect(verdictsOf(rows, { marks })).toEqual({
      'ledger-in': 'waiting',
      'ledger-out': 'waiting',
    });
  });

  it('ignores owed ground of a series that is no source', () => {
    const marks = {
      ...settledMarks(),
      capital: walkOwing({ start: MOMENT, end: MOMENT + DAY_MS, series: 'fundingLedger' }),
    };

    expect(verdictsOf([ledgerRowOf('ledger', MOMENT)], { marks })).toEqual({ ledger: 'listed' });
  });

  it('holds a row exactly W from owed ground and not a millisecond further', () => {
    const owed = (distance: number) => ({
      ...settledMarks(),
      capital: walkOwing({ start: MOMENT + distance, end: MOMENT + distance + 1_000 }),
    });
    const rows = [ledgerRowOf('ledger', MOMENT)];

    expect(verdictsOf(rows, { marks: owed(WINDOW) })).toEqual({ ledger: 'waiting' });
    expect(verdictsOf(rows, { marks: owed(WINDOW + 1) })).toEqual({ ledger: 'listed' });
    expect(
      verdictsOf(rows, {
        marks: {
          ...settledMarks(),
          capital: walkOwing({ start: MOMENT - WINDOW - 1_000, end: MOMENT - WINDOW }),
        },
      }),
    ).toEqual({ ledger: 'waiting' });
    expect(
      verdictsOf(rows, {
        marks: {
          ...settledMarks(),
          capital: walkOwing({ start: MOMENT - WINDOW - 1_001, end: MOMENT - WINDOW - 1 }),
        },
      }),
    ).toEqual({ ledger: 'listed' });
  });
});

describe('the convert walk, which holds only a row under W old', () => {
  const NEVER_PASSED = { cursor: null, pending: [] } as const;

  it('holds a row one millisecond under W old and not one exactly W old', () => {
    const marks = { ...settledMarks(), convert: NEVER_PASSED };

    expect(verdictsOf([ledgerRowOf('ledger', NOW - WINDOW + 1)], { marks })).toEqual({
      ledger: 'waiting',
    });
    expect(verdictsOf([ledgerRowOf('ledger', NOW - WINDOW)], { marks })).toEqual({
      ledger: 'listed',
    });
  });

  it('measures the age against the now it is given', () => {
    const marks = { ...settledMarks(), convert: NEVER_PASSED };
    const rows = [ledgerRowOf('ledger', NOW - 10 * DAY_MS)];

    expect(verdictsOf(rows, { marks, now: NOW - 5 * DAY_MS })).toEqual({ ledger: 'waiting' });
    expect(verdictsOf(rows, { marks, now: NOW })).toEqual({ ledger: 'listed' });
  });

  it('gives an old row no wait from owed convert ground, point or range', () => {
    const old = atDay(0);
    const marks = {
      ...settledMarks(),
      convert: walkOwing(
        { start: old, end: old + 1_000, kind: 'point', series: 'convert' },
        { start: old - 30 * DAY_MS, end: old + 30 * DAY_MS, series: 'convert' },
      ),
    };

    expect(verdictsOf([ledgerRowOf('ledger', old)], { marks })).toEqual({ ledger: 'listed' });
  });

  it('keeps the age limit off the capital and transfer walks', () => {
    const marks = { ...settledMarks(), transfer: NEVER_PASSED };

    expect(verdictsOf([ledgerRowOf('ledger', atDay(0))], { marks })).toEqual({
      ledger: 'waiting',
    });
  });

  it('reads a merged range as owed ground only within W of its extent', () => {
    const extentEnd = NOW - 40 * DAY_MS;
    const marks = {
      ...settledMarks(),
      convert: walkOwing({ start: NOW - 700 * DAY_MS, end: extentEnd, series: 'convert' }),
    };
    const verdictAt = (time: number) =>
      verdictsOf([ledgerRowOf('ledger', time)], { marks, now: extentEnd + 3 * DAY_MS });

    expect(verdictAt(extentEnd)).toEqual({ ledger: 'waiting' });
    expect(verdictAt(extentEnd + WINDOW)).toEqual({ ledger: 'waiting' });
    expect(verdictAt(extentEnd + WINDOW + 1)).toEqual({ ledger: 'listed' });
  });

  it('holds a merged range over an In row and an Out row alike', () => {
    const marks = {
      ...settledMarks(),
      convert: walkOwing({ start: NOW - 730 * DAY_MS, end: NOW, series: 'convert' }),
    };
    const rows = [
      ledgerRowOf('ledger-in', NOW - DAY_MS),
      ledgerRowOf('ledger-out', NOW - DAY_MS, { direction: 'O' }),
    ];

    expect(verdictsOf(rows, { marks })).toEqual({
      'ledger-in': 'waiting',
      'ledger-out': 'waiting',
    });
  });
});

describe('a row that is not an In or an Out', () => {
  it('lists a row whose direction is neither', () => {
    const rows = [ledgerRowOf('ledger', MOMENT, { direction: 'X' })];
    const marks = { ...settledMarks(), capital: { cursor: null, pending: [] } };

    expect(verdictsOf(rows, { marks })).toEqual({ ledger: 'listed' });
  });
});
