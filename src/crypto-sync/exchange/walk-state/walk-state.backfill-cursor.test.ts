import { type ParsedWalkMarks, parseExchangeState } from './walk-state';
import { exchangeStatePatched, exchangeStateReset } from './exchange-state-patch';

const FLOOR_MS = 1_000;

type Stored = { version: 1; walks: { capital: unknown } };

const marksOf = (entry: unknown): ParsedWalkMarks => {
  const parsed = parseExchangeState(JSON.stringify({ version: 1, walks: { capital: entry } }));

  if (parsed.kind === 'malformed') {
    throw new Error('walk-state backfill-cursor test: a state that should parse');
  }

  return parsed.walks.capital;
};

const storedOf = (text: string | undefined): Stored => JSON.parse(text ?? 'null') as Stored;

describe('the backfill cursor of a walk', () => {
  it.each([
    ['zero', 0],
    ['a number', 5_000],
  ])('reads %s as it is', (_label, stored) => {
    expect(marksOf({ cursor: 900, backfillCursor: stored })).toMatchObject({
      backfillCursor: stored,
    });
  });

  it.each([
    ['nothing stored', undefined],
    ['null', null],
    ['text', '5000'],
    ['a boolean', true],
    ['a list', [5_000]],
    ['an object', {}],
  ])('reads %s as absent, with no mark of its own to repair', (_label, stored) => {
    expect(marksOf({ cursor: 900, backfillCursor: stored })).not.toHaveProperty('backfillCursor');
  });

  it('is a mark of its own: the range cursor of the windows owed for every coin is not it', () => {
    const marks = marksOf({ cursor: 900, rangeCursor: 700 });

    expect(marks).toMatchObject({ rangeCursor: 700 });
    expect(marks).not.toHaveProperty('backfillCursor');
  });

  it('round-trips through a walk patch', () => {
    const text = JSON.stringify({ version: 1, walks: { capital: { cursor: 5 } } });
    const set = storedOf(
      exchangeStatePatched(text, [
        { kind: 'walk', walkId: 'capital', field: 'backfillCursor', value: 700 },
      ]),
    );

    expect(set.walks.capital).toEqual({ cursor: 5, backfillCursor: 700 });
    expect(marksOf(set.walks.capital)).toMatchObject({ cursor: 5, backfillCursor: 700 });
  });

  it('is removed by a disconnect, which keeps no mark of the old account but the floor ones', () => {
    const text = JSON.stringify({
      version: 1,
      walks: { capital: { cursor: 5_000, rangeCursor: 4_000, backfillCursor: 3_000 } },
    });

    expect(storedOf(exchangeStateReset(text, FLOOR_MS))).toEqual({
      version: 1,
      walks: { capital: { cursor: FLOOR_MS } },
    });
  });
});
