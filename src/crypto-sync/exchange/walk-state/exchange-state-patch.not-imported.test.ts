import { type ExchangeStatePatch, exchangeStatePatched } from './exchange-state-patch';

const add = (...entries: string[]): ExchangeStatePatch => ({ kind: 'notImported', entries });

const storedOf = (text: string | undefined): unknown => JSON.parse(text ?? 'null');

const textOf = (rest: Record<string, unknown>): string =>
  JSON.stringify({ version: 1, walks: {}, ...rest });

describe('the not-imported patch', () => {
  it('adds entries as a union, with no duplicates', () => {
    const text = textOf({ notImported: ['p2p-sale:1:2'] });

    expect(
      storedOf(
        exchangeStatePatched(text, [
          add('convert-unrecognized:3:4', 'p2p-sale:1:2'),
          add('convert-unrecognized:3:4', 'p2p-amount:5:6'),
        ]),
      ),
    ).toEqual({
      version: 1,
      walks: {},
      notImported: ['p2p-sale:1:2', 'convert-unrecognized:3:4', 'p2p-amount:5:6'],
    });
  });

  it('starts the list in a state that has none, and in a column nothing wrote yet', () => {
    expect(storedOf(exchangeStatePatched(textOf({}), [add('p2p-sale:1:2')]))).toEqual({
      version: 1,
      walks: {},
      notImported: ['p2p-sale:1:2'],
    });
    expect(storedOf(exchangeStatePatched(null, [add('p2p-sale:1:2')]))).toEqual({
      version: 1,
      walks: {},
      notImported: ['p2p-sale:1:2'],
    });
  });

  it('keeps a stored entry of a kind this build does not know', () => {
    const text = textOf({ notImported: ['bybit-x:1:2', 'p2p-sale:1:2'] });

    expect(storedOf(exchangeStatePatched(text, [add('convert-unrecognized:3:4')]))).toEqual({
      version: 1,
      walks: {},
      notImported: ['bybit-x:1:2', 'p2p-sale:1:2', 'convert-unrecognized:3:4'],
    });
  });

  it('drops a stored entry that is no text', () => {
    const text = textOf({ notImported: [5, 'p2p-sale:1:2', null, {}] });

    expect(storedOf(exchangeStatePatched(text, [add('convert-unrecognized:3:4')]))).toEqual({
      version: 1,
      walks: {},
      notImported: ['p2p-sale:1:2', 'convert-unrecognized:3:4'],
    });
  });

  it.each([
    ['text', 'x'],
    ['an object', { a: 1 }],
    ['null', null],
  ])('starts a list that was stored as %s from the new entries', (_label, stored) => {
    expect(
      storedOf(exchangeStatePatched(textOf({ notImported: stored }), [add('p2p-sale:1:2')])),
    ).toEqual({ version: 1, walks: {}, notImported: ['p2p-sale:1:2'] });
  });

  it('leaves every other field byte-identical', () => {
    const rest = {
      futureKey: { keep: [1, 2] },
      balanceSyncedAt: 5_000,
      trades: { symbols: {}, rotation: 'BTCUSDT', balanceSnapshot: {} },
      untrackedCoins: { balance: ['PEPE'], history: ['XYZ'] },
    };
    const walks = { pay: { cursor: 123_456, pointCursor: 'junk' }, mystery: { cursor: 9 } };
    const text = JSON.stringify({ version: 1, ...rest, walks });
    const patched = exchangeStatePatched(text, [add('p2p-sale:1:2')]);

    expect(patched).toBe(
      JSON.stringify({ version: 1, ...rest, walks, notImported: ['p2p-sale:1:2'] }),
    );
  });

  it('writes nothing into a state whose top level is malformed', () => {
    expect(exchangeStatePatched('{"version":2,"walks":{}}', [add('p2p-sale:1:2')])).toBeUndefined();
  });
});
