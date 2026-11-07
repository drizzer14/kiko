import { DAY_MS } from '@kiko/dates';

import {
  NOW,
  atDay,
  ledgerRowOf,
  settledMarks,
  sourceRowOf,
  verdictsOf,
} from './bybit.funding-test-fixtures';

const MOMENT = atDay(10);

describe('gives each ledger row of the matrix its verdict', () => {
  it('explains an In row by a deposit of the same amount in the same second', () => {
    const rows = [sourceRowOf('source', 'deposit', MOMENT), ledgerRowOf('ledger', MOMENT)];

    expect(verdictsOf(rows)).toEqual({ ledger: 'explained' });
  });

  it('explains an Out row by a withdrawal whose amount holds the fee', () => {
    const rows = [
      sourceRowOf('source', 'withdraw', MOMENT, { amount: '41.43008', fee: '5' }),
      ledgerRowOf('ledger', MOMENT, { direction: 'O', amount: '46.43008' }),
    ];

    expect(verdictsOf(rows)).toEqual({ ledger: 'explained' });
  });

  it('explains the withdrawal by its own row and lists the separate fee row', () => {
    const rows = [
      sourceRowOf('source', 'withdraw', MOMENT, { amount: '41.43008', fee: '5' }),
      ledgerRowOf('ledger-1', MOMENT, { direction: 'O', amount: '41.43008' }),
      ledgerRowOf('ledger-2', MOMENT, { direction: 'O', amount: '5' }),
    ];

    expect(verdictsOf(rows)).toEqual({ 'ledger-1': 'explained', 'ledger-2': 'listed' });
  });

  it('explains an Out row by a transfer from Funding', () => {
    const rows = [
      sourceRowOf('source', 'transfer', MOMENT, { direction: 'O', amount: '5000' }),
      ledgerRowOf('ledger', MOMENT, { direction: 'O', amount: '5000' }),
    ];

    expect(verdictsOf(rows)).toEqual({ ledger: 'explained' });
  });

  it('explains an In row by a transfer to Funding', () => {
    const rows = [
      sourceRowOf('source', 'transfer', MOMENT, { amount: '5000' }),
      ledgerRowOf('ledger', MOMENT, { amount: '5000' }),
    ];

    expect(verdictsOf(rows)).toEqual({ ledger: 'explained' });
  });

  it('lists an In row when the only source of its amount is an Out transfer its own row took', () => {
    const rows = [
      sourceRowOf('source', 'transfer', MOMENT, { direction: 'O', amount: '5000' }),
      ledgerRowOf('ledger-out', MOMENT, { direction: 'O', amount: '5000' }),
      ledgerRowOf('ledger-in', MOMENT, { amount: '5000' }),
    ];

    expect(verdictsOf(rows)).toEqual({ 'ledger-out': 'explained', 'ledger-in': 'listed' });
  });

  it('explains both rows of a convert on Funding', () => {
    const rows = [
      sourceRowOf('source-out', 'convert', MOMENT, { direction: 'O', coin: 'ETH', amount: '0.1' }),
      sourceRowOf('source-in', 'convert', MOMENT, { coin: 'BTC', amount: '0.00534882723991' }),
      ledgerRowOf('ledger-out', MOMENT, { direction: 'O', coin: 'ETH', amount: '0.1' }),
      ledgerRowOf('ledger-in', MOMENT, { coin: 'BTC', amount: '0.00534882723991' }),
    ];

    expect(verdictsOf(rows)).toEqual({ 'ledger-out': 'explained', 'ledger-in': 'explained' });
  });

  it('holds the In row of a convert whose amount the ledger rounds', () => {
    const rows = [
      sourceRowOf('source-out', 'convert', MOMENT, { direction: 'O', coin: 'ETH', amount: '0.1' }),
      sourceRowOf('source-in', 'convert', MOMENT, { coin: 'BTC', amount: '0.00534882723991' }),
      ledgerRowOf('ledger-out', MOMENT, { direction: 'O', coin: 'ETH', amount: '0.1' }),
      ledgerRowOf('ledger-in', MOMENT, { coin: 'BTC', amount: '0.00534882' }),
    ];

    expect(verdictsOf(rows)).toEqual({ 'ledger-out': 'explained', 'ledger-in': 'held' });
  });

  it('gives one source to the lower key of two equal rows at one time and lists the other', () => {
    const rows = [
      sourceRowOf('source', 'deposit', MOMENT),
      ledgerRowOf('ledger-b', MOMENT),
      ledgerRowOf('ledger-a', MOMENT),
    ];

    expect(verdictsOf(rows)).toEqual({ 'ledger-a': 'explained', 'ledger-b': 'listed' });
  });

  it('explains one row by one of two equal sources and leaves the other free', () => {
    const rows = [
      sourceRowOf('source-1', 'deposit', MOMENT),
      sourceRowOf('source-2', 'deposit', MOMENT),
      ledgerRowOf('ledger', MOMENT),
    ];

    expect(verdictsOf(rows)).toEqual({ ledger: 'explained' });
  });

  it('lists an In row that has no source', () => {
    expect(verdictsOf([ledgerRowOf('ledger', MOMENT)])).toEqual({ ledger: 'listed' });
  });

  it('explains an In row by a deposit three days earlier, even if the deposit landed elsewhere', () => {
    const rows = [
      sourceRowOf('source', 'deposit', MOMENT),
      ledgerRowOf('ledger', MOMENT + 3 * DAY_MS),
    ];

    expect(verdictsOf(rows)).toEqual({ ledger: 'explained' });
  });

  it('lists an In row eight days after a deposit of the same amount', () => {
    const rows = [
      sourceRowOf('source', 'deposit', MOMENT),
      ledgerRowOf('ledger', MOMENT + 8 * DAY_MS),
    ];

    expect(verdictsOf(rows)).toEqual({ ledger: 'listed' });
  });

  it('holds an In row a little under a deposit that no other row explains', () => {
    const rows = [
      sourceRowOf('source', 'deposit', MOMENT),
      ledgerRowOf('ledger', MOMENT, { amount: '99' }),
    ];

    expect(verdictsOf(rows)).toEqual({ ledger: 'held' });
  });

  it('holds that row a day later too, since no field tells where the deposit landed', () => {
    const rows = [
      sourceRowOf('source', 'deposit', MOMENT),
      ledgerRowOf('ledger', MOMENT + DAY_MS, { amount: '99' }),
    ];

    expect(verdictsOf(rows)).toEqual({ ledger: 'held' });
  });

  it('lists a row one second after its deposit when the window is zero', () => {
    const rows = [sourceRowOf('source', 'deposit', MOMENT), ledgerRowOf('ledger', MOMENT + 1_000)];

    expect(verdictsOf(rows, { windowMs: 0 })).toEqual({ ledger: 'listed' });
  });

  it('explains a row a year after a deposit when the window is 729 days, and lists it at seven', () => {
    const rows = [
      sourceRowOf('source', 'deposit', NOW - 380 * DAY_MS),
      ledgerRowOf('ledger', NOW - 15 * DAY_MS),
    ];

    expect(verdictsOf(rows, { windowMs: 729 * DAY_MS })).toEqual({ ledger: 'explained' });
    expect(verdictsOf(rows)).toEqual({ ledger: 'listed' });
  });

  it('gives an Out row of an Earn principal word no row when Earn is read', () => {
    const rows = [ledgerRowOf('ledger', MOMENT, { direction: 'O', earnPrincipal: true })];

    expect(verdictsOf(rows, { earnClause: 'read' })).toEqual({ ledger: 'earnMove' });
  });

  it('lists the same Out row when the clause says Earn money is not counted', () => {
    const rows = [ledgerRowOf('ledger', MOMENT, { direction: 'O', earnPrincipal: true })];

    expect(verdictsOf(rows, { earnClause: 'notCounted' })).toEqual({ ledger: 'listed' });
  });

  it('gives an In row of an Earn principal word no row when Earn is read', () => {
    const rows = [ledgerRowOf('ledger', MOMENT, { earnPrincipal: true })];

    expect(verdictsOf(rows, { earnClause: 'read' })).toEqual({ ledger: 'earnMove' });
  });

  it('lists an interest row under either clause, because its words are not principal', () => {
    const rows = [ledgerRowOf('ledger', MOMENT, { coin: 'BTC', amount: '0.00003561' })];

    expect(verdictsOf(rows, { earnClause: 'read' })).toEqual({ ledger: 'listed' });
    expect(verdictsOf(rows, { earnClause: 'notCounted' })).toEqual({ ledger: 'listed' });
  });

  it('lists an Out row of a word on no list even when Earn is read', () => {
    const rows = [ledgerRowOf('ledger', MOMENT, { direction: 'O' })];

    expect(verdictsOf(rows, { earnClause: 'read' })).toEqual({ ledger: 'listed' });
  });

  it('lists an Out row of a word on no list when Earn money is counted in the balance', () => {
    const rows = [ledgerRowOf('ledger', MOMENT, { direction: 'O' })];

    expect(verdictsOf(rows, { earnClause: 'inBalance' })).toEqual({ ledger: 'listed' });
  });

  it('lists both rows of a withdrawal the user cancelled, which has no source', () => {
    const rows = [
      ledgerRowOf('ledger-out', MOMENT, { direction: 'O' }),
      ledgerRowOf('ledger-in', MOMENT),
    ];

    expect(verdictsOf(rows)).toEqual({ 'ledger-out': 'listed', 'ledger-in': 'listed' });
  });

  it('lists both rows of a rolled back deposit, whose source is gone', () => {
    const rows = [
      ledgerRowOf('ledger-in', MOMENT),
      ledgerRowOf('ledger-out', MOMENT + 1_000, { direction: 'O' }),
    ];

    expect(verdictsOf(rows)).toEqual({ 'ledger-in': 'listed', 'ledger-out': 'listed' });
  });

  it('reads 100 and 100.00 as one amount, exactly', () => {
    const rows = [
      sourceRowOf('source', 'deposit', MOMENT, { amount: '100.00' }),
      ledgerRowOf('ledger', MOMENT, { amount: '100' }),
    ];

    expect(verdictsOf(rows)).toEqual({ ledger: 'explained' });
  });

  it('waits for a convert whose cursor never moved, for a row under seven days old', () => {
    const marks = { ...settledMarks(), convert: { cursor: null, pending: [] } };
    const rows = [ledgerRowOf('ledger', NOW - 3 * DAY_MS)];

    expect(verdictsOf(rows, { marks })).toEqual({ ledger: 'waiting' });
  });

  it('lists a row eight days old when the convert cursor never moved', () => {
    const marks = { ...settledMarks(), convert: { cursor: null, pending: [] } };
    const rows = [ledgerRowOf('ledger', NOW - 8 * DAY_MS)];

    expect(verdictsOf(rows, { marks })).toEqual({ ledger: 'listed' });
  });

  it('explains two equal rows by two equal sources days apart through a repair', () => {
    const rows = [
      sourceRowOf('source-a', 'deposit', atDay(0)),
      sourceRowOf('source-b', 'deposit', atDay(4)),
      ledgerRowOf('ledger-a', atDay(4)),
      ledgerRowOf('ledger-b', atDay(8)),
    ];

    expect(verdictsOf(rows)).toEqual({ 'ledger-a': 'explained', 'ledger-b': 'explained' });
  });

  it('explains a chain of three rows by three sources through a repair of two moves', () => {
    const rows = [
      sourceRowOf('source-0', 'deposit', atDay(0)),
      sourceRowOf('source-4', 'deposit', atDay(4)),
      sourceRowOf('source-8', 'deposit', atDay(8)),
      ledgerRowOf('ledger-4', atDay(4)),
      ledgerRowOf('ledger-8', atDay(8)),
      ledgerRowOf('ledger-12', atDay(12)),
    ];

    expect(verdictsOf(rows)).toEqual({
      'ledger-4': 'explained',
      'ledger-8': 'explained',
      'ledger-12': 'explained',
    });
  });

  it('moves a withdrawal to its fee form so that two Out rows of one amount are both explained', () => {
    const rows = [
      sourceRowOf('source-a', 'withdraw', atDay(0), { amount: '100', fee: '5' }),
      sourceRowOf('source-b', 'withdraw', atDay(3), { amount: '105' }),
      ledgerRowOf('ledger-3', atDay(3), { direction: 'O', amount: '105' }),
      ledgerRowOf('ledger-8', atDay(8), { direction: 'O', amount: '105' }),
    ];

    expect(verdictsOf(rows)).toEqual({ 'ledger-3': 'explained', 'ledger-8': 'explained' });
  });

  it('gives a source to the nearer of two credits and lists the one that comes later', () => {
    const rows = [
      sourceRowOf('source', 'deposit', atDay(0)),
      ledgerRowOf('ledger-credit', atDay(1)),
      ledgerRowOf('ledger-own', atDay(5)),
    ];

    expect(verdictsOf(rows)).toEqual({ 'ledger-credit': 'explained', 'ledger-own': 'listed' });
  });

  it('waits for a row near a deposit that is owed a point, and does not list it', () => {
    const marks = settledMarks();

    marks.capital.pending = [
      { start: atDay(3), end: atDay(3) + 1_000, kind: 'point', series: 'deposit' },
    ];

    expect(verdictsOf([ledgerRowOf('ledger', atDay(0))], { marks })).toEqual({
      ledger: 'waiting',
    });
  });

  it('waits for a row under seven days old inside a merged convert range, and lists an older one', () => {
    const marks = settledMarks();

    marks.convert.pending = [{ start: NOW - 730 * DAY_MS, end: NOW, series: 'convert' }];

    const rows = [
      ledgerRowOf('ledger-new', NOW - 3 * DAY_MS),
      ledgerRowOf('ledger-old', NOW - 8 * DAY_MS),
    ];

    expect(verdictsOf(rows, { marks })).toEqual({
      'ledger-new': 'waiting',
      'ledger-old': 'listed',
    });
  });
});
