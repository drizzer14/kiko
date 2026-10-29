import { type ParsedWalkMarks, parseExchangeState } from './walk-state';
import { exchangeStatePatched, exchangeStateReset } from './exchange-state-patch';

const FLOOR_MS = 1_000;

type Stored = { version: 1; walks: { fiatOrders: unknown } };

const marksOf = (entry: unknown): ParsedWalkMarks => {
  const parsed = parseExchangeState(JSON.stringify({ version: 1, walks: { fiatOrders: entry } }));

  if (parsed.kind === 'malformed') {
    throw new Error('walk-state behind-run test: a state that should parse');
  }

  return parsed.walks.fiatOrders;
};

const storedOf = (text: string | undefined): Stored => JSON.parse(text ?? 'null') as Stored;

describe.each(['behindRun', 'rescanTurn'] as const)('the %s mark of a walk', (field) => {
  it('reads a stored true as it is', () => {
    expect(marksOf({ cursor: 900, [field]: true })).toMatchObject({ [field]: true });
  });

  it.each([
    ['nothing stored', undefined],
    ['false', false],
    ['1', 1],
    ['the text true', 'true'],
    ['null', null],
  ])('reads %s as absent', (_label, stored) => {
    expect(marksOf({ cursor: 900, [field]: stored })).not.toHaveProperty(field);
  });

  it('round-trips through a walk patch, and a false clears it', () => {
    const text = JSON.stringify({ version: 1, walks: { fiatOrders: { cursor: 5 } } });
    const set = storedOf(
      exchangeStatePatched(text, [{ kind: 'walk', walkId: 'fiatOrders', field, value: true }]),
    );

    expect(set.walks.fiatOrders).toEqual({ cursor: 5, [field]: true });
    expect(marksOf(set.walks.fiatOrders)).toMatchObject({ cursor: 5, [field]: true });

    const cleared = storedOf(
      exchangeStatePatched(JSON.stringify(set), [
        { kind: 'walk', walkId: 'fiatOrders', field, value: false },
      ]),
    );

    expect(marksOf(cleared.walks.fiatOrders)).not.toHaveProperty(field);
  });
});

describe('the turn marks of a walk', () => {
  it('reads each mark on its own, so a stored behind mark alone is no re-scan mark', () => {
    const marks = marksOf({ cursor: 900, behindRun: true });

    expect(marks).toMatchObject({ behindRun: true });
    expect(marks).not.toHaveProperty('rescanTurn');
  });

  it('are removed by a disconnect, which keeps no mark of the old account but the floor ones', () => {
    const text = JSON.stringify({
      version: 1,
      walks: {
        fiatOrders: {
          cursor: 5_000,
          pending: [{ start: 1, end: 2 }],
          behindRun: true,
          rescanTurn: true,
        },
      },
    });

    expect(storedOf(exchangeStateReset(text, FLOOR_MS))).toEqual({
      version: 1,
      walks: { fiatOrders: { cursor: FLOOR_MS, pending: [] } },
    });
  });
});
