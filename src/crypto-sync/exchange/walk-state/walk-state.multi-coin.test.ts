import { type ParsedWalkMarks, parseExchangeState, WALK_IDS, type WalkId } from './walk-state';

const marksOf = (entry: unknown, walkId: WalkId): ParsedWalkMarks => {
  const parsed = parseExchangeState(JSON.stringify({ version: 1, walks: { [walkId]: entry } }));

  if (parsed.kind === 'malformed') {
    throw new Error('walk-state multi-coin test: a state that should parse');
  }

  return parsed.walks[walkId];
};

describe.each(WALK_IDS)('the multi-coin marks of the %s walk', (walkId) => {
  it('reads a stored range start and a stored seen mark as they are', () => {
    const marks = marksOf({ cursor: 900, multiCoinSince: 500, multiCoinSeen: true }, walkId);

    expect(marks).toMatchObject({ cursor: 900, multiCoinSince: 500, multiCoinSeen: true });
  });

  it('reads an entry that holds neither mark with neither', () => {
    const marks = marksOf({ cursor: 900 }, walkId);

    expect(marks).not.toHaveProperty('multiCoinSince');
    expect(marks).not.toHaveProperty('multiCoinSeen');
  });

  it('reads a malformed multiCoinSince as the stored cursor and a malformed multiCoinSeen as absent', () => {
    const marks = marksOf({ cursor: 900, multiCoinSince: 'x', multiCoinSeen: 'yes' }, walkId);

    expect(marks.multiCoinSince).toBe(900);
    expect(marks).not.toHaveProperty('multiCoinSeen');
  });

  it('reads a malformed multiCoinSince and multiCoinSeen of an entry with a null cursor as neither', () => {
    const marks = marksOf({ cursor: null, multiCoinSince: 'x', multiCoinSeen: 'yes' }, walkId);

    expect(marks).not.toHaveProperty('multiCoinSince');
    expect(marks).not.toHaveProperty('multiCoinSeen');
  });

  it.each([
    ['null', null],
    ['a boolean', true],
    ['a list', [5]],
  ])(
    'reads multiCoinSince stored as %s like any malformed one, as the cursor',
    (_label, stored) => {
      expect(marksOf({ cursor: 900, multiCoinSince: stored }, walkId).multiCoinSince).toBe(900);
    },
  );

  it.each([
    ['false', false],
    ['1', 1],
    ['the text true', 'true'],
  ])('reads multiCoinSeen stored as %s as absent', (_label, stored) => {
    expect(marksOf({ cursor: 900, multiCoinSeen: stored }, walkId)).not.toHaveProperty(
      'multiCoinSeen',
    );
  });
});
