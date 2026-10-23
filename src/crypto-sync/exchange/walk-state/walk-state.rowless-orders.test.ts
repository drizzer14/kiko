import { exchangeStatePatched } from './exchange-state-patch';
import { type ParsedExchangeState, parseExchangeState } from './walk-state';

type ReadableState = Extract<ParsedExchangeState, { kind: 'parsed' }>;

const EMPTY_STATE = JSON.stringify({ version: 1, walks: {} });

const readableOf = (text: string | undefined): ReadableState => {
  const parsed = parseExchangeState(text ?? null);

  if (parsed.kind === 'malformed') {
    throw new Error('walk-state rowless-orders test: a state that should parse');
  }

  return parsed;
};

/** A state with one trade symbol, written by the real writer as the builds before this one did. */
const writtenWith = (entry: { fromId: number | null; heldOrderId?: number }): string | undefined =>
  exchangeStatePatched(EMPTY_STATE, [{ kind: 'tradeSymbol', symbol: 'BTCEUR', entry }]);

const storedSymbols = (text: string | undefined): unknown =>
  JSON.parse(text ?? 'null').trades.symbols;

describe('the rowless order ids of a trade symbol', () => {
  it('read as absent from a state a build without them stored, and nothing is named', () => {
    const parsed = readableOf(writtenWith({ fromId: 5, heldOrderId: 9 }));

    expect(parsed.trades.symbols).toStrictEqual({ BTCEUR: { fromId: 5, heldOrderId: 9 } });
    expect(parsed.unreadable).toEqual([]);
  });

  it('read as absent from a symbol with a cursor only', () => {
    const parsed = readableOf(writtenWith({ fromId: 5 }));

    expect(parsed.trades.symbols).toStrictEqual({ BTCEUR: { fromId: 5 } });
    expect(parsed.unreadable).toEqual([]);
  });

  it('are written with the cursor in the same entry and read back as stored', () => {
    const text = exchangeStatePatched(EMPTY_STATE, [
      {
        kind: 'tradeSymbol',
        symbol: 'BTCEUR',
        entry: { fromId: 8, rowlessOrderIds: [3, 5] },
      },
    ]);

    expect(storedSymbols(text)).toEqual({ BTCEUR: { fromId: 8, rowlessOrderIds: [3, 5] } });
    expect(readableOf(text).trades.symbols).toStrictEqual({
      BTCEUR: { fromId: 8, rowlessOrderIds: [3, 5] },
    });
  });

  it('are kept beside a held order', () => {
    const text = exchangeStatePatched(EMPTY_STATE, [
      {
        kind: 'tradeSymbol',
        symbol: 'BTCEUR',
        entry: { fromId: 8, heldOrderId: 4, rowlessOrderIds: [3] },
      },
    ]);

    expect(readableOf(text).trades.symbols).toStrictEqual({
      BTCEUR: { fromId: 8, heldOrderId: 4, rowlessOrderIds: [3] },
    });
  });

  it('are dropped by the next cursor patch that does not name them', () => {
    const first = exchangeStatePatched(EMPTY_STATE, [
      { kind: 'tradeSymbol', symbol: 'BTCEUR', entry: { fromId: 8, rowlessOrderIds: [3] } },
    ]);
    const second = exchangeStatePatched(first ?? EMPTY_STATE, [
      { kind: 'tradeSymbol', symbol: 'BTCEUR', entry: { fromId: 12 } },
    ]);

    expect(storedSymbols(second)).toEqual({ BTCEUR: { fromId: 12 } });
  });

  it.each([
    ['an empty list', []],
    ['null', null],
  ])('read as absent when stored as %s', (_label, stored) => {
    const parsed = readableOf(
      JSON.stringify({
        version: 1,
        walks: {},
        trades: { symbols: { BTCEUR: { fromId: 5, rowlessOrderIds: stored } } },
      }),
    );

    expect(parsed.trades.symbols).toStrictEqual({ BTCEUR: { fromId: 5 } });
    expect(parsed.unreadable).toEqual([]);
  });

  it('read once each when an id is stored twice', () => {
    const parsed = readableOf(
      JSON.stringify({
        version: 1,
        walks: {},
        trades: { symbols: { BTCEUR: { fromId: 5, rowlessOrderIds: [3, 3, 4] } } },
      }),
    );

    expect(parsed.trades.symbols).toStrictEqual({ BTCEUR: { fromId: 5, rowlessOrderIds: [3, 4] } });
  });

  it.each([
    ['text', '3'],
    ['an object', { 3: true }],
    ['a list with a text id', [3, '4']],
    ['a list with a null id', [3, null]],
  ])('drop the symbol that stores them as %s alone, and name it', (_label, bad) => {
    const parsed = readableOf(
      JSON.stringify({
        version: 1,
        walks: {},
        trades: {
          symbols: {
            BTCEUR: { fromId: 5, rowlessOrderIds: bad },
            ETHEUR: { fromId: 7, rowlessOrderIds: [2] },
          },
        },
      }),
    );

    expect(parsed.trades.symbols).toStrictEqual({ ETHEUR: { fromId: 7, rowlessOrderIds: [2] } });
    expect(parsed.unreadable).toEqual(['trades.symbols.BTCEUR']);
  });
});
