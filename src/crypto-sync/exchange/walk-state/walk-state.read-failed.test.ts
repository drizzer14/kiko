import { parseExchangeState } from './walk-state';
import { exchangeStateReset } from './exchange-state-patch';

const parsedP2pOf = (stored: unknown) => {
  const parsed = parseExchangeState(
    JSON.stringify({ version: 1, walks: { p2p: { cursor: 1_000, readFailedAt: stored } } }),
  );

  if (parsed.kind === 'malformed') {
    throw new Error('walk-state read-failed test: a state that should parse');
  }

  return parsed;
};

// The parsed field is looked up at runtime, so this file typechecks before the field exists.
const readFailedAtOf = (stored: unknown): unknown =>
  (parsedP2pOf(stored).walks.p2p as Record<string, unknown>).readFailedAt;

describe('the read-failed mark of a parsed P2P walk', () => {
  it.each([
    ['a time', 1_700_000_000_000],
    ['zero', 0],
  ])('reads %s as stored', (_label, stored) => {
    expect(readFailedAtOf(stored)).toBe(stored);
  });

  it.each([
    ['a negative number', -1],
    ['a fraction', 1.5],
    ['text', '1700000000000'],
    ['null', null],
    ['an object', {}],
    ['true', true],
  ])('reads %s as absent, with no repair named', (_label, stored) => {
    expect(readFailedAtOf(stored)).toBeUndefined();
    expect(parsedP2pOf(stored).unreadable).toEqual([]);
  });
});

describe('a disconnect and the read-failed mark', () => {
  it('drops the mark and keeps the floor cursor', () => {
    const reset = JSON.parse(
      exchangeStateReset(
        JSON.stringify({
          version: 1,
          walks: { p2p: { cursor: 5_000, readFailedAt: 4_000 } },
        }),
        1_000,
      ),
    ) as { walks: { p2p: Record<string, unknown> } };

    expect(reset.walks.p2p).toEqual({ cursor: 1_000 });
  });
});
