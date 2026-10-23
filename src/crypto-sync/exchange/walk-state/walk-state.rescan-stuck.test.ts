import { type ParsedWalkMarks, parseExchangeState } from './walk-state';
import { exchangeStatePatched, exchangeStateReset } from './exchange-state-patch';

const FLOOR_MS = 1_000;

type Stored = { version: 1; walks: { fiatOrders: unknown } };

const marksOf = (entry: unknown): ParsedWalkMarks => {
  const parsed = parseExchangeState(JSON.stringify({ version: 1, walks: { fiatOrders: entry } }));

  if (parsed.kind === 'malformed') {
    throw new Error('walk-state rescan-stuck test: a state that should parse');
  }

  return parsed.walks.fiatOrders;
};

const storedOf = (text: string | undefined): Stored => JSON.parse(text ?? 'null') as Stored;

const STUCK = [
  { start: 10, end: 20 },
  { start: 40, end: 41 },
];

describe('the rescanStuck mark of a walk', () => {
  it('reads a stored list of ranges as it is', () => {
    expect(marksOf({ cursor: 900, rescanStuck: STUCK })).toMatchObject({ rescanStuck: STUCK });
  });

  it.each([
    ['an empty list', []],
    ['a list with a range that ends before it starts', [{ start: 5, end: 2 }]],
    ['a list with an entry that is no range', [{ start: 10, end: 20 }, 'text']],
    ['a range with no end', [{ start: 10 }]],
    ['text', 'stuck'],
    ['a number', 7],
    ['null', null],
  ])('reads %s as absent', (_label, stored) => {
    expect(marksOf({ cursor: 900, rescanStuck: stored })).not.toHaveProperty('rescanStuck');
  });

  it('round-trips through a walk patch, and an empty list clears it', () => {
    const text = JSON.stringify({ version: 1, walks: { fiatOrders: { cursor: 5 } } });
    const set = storedOf(
      exchangeStatePatched(text, [
        { kind: 'walk', walkId: 'fiatOrders', field: 'rescanStuck', value: STUCK },
      ]),
    );

    expect(set.walks.fiatOrders).toEqual({ cursor: 5, rescanStuck: STUCK });
    expect(marksOf(set.walks.fiatOrders)).toMatchObject({ cursor: 5, rescanStuck: STUCK });

    const cleared = storedOf(
      exchangeStatePatched(JSON.stringify(set), [
        { kind: 'walk', walkId: 'fiatOrders', field: 'rescanStuck', value: [] },
      ]),
    );

    expect(marksOf(cleared.walks.fiatOrders)).not.toHaveProperty('rescanStuck');
  });

  it('is removed by a disconnect, which keeps no mark of the old account but the floor ones', () => {
    const text = JSON.stringify({
      version: 1,
      walks: { fiatOrders: { cursor: 5_000, pending: [{ start: 1, end: 2 }], rescanStuck: STUCK } },
    });

    expect(storedOf(exchangeStateReset(text, FLOOR_MS))).toEqual({
      version: 1,
      walks: { fiatOrders: { cursor: FLOOR_MS, pending: [] } },
    });
  });
});
