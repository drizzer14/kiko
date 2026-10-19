import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import type { UntrackedTotalRow } from '@kiko/crypto-sync/exchange/paging';
import { coinListPatchesOf, walkMarkWritesOf, walkStateFake } from '@kiko/test-support/walk-marks';

import type {
  BinanceUniversalTransfer,
  TotalPage,
  UniversalTransferType,
} from './binance.history-client';
import {
  type BinanceHistoryRow,
  type BinanceTransferHistoryDeps,
  syncBinanceTransferHistory,
} from './binance.transfer-history';
import { NOW } from './binance.pay-test-fixtures';
import { createBinanceHistoryRun } from './binance.history-budget';

const ACCOUNT_ID = 'acc-1';

const spotHolding = { id: 'h-spot', metadata: { binanceAsset: 'BTC' } } as unknown as HoldingRow;

const transferOf = (over: Partial<BinanceUniversalTransfer> = {}): BinanceUniversalTransfer => ({
  asset: 'BTC',
  amount: '0.001',
  type: 'MAIN_UMFUTURE',
  status: 'CONFIRMED',
  tranId: 't-1',
  timestamp: NOW - DAY_MS,
  ...over,
});

/** A transfer of a coin the walk does not track, as the client reports it (settled by default). */
const untrackedOf = (over: Partial<UntrackedTotalRow> = {}): UntrackedTotalRow => ({
  ticker: 'PEPE',
  status: 'CONFIRMED',
  time: NOW - DAY_MS,
  ...over,
});

type Served = {
  rows?: BinanceUniversalTransfer[];
  untracked?: UntrackedTotalRow[];
  unreadable?: { time: number | undefined }[];
};

/** A row with no usable time sits in every range, as Binance returns it whatever the window. */
const inRange = (time: number | string | undefined, start: number, end: number): boolean =>
  typeof time !== 'number' || (start <= time && time <= end);

/** What Binance answers for `type` in a range: the served rows whose time lies in it. */
const serverOf = (served: Partial<Record<UniversalTransferType, Served>>) =>
  jest.fn(
    async (
      _apiKey: string,
      _secret: string,
      query: { type: UniversalTransferType; startTime: number; endTime: number },
    ): Promise<TotalPage<BinanceUniversalTransfer>> => {
      const { startTime, endTime } = query;
      const { rows = [], untracked = [], unreadable = [] } = served[query.type] ?? {};
      const page = {
        rows: rows.filter((row) => inRange(row.timestamp, startTime, endTime)),
        untracked: untracked.filter((row) => inRange(row.time, startTime, endTime)),
        unreadable: unreadable.filter((row) => inRange(row.time, startTime, endTime)),
      };
      const gathered = page.rows.length + page.untracked.length + page.unreadable.length;

      return {
        ...page,
        gathered,
        total: gathered,
        usedUidWeight1m: undefined,
        usedIpWeight1m: undefined,
      };
    },
  );

/** The holdings a walk creates are listed by the next read, as a real store lists them. */
const creatingStore = () => {
  let stored = [spotHolding];
  const ensureHoldings = jest.fn(async (holdings: { metadataKey: string }[]) => {
    stored = [
      ...stored,
      ...holdings.map(
        ({ metadataKey }) =>
          ({
            id: `h-${metadataKey}`,
            metadata: { binanceAsset: metadataKey },
          }) as unknown as HoldingRow,
      ),
    ];
  });

  return { ensureHoldings, listHoldings: async () => stored };
};

const walk = async (served: Partial<Record<UniversalTransferType, Served>>) => {
  const added: BinanceHistoryRow[] = [];
  const store = creatingStore();
  const deps: BinanceTransferHistoryDeps = {
    now: () => NOW,
    fetchImpl: (async () => ({})) as unknown as typeof fetch,
    readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
    ...store,
    fetchUniversalTransfers: serverOf(served),
    addTransactions: jest.fn(async (rows: BinanceHistoryRow[]) => {
      added.push(...rows);

      return rows.length;
    }),
    ...walkStateFake({ accountId: ACCOUNT_ID, marks: { transfer: { cursor: NOW - 3 * DAY_MS } } })
      .deps,
  };
  const run = createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined });
  const result = await syncBinanceTransferHistory({ targetAccountId: ACCOUNT_ID, run }, deps);

  return { result, added, deps, store };
};

const untrackedPatchesOf = (deps: BinanceTransferHistoryDeps) =>
  coinListPatchesOf(deps).filter((patch) => patch.coins === 'untrackedCoins');

let warn: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('a transfer of a tracked coin', () => {
  it('imports on the coin wallet holdings, in the coin scale, keyed by the coin', async () => {
    const { added, result, store } = await walk({
      MAIN_FUNDING: { rows: [transferOf({ asset: 'USDT', amount: '1.5', type: 'MAIN_FUNDING' })] },
    });

    expect(result).toEqual({ imported: 2, complete: true });
    expect(added.map((row) => [row.externalId, row.amountMinorUnits, row.holdingId])).toEqual([
      ['acc-1:xfer:MAIN_FUNDING:t-1:USDT', -150_000_000, 'h-USDT'],
      ['acc-1:xfer:MAIN_FUNDING:t-1:USDT:funding', 150_000_000, 'h-USDT:funding'],
    ]);
    expect(store.ensureHoldings).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ metadataKey: 'USDT' }),
        expect.objectContaining({ metadataKey: 'USDT:funding' }),
      ]),
    );
  });

  it('keeps the BTC keys byte for byte', async () => {
    const { added } = await walk({
      MAIN_UMFUTURE: { rows: [transferOf({ type: 'MAIN_UMFUTURE' })] },
      FUNDING_UMFUTURE: { rows: [transferOf({ type: 'FUNDING_UMFUTURE', tranId: 't-2' })] },
    });

    expect(added.map((row) => row.externalId)).toEqual([
      'acc-1:xfer:MAIN_UMFUTURE:t-1:BTC',
      'acc-1:xfer:FUNDING_UMFUTURE:t-2:BTC:funding',
    ]);
  });

  it('keys two coins of one tranId apart', async () => {
    const { added } = await walk({
      MAIN_UMFUTURE: {
        rows: [transferOf(), transferOf({ asset: 'ETH' }), transferOf({ asset: 'USDT' })],
      },
    });

    expect(new Set(added.map((row) => row.externalId)).size).toBe(3);
  });

  it('pairs the legs of each coin of one tranId under a pair id of that coin alone', async () => {
    const { added } = await walk({
      MAIN_FUNDING: {
        rows: [
          transferOf({ type: 'MAIN_FUNDING' }),
          transferOf({ type: 'MAIN_FUNDING', asset: 'ETH' }),
        ],
      },
    });

    expect(added.map((row) => [row.externalId, row.exchangePairId])).toEqual([
      ['acc-1:xfer:MAIN_FUNDING:t-1:BTC', 'acc-1:xfer:MAIN_FUNDING:t-1'],
      ['acc-1:xfer:MAIN_FUNDING:t-1:BTC:funding', 'acc-1:xfer:MAIN_FUNDING:t-1'],
      ['acc-1:xfer:MAIN_FUNDING:t-1:ETH', 'acc-1:xfer:MAIN_FUNDING:t-1:ETH'],
      ['acc-1:xfer:MAIN_FUNDING:t-1:ETH:funding', 'acc-1:xfer:MAIN_FUNDING:t-1:ETH'],
    ]);
  });
});

describe('a transfer of an untracked coin', () => {
  it('is counted, imports no row and adds its ticker to the not-tracked history list', async () => {
    const { added, result, deps } = await walk({
      MAIN_UMFUTURE: { rows: [transferOf()], untracked: [untrackedOf()] },
    });

    expect(added.map((row) => row.externalId)).toEqual(['acc-1:xfer:MAIN_UMFUTURE:t-1:BTC']);
    expect(result).toEqual({ imported: 1, complete: true });
    expect(untrackedPatchesOf(deps)).toEqual([
      { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['PEPE'] },
    ]);
  });

  it('writes the list once for the window, before its cursor', async () => {
    const { deps } = await walk({
      MAIN_UMFUTURE: { untracked: [untrackedOf(), untrackedOf()] },
      FUNDING_MARGIN: { untracked: [untrackedOf({ ticker: 'DOGGO' })] },
    });

    const order = (deps.patchExchangeState as jest.Mock).mock.calls.flatMap(([, patches]) =>
      patches.map((patch: { kind: string; field?: string }) =>
        patch.kind === 'walk' ? `walk:${patch.field}` : patch.kind,
      ),
    );

    expect(untrackedPatchesOf(deps)).toEqual([
      { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['PEPE', 'DOGGO'] },
    ]);
    expect(order.filter((entry: string) => entry === 'coinList')).toHaveLength(1);
    expect(order.indexOf('coinList')).toBeLessThan(order.indexOf('walk:cursor'));
  });

  it('moves the cursor past a window that holds only untracked transfers, and imports nothing', async () => {
    const { added, deps, result } = await walk({ MAIN_UMFUTURE: { untracked: [untrackedOf()] } });

    expect(added).toEqual([]);
    expect(result.complete).toBe(true);
    expect(walkMarkWritesOf(deps, 'transfer', 'cursor')).toEqual([NOW]);
  });

  it.each([
    ['FAILED', 'FAILED'],
    ['PENDING', 'PENDING'],
    ['no status', undefined],
  ])('does not list the coin of a transfer that is not settled (%s)', async (_label, status) => {
    const { deps, result } = await walk({
      MAIN_UMFUTURE: { untracked: [untrackedOf({ status })] },
    });

    expect(coinListPatchesOf(deps)).toEqual([]);
    expect(result.complete).toBe(true);
  });

  it('lists a settled transfer whose time is no usable time: it has no point to return', async () => {
    const { deps, result } = await walk({
      MAIN_UMFUTURE: { untracked: [untrackedOf({ time: undefined })] },
    });

    expect(result.complete).toBe(true);
    expect(untrackedPatchesOf(deps)[0].tickers).toEqual(['PEPE']);
  });

  it('writes no list for a window of tracked coins', async () => {
    const { deps } = await walk({ MAIN_UMFUTURE: { rows: [transferOf({ asset: 'ETH' })] } });

    expect(coinListPatchesOf(deps)).toEqual([]);
  });
});

describe('a transfer row the client could not read', () => {
  it('owes its point and holds back no other row of the window', async () => {
    const { added, result } = await walk({
      MAIN_UMFUTURE: { rows: [transferOf()], unreadable: [{ time: NOW - 2 * DAY_MS }] },
    });

    expect(added).toHaveLength(1);
    expect(result.complete).toBe(false);
  });
});
