import {
  type ExchangeStatePatch,
  exchangeStatePatched,
  exchangeStateReset,
} from './exchange-state-patch';

const FLOOR_MS = 1_000;

const stamp = (value: number): ExchangeStatePatch => ({ kind: 'balanceSyncedAt', value });

const storedOf = (text: string | undefined): unknown => JSON.parse(text ?? 'null');

describe('the balance sync stamp patch', () => {
  it('writes the stamp into a state that has none', () => {
    const text = JSON.stringify({ version: 1, walks: {} });

    expect(storedOf(exchangeStatePatched(text, [stamp(5_000)]))).toEqual({
      version: 1,
      walks: {},
      balanceSyncedAt: 5_000,
    });
  });

  it('writes the stamp into a column nothing wrote yet', () => {
    expect(storedOf(exchangeStatePatched(null, [stamp(5_000)]))).toEqual({
      version: 1,
      walks: {},
      balanceSyncedAt: 5_000,
    });
  });

  it('replaces an earlier stamp, and leaves the walks, the lists and the trades as stored', () => {
    const seed = {
      version: 1,
      walks: { pay: { cursor: 7 } },
      trades: { symbols: {}, rotation: 'BTCUSDT', balanceSnapshot: {} },
      untrackedCoins: { balance: ['PEPE'], history: ['XYZ'] },
      oversizedCoins: { balance: ['SHIB'], history: ['DOGE'], balanceByWallet: { spot: ['SHIB'] } },
      balanceSyncedAt: 1_000,
    };

    expect(storedOf(exchangeStatePatched(JSON.stringify(seed), [stamp(9_000)]))).toEqual({
      ...seed,
      balanceSyncedAt: 9_000,
    });
  });

  it('is written beside the lists of the same read, whichever order they come in', () => {
    const lists: ExchangeStatePatch = {
      kind: 'coinList',
      coins: 'untrackedCoins',
      list: 'balance',
      tickers: ['PEPE'],
    };
    const text = JSON.stringify({ version: 1, walks: {} });

    expect(storedOf(exchangeStatePatched(text, [lists, stamp(5_000)]))).toEqual(
      storedOf(exchangeStatePatched(text, [stamp(5_000), lists])),
    );
  });

  it('writes nothing into a state whose top level is malformed', () => {
    expect(exchangeStatePatched('{"version":2,"walks":{}}', [stamp(5_000)])).toBeUndefined();
  });
});

describe('a disconnect and the balance sync stamp', () => {
  it('removes the stamp with everything else but the walks and the owner value, O93', () => {
    const stored = JSON.stringify({
      version: 1,
      walks: { pay: { cursor: 700 } },
      balanceSyncedAt: 5_000,
      keyOwner: '9f2c',
    });

    expect(storedOf(exchangeStateReset(stored, FLOOR_MS))).toEqual({
      version: 1,
      walks: { pay: { cursor: FLOOR_MS } },
      keyOwner: '9f2c',
    });
  });

  it('removes the stamp of a state with no walk entry', () => {
    const stored = JSON.stringify({ version: 1, walks: {}, balanceSyncedAt: 5_000 });

    expect(storedOf(exchangeStateReset(stored, FLOOR_MS))).toEqual({ version: 1, walks: {} });
  });
});
