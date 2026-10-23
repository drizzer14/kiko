import {
  type ExchangeStatePatch,
  exchangeStatePatched,
  parseExchangeState,
} from '@kiko/crypto-sync/exchange/walk-state';

import {
  type FillServer,
  fillOf,
  fillReadsOf,
  holdingWith,
  listed,
} from './binance.trade-test-fixtures';
import { NOW } from './binance.pay-test-fixtures';
import { NO_WEIGHTS } from './binance.trade-symbols';
import type { BinanceMyTrade } from './binance.history-client';
import { createBinanceHistoryRun } from './binance.history-budget';
import { type BinanceTradeHistoryDeps, syncBinanceTradeHistory } from './binance.trade-history';

/**
 * Orders that came to no row and that the cursor has passed. An XRP fill of 0.00004 is 0.4 of a
 * stored unit (XRP keeps 4 decimals), so one alone comes to nothing and four come to 2 units; a
 * fill of 0.00001 is a tenth of a unit, and five of them come to half a unit, which rounds up.
 */

type StoredRow = Parameters<BinanceTradeHistoryDeps['addTransactions']>[0][number];

const PAGE_LIMIT = 3;
const SYMBOL = 'XRPUSDT';
const ORDER_A = 100;
const ORDER_B = 200;
const ORDER_X = 300;
const ORDER_Y = 150;
const HELD_KEYS = ['XRP', 'USDT', 'BNB'];
const TEXTS = { XRP: '1/0', USDT: '1000/0', BNB: '5/0' };
const XRP_PER_WHOLE_FILL = 10_000;
const USDT_PER_FILL = -100_000_000;
/** The calls a run has already used, enough for a page of fills but not for an order's re-read. */
const CALLS_BEFORE_A_REREAD = 99;

const dustFill = (id: number, orderId: number): BinanceMyTrade =>
  fillOf(id, orderId, { qty: '0.00004', quoteQty: '1' });
const tenthFill = (id: number, orderId: number): BinanceMyTrade =>
  fillOf(id, orderId, { qty: '0.00001', quoteQty: '1' });
const wholeFill = (id: number, orderId: number): BinanceMyTrade =>
  fillOf(id, orderId, { qty: '1', quoteQty: '10' });

let accountSequence = 0;

/** An account over an in-memory exchange of one symbol; each sync reads only the stored state. */
const worldOf = (fills: BinanceMyTrade[]) => {
  accountSequence += 1;

  const accountId = `acc-rowless-${accountSequence}`;
  const server: FillServer = { fills: { [SYMBOL]: fills }, pageLimit: PAGE_LIMIT };
  const reads = fillReadsOf(server);
  const fetchMyTrades = jest.fn(reads.fetchMyTrades);
  const fetchOrderFills = jest.fn(reads.fetchOrderFills);
  const stored = new Map<string, StoredRow>();
  let stateText: string | null = JSON.stringify({ version: 1, walks: {} });

  const keyOf = (orderId: number, coin: string): string =>
    `${accountId}:trade:${SYMBOL}:${orderId}:${coin}`;

  const sync = (calls = 0) => {
    const run = createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined });

    for (let call = 0; call < calls; call += 1) {
      run.budget.record('trades', NO_WEIGHTS);
    }

    return syncBinanceTradeHistory(
      { targetAccountId: accountId, run, spotBalanceTexts: TEXTS },
      {
        now: () => NOW,
        fetchImpl: (async () => ({})) as unknown as typeof fetch,
        pageLimit: server.pageLimit,
        readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
        listHoldings: async () => HELD_KEYS.map(holdingWith),
        ensureHoldings: async () => undefined,
        readExchangeState: async () => stateText,
        patchExchangeState: async (_accountId: string, patches: readonly ExchangeStatePatch[]) => {
          stateText = exchangeStatePatched(stateText, patches) ?? stateText;
        },
        fetchExchangeSymbols: async () => ({
          symbols: [listed(SYMBOL, 'XRP', 'USDT')],
          unreadable: 0,
          usedApiWeight1m: undefined,
        }),
        fetchMyTrades,
        fetchOrderFills,
        importedOrderPrefixes: async (prefixes) =>
          new Set(
            prefixes.filter((prefix) => [...stored.keys()].some((key) => key.startsWith(prefix))),
          ),
        addTransactions: async (rows) => {
          const created = rows.filter(({ externalId }) => !stored.has(externalId)).length;

          for (const row of rows) {
            stored.set(row.externalId, row);
          }

          return created;
        },
      },
    );
  };

  return {
    server,
    fetchOrderFills,
    sync,
    add: (...added: BinanceMyTrade[]): void => {
      server.fills[SYMBOL]?.push(...added);
    },
    entry: () => {
      const parsed = parseExchangeState(stateText);

      return parsed.kind === 'parsed' ? parsed.trades.symbols[SYMBOL] : undefined;
    },
    storedText: () => stateText ?? '',
    totalsOf: (orderId: number) => ({
      xrp: stored.get(keyOf(orderId, 'XRP'))?.amountMinorUnits,
      usdt: stored.get(keyOf(orderId, 'USDT'))?.amountMinorUnits,
    }),
    orderFillStarts: (orderId: number) =>
      fetchOrderFills.mock.calls.filter((call) => call[3] === orderId).map((call) => call[4]),
  };
};

describe('an order that came to no row and that the cursor passed', () => {
  it('is stored with the cursor in the same entry, so a restart reads it back', async () => {
    const world = worldOf([wholeFill(1, ORDER_B), dustFill(2, ORDER_A), wholeFill(3, ORDER_X)]);

    await world.sync();

    expect(world.entry()).toEqual({ fromId: 4, rowlessOrderIds: [ORDER_A] });
    expect(JSON.parse(world.storedText()).trades.symbols[SYMBOL]).toEqual({
      fromId: 4,
      rowlessOrderIds: [ORDER_A],
    });
    expect(world.totalsOf(ORDER_A)).toEqual({ xrp: undefined, usdt: undefined });
    expect(world.totalsOf(ORDER_B).xrp).toBe(XRP_PER_WHOLE_FILL);
  });

  it('is written with every fill when a later fill of it arrives in a later run', async () => {
    const world = worldOf([wholeFill(1, ORDER_B), dustFill(2, ORDER_A), wholeFill(3, ORDER_X)]);

    await world.sync();
    world.add(dustFill(4, ORDER_A), dustFill(5, ORDER_A), dustFill(6, ORDER_A));
    await world.sync();

    expect(world.totalsOf(ORDER_A)).toEqual({ xrp: 2, usdt: 4 * USDT_PER_FILL });
    expect(world.orderFillStarts(ORDER_A).filter((fromId) => fromId === 0)).toEqual([0]);
    expect(world.entry()).toEqual({ fromId: 7 });
  });

  it('is written with every fill when a later fill comes on a later page of the same run', async () => {
    const world = worldOf([
      wholeFill(1, ORDER_B),
      dustFill(2, ORDER_A),
      wholeFill(3, ORDER_X),
      dustFill(4, ORDER_A),
      dustFill(5, ORDER_A),
      dustFill(6, ORDER_A),
    ]);

    await world.sync();

    expect(world.totalsOf(ORDER_A)).toEqual({ xrp: 2, usdt: 4 * USDT_PER_FILL });
    expect(world.orderFillStarts(ORDER_A)).toEqual([0, 6]);
    expect(world.entry()).toEqual({ fromId: 7 });
  });

  it('is re-read once in a run however many later fills of it come', async () => {
    const world = worldOf([wholeFill(1, ORDER_B), dustFill(2, ORDER_A), wholeFill(3, ORDER_X)]);

    await world.sync();
    world.add(dustFill(4, ORDER_A), wholeFill(5, ORDER_X), dustFill(6, ORDER_A));
    await world.sync();

    expect(world.orderFillStarts(ORDER_A).filter((fromId) => fromId === 0)).toEqual([0]);
    expect(world.totalsOf(ORDER_A)).toEqual({ xrp: 1, usdt: 3 * USDT_PER_FILL });
  });

  it('is dropped from the set when its order writes a row', async () => {
    const world = worldOf([wholeFill(1, ORDER_B), dustFill(2, ORDER_A), wholeFill(3, ORDER_X)]);

    await world.sync();
    expect(world.entry()?.rowlessOrderIds).toEqual([ORDER_A]);

    world.add(dustFill(4, ORDER_A), dustFill(5, ORDER_A), dustFill(6, ORDER_A));
    await world.sync();

    expect(world.entry()).toEqual({ fromId: 7 });
    expect(world.storedText()).not.toContain('rowlessOrderIds');
  });

  it('stays in the set, with the cursor still moving on, while its order comes to no row', async () => {
    const world = worldOf([wholeFill(1, ORDER_B), tenthFill(2, ORDER_A), wholeFill(3, ORDER_X)]);

    await world.sync();
    world.add(tenthFill(4, ORDER_A));
    await world.sync();

    expect(world.totalsOf(ORDER_A)).toEqual({ xrp: undefined, usdt: undefined });
    expect(world.entry()).toEqual({ fromId: 5, rowlessOrderIds: [ORDER_A] });

    world.add(tenthFill(5, ORDER_A), tenthFill(6, ORDER_A), tenthFill(7, ORDER_A));
    await world.sync();

    expect(world.totalsOf(ORDER_A)).toEqual({ xrp: 1, usdt: 5 * USDT_PER_FILL });
    expect(world.entry()).toEqual({ fromId: 8 });
  });

  it('is listed in ascending order with the other orders passed', async () => {
    const world = worldOf([
      tenthFill(1, ORDER_X),
      tenthFill(2, ORDER_A),
      wholeFill(3, ORDER_B),
      tenthFill(4, ORDER_Y),
      wholeFill(5, ORDER_B),
    ]);

    world.server.pageLimit = 5;
    await world.sync();

    expect(world.entry()).toEqual({
      fromId: 6,
      rowlessOrderIds: [ORDER_A, ORDER_Y, ORDER_X],
    });
  });

  it('is kept through a held order and the release of it', async () => {
    const world = worldOf([wholeFill(1, ORDER_B), dustFill(2, ORDER_A), wholeFill(3, ORDER_X)]);

    await world.sync();
    world.add(wholeFill(4, ORDER_B));
    await world.sync(CALLS_BEFORE_A_REREAD);

    expect(world.entry()).toEqual({ fromId: 4, heldOrderId: ORDER_B, rowlessOrderIds: [ORDER_A] });

    await world.sync();

    expect(world.totalsOf(ORDER_B).xrp).toBe(2 * XRP_PER_WHOLE_FILL);
    expect(world.entry()).toEqual({ fromId: 5, rowlessOrderIds: [ORDER_A] });
  });
});

describe('an order that writes a row', () => {
  it('never enters the set, whether it is one fill or a cut order', async () => {
    const world = worldOf([
      wholeFill(1, ORDER_B),
      wholeFill(2, ORDER_A),
      wholeFill(3, ORDER_A),
      wholeFill(4, ORDER_X),
    ]);

    await world.sync();

    expect(world.entry()).toEqual({ fromId: 5 });
    expect(world.storedText()).not.toContain('rowlessOrderIds');
  });
});

describe('the last order of a page that came to no row', () => {
  it('is held by the cursor and not listed, until another order follows it', async () => {
    const world = worldOf([wholeFill(1, ORDER_B), dustFill(2, ORDER_A)]);

    await world.sync();

    expect(world.entry()).toEqual({ fromId: 2 });

    world.add(wholeFill(3, ORDER_X));
    await world.sync();

    expect(world.entry()).toEqual({ fromId: 4, rowlessOrderIds: [ORDER_A] });
  });

  it('is written with its later fill, and not read again, while the cursor holds it', async () => {
    const world = worldOf([wholeFill(1, ORDER_B), dustFill(2, ORDER_A)]);

    await world.sync();
    world.add(dustFill(3, ORDER_A));
    await world.sync();

    expect(world.totalsOf(ORDER_A)).toEqual({ xrp: 1, usdt: 2 * USDT_PER_FILL });
    expect(world.fetchOrderFills).not.toHaveBeenCalled();
  });

  it('is held with a held re-read, and both are settled by the runs that follow', async () => {
    const world = worldOf([wholeFill(1, ORDER_B)]);

    await world.sync();
    world.add(dustFill(2, ORDER_A), wholeFill(3, ORDER_B));
    await world.sync(CALLS_BEFORE_A_REREAD);

    expect(world.fetchOrderFills).not.toHaveBeenCalled();
    expect(world.entry()).toEqual({ fromId: 2, heldOrderId: ORDER_B });
    expect(world.totalsOf(ORDER_B).xrp).toBe(XRP_PER_WHOLE_FILL);

    await world.sync();

    expect(world.totalsOf(ORDER_B).xrp).toBe(2 * XRP_PER_WHOLE_FILL);
    expect(world.entry()).toEqual({ fromId: 4, rowlessOrderIds: [ORDER_A] });

    world.add(dustFill(4, ORDER_A));
    await world.sync();

    expect(world.totalsOf(ORDER_A)).toEqual({ xrp: 1, usdt: 2 * USDT_PER_FILL });
    expect(world.entry()).toEqual({ fromId: 5 });
  });

  it('is not held at its first fill once a re-read gave it, which would move the cursor back', async () => {
    const world = worldOf([wholeFill(1, ORDER_B), tenthFill(2, ORDER_A), wholeFill(3, ORDER_X)]);

    await world.sync();
    world.add(tenthFill(4, ORDER_A));
    await world.sync();

    expect(world.entry()?.fromId).toBe(5);
  });
});
