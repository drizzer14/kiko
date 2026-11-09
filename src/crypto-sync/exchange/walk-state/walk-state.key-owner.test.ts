import { parseExchangeState } from './walk-state';

const stateWith = (keyOwner?: unknown, rest: Record<string, unknown> = {}): string =>
  JSON.stringify({ version: 1, walks: {}, ...rest, keyOwner });

const parsedKeyOwner = (keyOwner?: unknown) => {
  const parsed = parseExchangeState(stateWith(keyOwner));

  return parsed.kind === 'parsed' ? parsed : undefined;
};

describe('the stored owner value of the key, O93', () => {
  it('reads the value as stored', () => {
    expect(parsedKeyOwner('9f2c')).toMatchObject({ keyOwner: '9f2c', unreadable: [] });
  });

  it('reads none for a state that never stored one, with nothing unreadable', () => {
    expect(parsedKeyOwner()).toMatchObject({ keyOwner: undefined, unreadable: [] });
  });

  it.each([
    ['a number', 7],
    ['a list', ['x']],
    ['an object', { value: 'x' }],
    ['a boolean', true],
    ['null', null],
    ['an empty text', ''],
  ])('names the entry unreadable and reads none when it is %s', (_title, keyOwner) => {
    expect(parsedKeyOwner(keyOwner)).toMatchObject({
      keyOwner: undefined,
      unreadable: ['keyOwner'],
    });
  });

  it('reads none from a state whose top level is malformed', () => {
    expect(parseExchangeState('{"version":2,"walks":{},"keyOwner":"9f2c"}')).toEqual({
      kind: 'malformed',
    });
  });

  it('is the only part of the state it changes', () => {
    const rest = { balanceSyncedAt: 9, notImported: ['p2p-sale:1:2'], laterBuildKey: { kept: 1 } };
    const without = parseExchangeState(stateWith(undefined, rest));
    const withValue = parseExchangeState(stateWith('9f2c', rest));

    expect(withValue).toEqual({ ...without, keyOwner: '9f2c' });
  });
});
