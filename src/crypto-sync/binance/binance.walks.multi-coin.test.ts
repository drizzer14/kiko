// Each walk records where its multi-coin reading started, so a later set can backfill the other
// coins before it: both marks ride the cursor write of the run's first committed window.
import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import type { WalkResult } from '@kiko/crypto-sync/exchange/walk';
import { type WalkName, walkStateFake } from '@kiko/test-support/walk-marks';

import { syncBinancePayHistory } from './binance.pay-history';
import { syncBinanceEarnHistory } from './binance.earn-history';
import { syncBinanceTransactions } from './binance.transactions';
import { createBinanceHistoryRun } from './binance.history-budget';
import { syncBinanceTransferHistory } from './binance.transfer-history';

const NOW = Date.UTC(2026, 9, 15);
const ACCOUNT_ID = 'acc-1';
const CURSOR = NOW - 3 * DAY_MS;
const LATEST = NOW - 2 * DAY_MS;

const SPOT = {
  id: 'h-spot',
  accountId: ACCOUNT_ID,
  metadata: { binanceAsset: 'BTC' },
} as HoldingRow;

type StateDeps = ReturnType<ReturnType<typeof walkStateFake>['freshDeps']>;

type Served = { latest?: number; failing?: boolean };

const requestOf = () => ({
  targetAccountId: ACCOUNT_ID,
  run: createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined }),
});

/** What Binance answers to every read: an empty page, or a failure that no window survives. */
const answerOf = <Page>(page: Page, failing: boolean | undefined) =>
  jest.fn(async (): Promise<Page> => {
    if (failing === true) {
      throw new Error('a read failed');
    }

    return page;
  });

const weights = { usedUidWeight1m: undefined, usedIpWeight1m: undefined };

const capitalPage = { rows: [], unreadable: [], untracked: [], ...weights };

const totalPage = { rows: [], unreadable: [], untracked: [], gathered: 0, total: 0, ...weights };

const sharedDeps = (state: StateDeps) => ({
  ...state,
  now: () => NOW,
  fetchImpl: jest.fn(),
  readCredentials: async () => ({ apiKey: 'key', secret: 'secret' }),
  listHoldings: async () => [SPOT],
  ensureHoldings: jest.fn(async () => undefined),
  addTransactions: jest.fn(async (rows: unknown[]) => rows.length),
});

type Walk = {
  name: WalkName;
  run: (state: StateDeps, served: Served) => Promise<WalkResult>;
};

const WALKS: Walk[] = [
  {
    name: 'capital',
    run: (state, { latest, failing }) =>
      syncBinanceTransactions(requestOf(), {
        ...sharedDeps(state),
        storedExternalIds: async () => new Set<string>(),
        latestTransactionTime: async () => latest,
        fetchDepositHistory: answerOf(capitalPage, failing),
        fetchWithdrawHistory: answerOf(capitalPage, failing),
      }),
  },
  {
    name: 'pay',
    run: (state, { failing }) =>
      syncBinancePayHistory(requestOf(), {
        ...sharedDeps(state),
        fetchAccount: async () => ({ balances: [], uid: '1001' }),
        fetchPayHistory: answerOf({ ...capitalPage, gathered: 0 }, failing),
      }),
  },
  {
    name: 'transfer',
    run: (state, { failing }) =>
      syncBinanceTransferHistory(requestOf(), {
        ...sharedDeps(state),
        fetchUniversalTransfers: answerOf(totalPage, failing),
      }),
  },
  {
    name: 'earn',
    run: (state, { failing }) =>
      syncBinanceEarnHistory(requestOf(), {
        ...sharedDeps(state),
        fetchEarnRecords: answerOf(totalPage, failing),
      }),
  },
];

/** The fields each write of the walk named, one list for each call of `patchExchangeState`. */
const fieldsPerWrite = (state: StateDeps, name: WalkName): string[][] =>
  state.patchExchangeState.mock.calls.map(([, patches]) =>
    patches.flatMap((patch) =>
      patch.kind === 'walk' && patch.walkId === name ? [patch.field] : [],
    ),
  );

const namesAMarker = (fields: string[]): boolean =>
  fields.includes('multiCoinSeen') || fields.includes('multiCoinSince');

let warn: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe.each(WALKS)('the $name walk and the multi-coin marks', ({ name, run }) => {
  const worldOf = (marks: Record<string, unknown>) =>
    walkStateFake({ accountId: ACCOUNT_ID, marks: { [name]: marks } });

  it('records the plan cursor at the first multi-coin run', async () => {
    const world = worldOf({ cursor: CURSOR });

    await run(world.freshDeps(), {});

    expect(world.marksOf(name)).toMatchObject({ multiCoinSince: CURSOR, multiCoinSeen: true });
  });

  it('records none when the plan cursor is null', async () => {
    const world = worldOf({});

    await run(world.freshDeps(), {});

    expect(world.marksOf(name)).toMatchObject({ multiCoinSeen: true });
    expect(world.marksOf(name)).not.toHaveProperty('multiCoinSince');
  });

  it('a second run after a null-cursor first run records none', async () => {
    const world = worldOf({});

    await run(world.freshDeps(), {});

    const second = world.freshDeps();

    await run(second, {});

    expect(world.marksOf(name)).toHaveProperty('cursor');
    expect(world.marksOf(name)).not.toHaveProperty('multiCoinSince');
    expect(fieldsPerWrite(second, name).some(namesAMarker)).toBe(false);
  });

  it('writes the marker in the patch of the first committed window', async () => {
    // A malformed point cursor is repaired by a write before any window commits.
    const world = worldOf({ cursor: CURSOR, pointCursor: 'junk' });
    const state = world.freshDeps();

    await run(state, {});

    const writes = fieldsPerWrite(state, name);
    const first = writes.findIndex((fields) => fields.includes('cursor'));

    expect(first).toBeGreaterThan(0);
    expect(writes[first]).toEqual(
      expect.arrayContaining(['cursor', 'multiCoinSeen', 'multiCoinSince']),
    );
    expect(writes.filter((_fields, index) => index !== first).some(namesAMarker)).toBe(false);
  });

  it('writes neither mark in a run that commits no window, and both in the next one', async () => {
    const world = worldOf({ cursor: CURSOR });
    const failed = world.freshDeps();

    await expect(run(failed, { failing: true })).rejects.toThrow('a read failed');

    expect(world.marksOf(name)).not.toHaveProperty('multiCoinSeen');
    expect(world.marksOf(name)).not.toHaveProperty('multiCoinSince');

    await run(world.freshDeps(), {});

    expect(world.marksOf(name)).toMatchObject({ multiCoinSince: CURSOR, multiCoinSeen: true });
  });

  it('writes neither mark again on a walk that was seen', async () => {
    const world = worldOf({ cursor: CURSOR, multiCoinSeen: true, multiCoinSince: 5 });
    const state = world.freshDeps();

    await run(state, {});

    expect(world.marksOf(name)).toMatchObject({ multiCoinSince: 5, multiCoinSeen: true });
    expect(fieldsPerWrite(state, name).some(namesAMarker)).toBe(false);
  });

  it('keeps the earlier range start of a walk whose seen mark was lost', async () => {
    const world = worldOf({
      cursor: CURSOR,
      multiCoinSince: CURSOR - DAY_MS,
      multiCoinSeen: 'yes',
    });

    await run(world.freshDeps(), {});

    expect(world.marksOf(name)).toMatchObject({
      multiCoinSince: CURSOR - DAY_MS,
      multiCoinSeen: true,
    });
  });
});

describe('the capital walk with no stored cursor', () => {
  const capital = WALKS[0];

  it('records the latest row time for capital with no stored cursor', async () => {
    const world = walkStateFake({ accountId: ACCOUNT_ID });

    await capital.run(world.freshDeps(), { latest: LATEST });

    expect(world.marksOf('capital')).toMatchObject({ multiCoinSince: LATEST, multiCoinSeen: true });
  });

  it('records the stored cursor over the latest row time when it has both', async () => {
    const world = walkStateFake({ accountId: ACCOUNT_ID, marks: { capital: { cursor: CURSOR } } });

    await capital.run(world.freshDeps(), { latest: LATEST });

    expect(world.marksOf('capital')).toMatchObject({ multiCoinSince: CURSOR });
  });
});
