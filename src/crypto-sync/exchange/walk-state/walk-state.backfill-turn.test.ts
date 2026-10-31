import { type ParsedWalkMarks, parseExchangeState } from './walk-state';
import { exchangeStatePatched, exchangeStateReset } from './exchange-state-patch';

const FLOOR_MS = 1_000;

type Stored = { version: 1; walks: { transfer: unknown } };

const marksOf = (entry: unknown): ParsedWalkMarks => {
  const parsed = parseExchangeState(JSON.stringify({ version: 1, walks: { transfer: entry } }));

  if (parsed.kind === 'malformed') {
    throw new Error('walk-state backfill-turn test: a state that should parse');
  }

  return parsed.walks.transfer;
};

const storedOf = (text: string | undefined): Stored => JSON.parse(text ?? 'null') as Stored;

describe('the backfill turn mark of a walk', () => {
  it('reads a stored true as it is', () => {
    expect(marksOf({ cursor: 900, backfillTurn: true })).toMatchObject({ backfillTurn: true });
  });

  it.each([
    ['nothing stored', undefined],
    ['false', false],
    ['1', 1],
    ['the text true', 'true'],
    ['null', null],
    ['a list', [true]],
  ])('reads %s as absent, with no mark of its own to repair', (_label, stored) => {
    expect(marksOf({ cursor: 900, backfillTurn: stored })).not.toHaveProperty('backfillTurn');
  });

  it('is a mark of its own: the other turn marks and the backfill cursor are not it', () => {
    const marks = marksOf({ cursor: 900, rescanTurn: true, backfillCursor: 700 });

    expect(marks).not.toHaveProperty('backfillTurn');
  });

  it('round-trips through a walk patch, and a false clears it', () => {
    const text = JSON.stringify({ version: 1, walks: { transfer: { cursor: 5 } } });
    const set = storedOf(
      exchangeStatePatched(text, [
        { kind: 'walk', walkId: 'transfer', field: 'backfillTurn', value: true },
      ]),
    );

    expect(set.walks.transfer).toEqual({ cursor: 5, backfillTurn: true });
    expect(marksOf(set.walks.transfer)).toMatchObject({ cursor: 5, backfillTurn: true });

    const cleared = storedOf(
      exchangeStatePatched(JSON.stringify(set), [
        { kind: 'walk', walkId: 'transfer', field: 'backfillTurn', value: false },
      ]),
    );

    expect(marksOf(cleared.walks.transfer)).not.toHaveProperty('backfillTurn');
  });

  it('is removed by a disconnect, which keeps no mark of the old account but the floor ones', () => {
    const text = JSON.stringify({
      version: 1,
      walks: { transfer: { cursor: 5_000, backfillCursor: 3_000, backfillTurn: true } },
    });

    expect(storedOf(exchangeStateReset(text, FLOOR_MS))).toEqual({
      version: 1,
      walks: { transfer: { cursor: FLOOR_MS } },
    });
  });
});
