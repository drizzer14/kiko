import { parseExchangeState } from './walk-state';
import { exchangeStatePatched, exchangeStateReset } from './exchange-state-patch';

const stateWith = (trades: unknown): string => JSON.stringify({ version: 1, walks: {}, trades });

const parsedTrades = (text: string) => {
  const parsed = parseExchangeState(text);

  if (parsed.kind === 'malformed') {
    throw new Error('walk-state trades-unread test: a state that should parse');
  }

  return parsed;
};

describe('the unread symbols of the stored trades', () => {
  it('reads the stored list as it is', () => {
    const { trades, unreadable } = parsedTrades(
      stateWith({ symbols: {}, unreadSymbols: ['BTCUSDT', 'ETHUSDT'] }),
    );

    expect(trades.unreadSymbols).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(unreadable).toEqual([]);
  });

  it.each([
    ['no trades stored', undefined],
    ['trades with no list', { symbols: {} }],
    ['an empty list', { unreadSymbols: [] }],
  ])('reads none for %s, and names nothing unreadable', (_label, stored) => {
    const { trades, unreadable } = parsedTrades(stateWith(stored));

    expect(trades.unreadSymbols ?? []).toEqual([]);
    expect(unreadable).toEqual([]);
  });

  it.each([
    ['text', 'BTCUSDT'],
    ['a number', 7],
    ['null', null],
    ['a record', { BTCUSDT: true }],
    ['a list holding a number', ['BTCUSDT', 7]],
  ])(
    'reads none for a list stored as %s, names it, and keeps the other parts',
    (_label, stored) => {
      const { trades, unreadable } = parsedTrades(
        stateWith({
          symbols: { ETHUSDT: { fromId: 3 } },
          rotation: 'ETHUSDT',
          unreadSymbols: stored,
        }),
      );

      expect(trades.unreadSymbols ?? []).toEqual([]);
      expect(unreadable).toContain('trades.unreadSymbols');
      expect(trades.symbols).toEqual({ ETHUSDT: { fromId: 3 } });
      expect(trades.rotation).toBe('ETHUSDT');
    },
  );
});

describe('the write of the unread symbols', () => {
  const storedTradesOf = (text: string | undefined): unknown =>
    (JSON.parse(text ?? 'null') as { trades: unknown }).trades;

  it('replaces the stored list and keeps every other part of the trades as stored', () => {
    const text = stateWith({
      symbols: { ETHUSDT: { fromId: 3 } },
      rotation: 'ETHUSDT',
      balanceSnapshot: { ETH: '1/0' },
      unreadSymbols: ['BTCUSDT', 'XRPUSDT'],
    });

    expect(
      storedTradesOf(
        exchangeStatePatched(text, [{ kind: 'tradesUnreadSymbols', value: ['XRPUSDT'] }]),
      ),
    ).toEqual({
      symbols: { ETHUSDT: { fromId: 3 } },
      rotation: 'ETHUSDT',
      balanceSnapshot: { ETH: '1/0' },
      unreadSymbols: ['XRPUSDT'],
    });
  });

  it('writes the list into a state that holds no trades yet', () => {
    expect(
      storedTradesOf(
        exchangeStatePatched(JSON.stringify({ version: 1, walks: {} }), [
          { kind: 'tradesUnreadSymbols', value: ['BTCUSDT'] },
        ]),
      ),
    ).toEqual({ symbols: {}, rotation: '', balanceSnapshot: {}, unreadSymbols: ['BTCUSDT'] });
  });
});

describe('a disconnect and the unread symbols', () => {
  it('drops the trades, and so the list, with the rest of the state', () => {
    const text = stateWith({
      symbols: { ETHUSDT: { fromId: 3 } },
      unreadSymbols: ['BTCUSDT'],
    });
    const reset = JSON.parse(exchangeStateReset(text, 1_000)) as Record<string, unknown>;

    expect(reset).not.toHaveProperty('trades');
    expect(parsedTrades(JSON.stringify(reset)).trades.unreadSymbols ?? []).toEqual([]);
  });
});
