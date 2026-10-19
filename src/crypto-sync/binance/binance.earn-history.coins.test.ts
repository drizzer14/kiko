import { coinListPatchesOf, walkMarkWritesOf } from '@kiko/test-support/walk-marks';

import {
  agoMs,
  entryOf,
  flexibleRedemptionOf,
  flexibleRewardOf,
  flexibleSubscriptionOf,
  lockedRewardOf,
  lockedSubscriptionOf,
  untrackedEntryOf,
  walkOnce,
  worldOf,
} from './binance.earn-test-fixtures';
import { NOW } from './binance.pay-test-fixtures';
import type { EarnRecordKind } from './binance.history-client';

const caughtUp = { cursor: agoMs(5) };

const untrackedPatchesOf = (deps: Parameters<typeof coinListPatchesOf>[0]) =>
  coinListPatchesOf(deps).filter((patch) => patch.coins === 'untrackedCoins');

let warn: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('an Earn record of a tracked coin', () => {
  it('writes a flexible subscription in USDT on the USDT holdings, in the coin scale, keyed by the coin', async () => {
    const world = worldOf(caughtUp);

    await walkOnce({
      world,
      entries: [
        entryOf(
          'flexibleSubscription',
          flexibleSubscriptionOf({ asset: 'USDT', amount: '12.5', amtFromSpot: '12.5' }),
        ),
      ],
    });

    expect(world.added.map((row) => [row.externalId, row.amountMinorUnits, row.holdingId])).toEqual(
      [
        ['acc-1:earn:sub:flexible:p-1:USDT', -1_250_000_000, 'created-USDT'],
        ['acc-1:earn:sub:flexible:p-1:USDT:earn', 1_250_000_000, 'created-USDT:earn'],
      ],
    );
  });

  it('keeps the BTC keys of a subscription and a redemption byte for byte', async () => {
    const world = worldOf(caughtUp);

    await walkOnce({
      world,
      entries: [
        entryOf('flexibleSubscription', flexibleSubscriptionOf()),
        entryOf('flexibleRedemption', flexibleRedemptionOf()),
      ],
    });

    expect(world.added.map((row) => row.externalId).sort()).toEqual([
      'acc-1:earn:redeem:flexible:r-1:BTC',
      'acc-1:earn:redeem:flexible:r-1:BTC:earn',
      'acc-1:earn:sub:flexible:p-1:BTC',
      'acc-1:earn:sub:flexible:p-1:BTC:earn',
    ]);
  });

  it('writes a redemption in USDT from the USDT Earn holding to the USDT Spot holding', async () => {
    const world = worldOf(caughtUp);

    await walkOnce({
      world,
      entries: [
        entryOf(
          'flexibleRedemption',
          flexibleRedemptionOf({ asset: 'USDT', amount: '3', time: agoMs(2) }),
        ),
      ],
    });

    expect(world.added.map((row) => [row.externalId, row.amountMinorUnits, row.holdingId])).toEqual(
      [
        ['acc-1:earn:redeem:flexible:r-1:USDT:earn', -300_000_000, 'created-USDT:earn'],
        ['acc-1:earn:redeem:flexible:r-1:USDT', 300_000_000, 'created-USDT'],
      ],
    );
  });

  it('keys the subscriptions of two coins that share a purchase id apart', async () => {
    const world = worldOf(caughtUp);

    await walkOnce({
      world,
      entries: [
        entryOf('flexibleSubscription', flexibleSubscriptionOf()),
        entryOf(
          'flexibleSubscription',
          flexibleSubscriptionOf({ asset: 'ETH', amtFromSpot: '0.001' }),
        ),
      ],
    });

    expect(new Set(world.added.map((row) => row.externalId)).size).toBe(4);
  });

  it('numbers BTC and USDT rewards of one project, type and time each in its own coin', async () => {
    const world = worldOf(caughtUp);
    const time = agoMs(2);

    await walkOnce({
      world,
      entries: [
        entryOf('flexibleRewards', flexibleRewardOf({ time, rewards: '0.0001' })),
        entryOf('flexibleRewards', flexibleRewardOf({ time, rewards: '0.5', asset: 'USDT' })),
        entryOf('flexibleRewards', flexibleRewardOf({ time, rewards: '0.0002' })),
        entryOf('flexibleRewards', flexibleRewardOf({ time, rewards: '0.1', asset: 'USDT' })),
      ],
    });

    const base = `acc-1:earn:reward:flexible:BTC001:REALTIME:${time}`;

    expect(world.added.map((row) => [row.externalId, row.amountMinorUnits, row.holdingId])).toEqual(
      [
        [`${base}:0`, 10_000, 'h-earn'],
        [`${base}:1`, 20_000, 'h-earn'],
        [`${base}:0:USDT`, 10_000_000, 'created-USDT:earn'],
        [`${base}:1:USDT`, 50_000_000, 'created-USDT:earn'],
      ],
    );
  });

  it('writes a locked reward in USDT on the USDT Spot holding', async () => {
    const world = worldOf(caughtUp);

    await walkOnce({
      world,
      entries: [entryOf('lockedRewards', lockedRewardOf({ asset: 'USDT', amount: '1.5' }))],
    });

    expect(world.added.map((row) => [row.amountMinorUnits, row.holdingId])).toEqual([
      [150_000_000, 'created-USDT'],
    ]);
  });

  it('writes a locked subscription in USDT on the USDT holdings', async () => {
    const world = worldOf(caughtUp);

    await walkOnce({
      world,
      entries: [
        entryOf(
          'lockedSubscription',
          lockedSubscriptionOf({ asset: 'USDT', amount: '1', amtFromSpot: '1' }),
        ),
      ],
    });

    expect(world.added.map((row) => row.holdingId)).toEqual(['created-USDT', 'created-USDT:earn']);
  });
});

describe('an Earn record of an untracked coin', () => {
  it('is counted, imports no row and adds its ticker to the not-tracked history list', async () => {
    const world = worldOf(caughtUp);

    const { deps, result } = await walkOnce({
      world,
      entries: [
        entryOf('flexibleRewards', flexibleRewardOf({ time: agoMs(3) })),
        untrackedEntryOf('flexibleRewards', { time: agoMs(2) }),
      ],
    });

    expect(world.added).toHaveLength(1);
    expect(result.complete).toBe(true);
    expect(untrackedPatchesOf(deps)).toEqual([
      { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['PEPE'] },
    ]);
  });

  it.each<EarnRecordKind>([
    'flexibleSubscription',
    'flexibleRedemption',
    'flexibleRewards',
    'lockedSubscription',
    'lockedRedemption',
    'lockedRewards',
  ])('lists the coin of a settled %s record', async (kind) => {
    const { deps, result, requests } = await walkOnce({
      world: worldOf(caughtUp),
      entries: [untrackedEntryOf(kind, { ticker: 'DOGGO' })],
    });

    expect(requests.length).toBeGreaterThan(0);
    expect(result.complete).toBe(true);
    expect(untrackedPatchesOf(deps)).toEqual([
      { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['DOGGO'] },
    ]);
  });

  it.each([
    ['flexibleSubscription', 'FAILED'],
    ['flexibleSubscription', 'PENDING'],
    ['lockedSubscription', 'PENDING'],
    ['flexibleRedemption', 'FAILED'],
    ['flexibleRedemption', 'SUCCESS'],
    ['lockedRedemption', 'PENDING'],
  ] as const)('does not list the coin of a %s record that is %s', async (kind, status) => {
    const world = worldOf(caughtUp);

    const { deps, result } = await walkOnce({
      world,
      entries: [untrackedEntryOf(kind, { status })],
    });

    expect(coinListPatchesOf(deps)).toEqual([]);
    expect(world.added).toEqual([]);
    expect(result.complete).toBe(true);
  });

  it('writes the list once for the window, before its cursor', async () => {
    const world = worldOf(caughtUp);

    const { deps } = await walkOnce({
      world,
      entries: [
        untrackedEntryOf('flexibleRewards'),
        untrackedEntryOf('lockedRewards', { ticker: 'DOGGO' }),
        untrackedEntryOf('flexibleRewards'),
      ],
    });

    expect(untrackedPatchesOf(deps)).toEqual([
      { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['PEPE', 'DOGGO'] },
    ]);
    expect(world.events.indexOf('earn:untrackedCoins')).toBeLessThan(
      world.events.indexOf('earn:cursor'),
    );
  });

  it('moves the cursor past a window that holds only untracked records, and imports nothing', async () => {
    const world = worldOf(caughtUp);

    const { deps } = await walkOnce({ world, entries: [untrackedEntryOf('flexibleRewards')] });

    expect(world.added).toEqual([]);
    expect(walkMarkWritesOf(deps, 'earn', 'cursor')).toEqual([NOW]);
  });

  it('writes no list for a window of tracked coins', async () => {
    const world = worldOf(caughtUp);

    const { deps } = await walkOnce({
      world,
      entries: [entryOf('flexibleRewards', flexibleRewardOf({ asset: 'ETH' }))],
    });

    expect(coinListPatchesOf(deps)).toEqual([]);
  });
});

describe('an Earn row the client could not read', () => {
  it('owes its point beside a reward of an untracked coin, which still lists its coin', async () => {
    const world = worldOf(caughtUp);
    const time = agoMs(10);

    const { result, deps } = await walkOnce({
      world,
      entries: [
        { kind: 'flexibleRewards', time, unreadable: true },
        untrackedEntryOf('flexibleRewards', { time: time + 1 }),
      ],
    });

    expect(result.complete).toBe(false);
    expect(untrackedPatchesOf(deps)[0].tickers).toEqual(['PEPE']);
  });
});
