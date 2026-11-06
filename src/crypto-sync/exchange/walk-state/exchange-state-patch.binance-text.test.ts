import {
  type ExchangeStatePatch,
  exchangeStatePatched,
  exchangeStateReset,
} from './exchange-state-patch';
import { parseExchangeState } from './walk-state';

const FLOOR = 1_000;

const BINANCE_WALKS = [
  'capital',
  'pay',
  'transfer',
  'earn',
  'convert',
  'p2p',
  'fiatOrders',
  'fiatPayments',
] as const;

const point = {
  start: 1_000,
  end: 1_002,
  kind: 'point' as const,
  series: 'SPOT',
  since: 1_700_000_000_000,
};

const hints = {
  forward: [{ start: 100, end: 200 }],
  pending: [],
  rescan: [],
  point: [{ start: 1_000, end: 1_002, resume: { from: 1_000, returned: [], stuck: [point] } }],
};

// The text a Binance account stored before the log walk existed: every Binance walk, the
// multi-coin marks, owed points, hints, trades, both coin lists, the stamp and the refused records.
const storedBinance = {
  version: 1,
  walks: {
    capital: { cursor: 5_000, rescan: 4_000, pending: [{ start: 10, end: 20 }] },
    pay: { cursor: 5_001, pending: [point], pointCursor: 7, rangeCursor: 9, spanHints: hints },
    transfer: { cursor: 5_002, multiCoinSince: 3_000, multiCoinSeen: true },
    earn: { cursor: 5_003, pending: [], backfillCursor: 2_000, backfillTurn: true },
    convert: { cursor: 5_004, pending: [point] },
    p2p: { cursor: 5_005, readFailedAt: 5_100 },
    fiatOrders: { cursor: 5_006, behindRun: true, rescanTurn: true, rescanStuck: [point] },
    fiatPayments: { cursor: 5_007, pending: [] },
  },
  trades: {
    symbols: { BTCEUR: { fromId: 9, heldOrderId: 2, rowlessOrderIds: [3, 5] } },
    rotation: 'BTCEUR',
    balanceSnapshot: { BTC: '1/0' },
    unreadSymbols: ['ETHEUR'],
  },
  untrackedCoins: { balance: ['PEPE'], history: ['PEPE', 'XYZ'] },
  oversizedCoins: { balance: ['SHIB'], history: [], balanceByWallet: { spot: ['SHIB'] } },
  balanceSyncedAt: 1_700_000_000_000,
  notImported: ['p2p-sale:1:2'],
};

const storedText = JSON.stringify(storedBinance);

const withBinanceCursor = (walkId: (typeof BINANCE_WALKS)[number], cursor: number): string =>
  JSON.stringify({
    ...storedBinance,
    walks: { ...storedBinance.walks, [walkId]: { ...storedBinance.walks[walkId], cursor } },
  });

const rewrites: ExchangeStatePatch[] = [
  { kind: 'walk', walkId: 'capital', field: 'cursor', value: 5_000 },
  { kind: 'walk', walkId: 'pay', field: 'pending', value: [point] },
  { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['PEPE', 'XYZ'] },
  { kind: 'notImported', entries: ['p2p-sale:1:2'] },
  { kind: 'tradesRotation', value: 'BTCEUR' },
  { kind: 'balanceSyncedAt', value: 1_700_000_000_000 },
];

describe('a Binance state text under the log walk and the convert marks', () => {
  it('writes the same text back for every write that changes nothing', () => {
    expect(exchangeStatePatched(storedText, [])).toBe(storedText);
    expect(exchangeStatePatched(storedText, rewrites)).toBe(storedText);
  });

  it.each(BINANCE_WALKS)(
    'writes a new %s cursor as that one value changed, with no other key added',
    (walkId) => {
      expect(
        exchangeStatePatched(storedText, [{ kind: 'walk', walkId, field: 'cursor', value: 9_999 }]),
      ).toBe(withBinanceCursor(walkId, 9_999));
    },
  );

  it('writes a walk the state never held with its own marks only', () => {
    const text = JSON.stringify({ version: 1, walks: {} });

    expect(
      exchangeStatePatched(text, [
        { kind: 'walk', walkId: 'capital', field: 'cursor', value: 7 },
        { kind: 'walk', walkId: 'capital', field: 'pending', value: [] },
      ]),
    ).toBe(JSON.stringify({ version: 1, walks: { capital: { cursor: 7, pending: [] } } }));
  });

  it('writes the same text after a disconnect as before the log walk, with no log entry', () => {
    expect(exchangeStateReset(storedText, FLOOR)).toBe(
      JSON.stringify({
        version: 1,
        walks: {
          capital: { cursor: FLOOR, rescan: FLOOR, pending: [] },
          pay: { cursor: FLOOR, pending: [] },
          transfer: { cursor: FLOOR, multiCoinSeen: true },
          earn: { cursor: FLOOR, pending: [] },
          convert: { cursor: FLOOR, pending: [] },
          p2p: { cursor: FLOOR },
          fiatOrders: { cursor: FLOOR },
          fiatPayments: { cursor: FLOOR, pending: [] },
        },
      }),
    );
  });

  it('reads back with no convert mark on any walk, no log kind and no dense span', () => {
    const parsed = parseExchangeState(storedText);

    if (parsed.kind === 'malformed') {
      throw new Error('binance text test: a state that should parse');
    }

    BINANCE_WALKS.forEach((walkId) => {
      expect(parsed.walks[walkId]).not.toHaveProperty('pageIndex');
      expect(parsed.walks[walkId]).not.toHaveProperty('passOwed');
    });
    expect(parsed.walks.log).toEqual(
      expect.objectContaining({ cursor: null, pending: [], rescan: null }),
    );
    expect(parsed.logKinds).toEqual([]);
    expect(parsed.denseSpans).toEqual({});
    expect(parsed.unreadable).toEqual([]);
  });
});
