import type { ExchangeTrades } from '@kiko/crypto-sync/exchange/walk-state';

import { unreadSymbolsPatchesOf } from './binance.trade-symbols';

type ReadEnd = 'short-page' | 'budget' | 'stopped' | 'failed';

const candidateOf = (symbol: string) => ({
  symbol,
  baseAsset: symbol.replace('USDT', ''),
  quoteAsset: 'USDT',
});

const THREE = ['AAAUSDT', 'BBBUSDT', 'CCCUSDT'].map(candidateOf);

const storedWith = (
  symbols: ExchangeTrades['symbols'],
  unreadSymbols: string[] = [],
): ExchangeTrades => ({ symbols, rotation: '', balanceSnapshot: {}, unreadSymbols });

const patchOf = (value: string[]) => [{ kind: 'tradesUnreadSymbols', value }];

describe('unreadSymbolsPatchesOf', () => {
  it('lists a candidate with no cursor that the run did not start', () => {
    expect(
      unreadSymbolsPatchesOf({
        candidates: THREE,
        trades: storedWith({}),
        result: { ended: { AAAUSDT: 'short-page' } },
      }),
    ).toEqual(patchOf(['BBBUSDT', 'CCCUSDT']));
  });

  it.each<ReadEnd>(['budget', 'stopped'])(
    'lists a candidate with no cursor whose read ended %s, because it still waits',
    (end) => {
      expect(
        unreadSymbolsPatchesOf({
          candidates: THREE,
          trades: storedWith({}),
          result: { ended: { AAAUSDT: end, BBBUSDT: 'short-page', CCCUSDT: 'short-page' } },
        }),
      ).toEqual(patchOf(['AAAUSDT']));
    },
  );

  it('does not list a candidate whose read ended failed, so a symbol that fails every run cannot hold the list', () => {
    expect(
      unreadSymbolsPatchesOf({
        candidates: THREE,
        trades: storedWith({}),
        result: { ended: { AAAUSDT: 'failed', BBBUSDT: 'short-page', CCCUSDT: 'short-page' } },
      }),
    ).toEqual([]);
  });

  it('lists every symbol of a run that a stop ended before it read any, the one it stopped on too', () => {
    expect(
      unreadSymbolsPatchesOf({
        candidates: THREE,
        trades: storedWith({}),
        result: { ended: {} },
      }),
    ).toEqual(patchOf(['AAAUSDT', 'BBBUSDT', 'CCCUSDT']));
  });

  it.each([
    ['a cursor of 0, an empty read', { fromId: 0 }],
    ['a cursor past some fills', { fromId: 7 }],
  ])('does not list a candidate that holds %s, whatever its read ended', (_label, entry) => {
    expect(
      unreadSymbolsPatchesOf({
        candidates: [candidateOf('AAAUSDT')],
        trades: storedWith({ AAAUSDT: entry }),
        result: { ended: { AAAUSDT: 'budget' } },
      }),
    ).toEqual([]);
  });

  it('lists a candidate whose stored entry holds a null cursor', () => {
    expect(
      unreadSymbolsPatchesOf({
        candidates: [candidateOf('AAAUSDT')],
        trades: storedWith({ AAAUSDT: { fromId: null } }),
        result: { ended: {} },
      }),
    ).toEqual(patchOf(['AAAUSDT']));
  });

  it('replaces the stored list: a symbol read since leaves it, a new one joins it', () => {
    expect(
      unreadSymbolsPatchesOf({
        candidates: THREE,
        trades: storedWith({}, ['AAAUSDT', 'BBBUSDT']),
        result: { ended: { AAAUSDT: 'short-page', BBBUSDT: 'budget' } },
      }),
    ).toEqual(patchOf(['BBBUSDT', 'CCCUSDT']));
  });

  it('clears the stored list once every candidate was read or holds a cursor', () => {
    expect(
      unreadSymbolsPatchesOf({
        candidates: THREE,
        trades: storedWith({ CCCUSDT: { fromId: 2 } }, ['AAAUSDT', 'BBBUSDT']),
        result: { ended: { AAAUSDT: 'short-page', BBBUSDT: 'short-page' } },
      }),
    ).toEqual(patchOf([]));
  });

  it('drops a stored symbol that is no candidate any more', () => {
    expect(
      unreadSymbolsPatchesOf({
        candidates: [candidateOf('AAAUSDT')],
        trades: storedWith({}, ['GONEUSDT']),
        result: { ended: { AAAUSDT: 'short-page' } },
      }),
    ).toEqual(patchOf([]));
  });

  it('writes nothing when nothing is owed and no list is stored', () => {
    expect(
      unreadSymbolsPatchesOf({
        candidates: THREE,
        trades: storedWith({}),
        result: { ended: { AAAUSDT: 'short-page', BBBUSDT: 'short-page', CCCUSDT: 'failed' } },
      }),
    ).toEqual([]);
  });

  it('writes nothing when the list a run owes is the one stored', () => {
    expect(
      unreadSymbolsPatchesOf({
        candidates: THREE,
        trades: storedWith({}, ['BBBUSDT', 'CCCUSDT']),
        result: { ended: { AAAUSDT: 'short-page' } },
      }),
    ).toEqual([]);
  });
});
