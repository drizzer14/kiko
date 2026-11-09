import {
  type ExchangeStatePatch,
  exchangeStatePatched,
  exchangeStateReset,
} from './exchange-state-patch';

const ownerPatch = (value: string): ExchangeStatePatch => ({ kind: 'keyOwner', value });

const stateWith = (keyOwner?: unknown, rest: Record<string, unknown> = {}): string =>
  JSON.stringify({ version: 1, walks: {}, ...rest, keyOwner });

const storedOf = (text: string | undefined): Record<string, unknown> => JSON.parse(text ?? 'null');

const ownerOf = (text: string | undefined): unknown => storedOf(text).keyOwner;

describe('the key owner patch, O93', () => {
  it('writes the value into a state that has none', () => {
    expect(
      ownerOf(exchangeStatePatched(JSON.stringify({ version: 1, walks: {} }), [ownerPatch('aa')])),
    ).toBe('aa');
  });

  it('writes into a column nothing wrote yet', () => {
    expect(ownerOf(exchangeStatePatched(null, [ownerPatch('aa')]))).toBe('aa');
  });

  it('replaces the stored value, so the owner of the last good read stands', () => {
    expect(ownerOf(exchangeStatePatched(stateWith('old'), [ownerPatch('new')]))).toBe('new');
  });

  it.each([
    ['a list', ['x']],
    ['a number', 7],
    ['an object', { x: 1 }],
    ['null', null],
  ])('replaces a stored value that is %s', (_title, seed) => {
    expect(ownerOf(exchangeStatePatched(stateWith(seed), [ownerPatch('aa')]))).toBe('aa');
  });

  it('leaves every other part of the state as stored', () => {
    const rest = {
      walks: { pay: { cursor: 7 } },
      untrackedCoins: { balance: ['PEPE'], history: ['XYZ'] },
      balanceNotes: { fund: { refused: true } },
      keyExpiry: { expiredAtMs: 5, readAtMs: 1 },
      balanceSyncedAt: 1_000,
      notImported: ['p2p-sale:1:2'],
      laterBuildKey: { kept: true },
    };
    const before = JSON.parse(stateWith(undefined, rest));
    const after = storedOf(exchangeStatePatched(stateWith(undefined, rest), [ownerPatch('aa')]));

    expect(after).toEqual({ ...before, keyOwner: 'aa' });
  });

  it('writes nothing into a state whose top level is malformed', () => {
    expect(exchangeStatePatched('{"version":2,"walks":{}}', [ownerPatch('aa')])).toBeUndefined();
  });
});

describe('a disconnect and the owner value, O93', () => {
  it('a reset keeps the owner value and the walks, and nothing else', () => {
    const text = stateWith('9f2c', {
      walks: { capital: { cursor: 9 }, log: { cursor: 5, pending: [{ start: 1, end: 3 }] } },
      balanceNotes: { fund: { refused: true } },
      keyExpiry: { expiredAtMs: 5, readAtMs: 1 },
      untrackedCoins: { balance: ['PEPE'] },
      balanceSyncedAt: 5_000,
      laterBuildKey: { kept: false },
    });

    expect(storedOf(exchangeStateReset(text, 1_000))).toEqual({
      version: 1,
      walks: { capital: { cursor: 1_000 }, log: { cursor: 1_000, pending: [] } },
      keyOwner: '9f2c',
    });
  });

  it('keeps the value of a state that has no walk entry', () => {
    expect(storedOf(exchangeStateReset(stateWith('9f2c'), 1_000))).toEqual({
      version: 1,
      walks: {},
      keyOwner: '9f2c',
    });
  });

  it.each([
    ['a number', 7],
    ['null', null],
    ['a list', ['x']],
    ['an empty text', ''],
  ])('drops a stored value that is %s, as no text', (_title, keyOwner) => {
    expect(storedOf(exchangeStateReset(stateWith(keyOwner), 1_000))).toEqual({
      version: 1,
      walks: {},
    });
  });

  it('writes the same text as before for a state that holds no value, as Binance never does', () => {
    const text = JSON.stringify({ version: 1, walks: { pay: { cursor: 700 } }, trades: {} });

    expect(exchangeStateReset(text, 1_000)).toBe(
      JSON.stringify({ version: 1, walks: { pay: { cursor: 1_000 } } }),
    );
  });

  it('stores no value for a state whose top level is malformed, and the capital floor alone', () => {
    expect(
      storedOf(exchangeStateReset('{"version":2,"walks":{},"keyOwner":"9f2c"}', 1_000)),
    ).toEqual({ version: 1, walks: { capital: { cursor: 1_000 } } });
  });
});
