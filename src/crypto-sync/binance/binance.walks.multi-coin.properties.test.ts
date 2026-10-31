import { DAY_MS } from '@kiko/dates';
import maybe, { foldMap } from 'fnts/maybe';
import { sweep } from '@kiko/test-support/property-sweep';
import { type Currency, currencyScale } from '@kiko/currency/currency';
import { coinListPatchesOf, walkStateFake, type WalkName } from '@kiko/test-support/walk-marks';

import { syncBinancePayHistory } from './binance.pay-history';
import { isTrackedBinanceAsset } from './binance.tracked-coin';
import { syncBinanceEarnHistory } from './binance.earn-history';
import { syncBinanceTransactions } from './binance.transactions';
import { createBinanceHistoryRun } from './binance.history-budget';
import { syncBinanceTransferHistory } from './binance.transfer-history';

/**
 * The four history walks driven over one account that holds records of tracked coins, untracked
 * coins and records too large to store, as they come from Binance's own endpoints (the real
 * client over a served `fetch`). Ids are drawn from small pools that every coin shares, so two
 * coins meet on one on-chain hash, order id, transfer id or purchase id often. Each record has
 * its own amount, so a row is told apart by the holding it lands on and its signed amount alone.
 */

const HOUR_MS = 3_600_000;
const SECOND_MS = 1_000;
const NOW = Date.UTC(2026, 9, 10);
const ACCOUNT_ID = 'acc-1';
const OWN_UID = 1001;
const OTHER_UID = 2002;
const ROUNDS = 5;
const SEEDS = sweep(Array.from({ length: 40 }, (_unused, position) => 3 + position * 8));
const CLOCK_GAPS = [0, HOUR_MS, DAY_MS];
const HISTORY_DAYS = 24;
const FORWARD_START_MS = NOW - 6 * DAY_MS;
const TOO_LARGE_AMOUNT = '99999999999999999999';
const UNTRACKED_AMOUNT = '1';
const TRACKED_COINS = ['BTC', 'USDT', 'ETH'];
const UNTRACKED_COINS = ['PEPE', 'DOGGO'];
const ID_POOL = ['pool-0', 'pool-1', 'pool-2'];
const REWARD_PROJECTS = ['project-1', 'project-2'];
const TRANSACTION_HASH_FIELD = 'txId';
const PAGE = 100;
const CAPITAL_PAGE = 1_000;

type Walk = Extract<WalkName, 'capital' | 'pay' | 'transfer' | 'earn'>;

const WALKS: Walk[] = ['capital', 'pay', 'transfer', 'earn'];

type Product = 'flexible' | 'locked';

type EarnKind = `${Product}${'Subscription' | 'Redemption' | 'Rewards'}`;

const EARN_PATHS: Record<EarnKind, string> = {
  flexibleSubscription: '/flexible/history/subscriptionRecord',
  flexibleRedemption: '/flexible/history/redemptionRecord',
  flexibleRewards: '/flexible/history/rewardsRecord',
  lockedSubscription: '/locked/history/subscriptionRecord',
  lockedRedemption: '/locked/history/redemptionRecord',
  lockedRewards: '/locked/history/rewardsRecord',
};

const EARN_KINDS = Object.keys(EARN_PATHS) as EarnKind[];

/** One record as Binance serves it, with the millisecond a read of a window filters it by. */
type Served = { time: number; body: Record<string, unknown>; type?: string };

type RowExpectation = [holdingKey: string, signedUnits: number];

/** The rows a record must give, and the ticker it must list: untracked or oversized. */
type Expected = {
  walk: Walk;
  rows: RowExpectation[];
  untracked?: string;
  oversized?: string;
};

type World = {
  deposits: Served[];
  withdrawals: Served[];
  pay: Served[];
  transfers: Served[];
  earn: Record<EarnKind, Served[]>;
  expected: Expected[];
};

const emptyWorld = (): World => ({
  deposits: [],
  withdrawals: [],
  pay: [],
  transfers: [],
  earn: {
    flexibleSubscription: [],
    flexibleRedemption: [],
    flexibleRewards: [],
    lockedSubscription: [],
    lockedRedemption: [],
    lockedRewards: [],
  },
  expected: [],
});

/** A seeded generator (Lehmer), so a failing run replays. */
const seededRandom = (seed: number): (() => number) => {
  let state = seed;

  return () => {
    state = (state * 48_271) % 2_147_483_647;

    return state / 2_147_483_647;
  };
};

const floorToSecond = (time: number): number => Math.floor(time / SECOND_MS) * SECOND_MS;

const isTracked = (coin: string): coin is Currency => isTrackedBinanceAsset(coin);

const holdingKeyOf = (coin: string, wallet: 'spot' | 'funding' | 'earn'): string =>
  wallet === 'spot' ? coin : `${coin}:${wallet}`;

type Recordable = {
  coin: string;
  units: number;
  time: number;
  settled: boolean;
  oversized: boolean;
};

/** An untracked coin's amount is never read, so it is not made to fit that coin's scale. */
const amountOf = ({ coin, units, oversized }: Recordable): string => {
  if (oversized) {
    return TOO_LARGE_AMOUNT;
  }

  return isTracked(coin)
    ? `0.${String(units).padStart(currencyScale[coin], '0')}`
    : UNTRACKED_AMOUNT;
};

/** A tracked coin lists nothing, an untracked one is listed once settled, a record too large to
 * store lists its coin as oversized. */
const listingOf = ({ coin, settled, oversized }: Recordable) => ({
  ...(isTracked(coin) || !settled ? {} : { untracked: coin }),
  ...(oversized && settled ? { oversized: coin } : {}),
});

/** Rows only for a settled record of a tracked coin that can be stored. */
const rowsIf = ({ coin, settled, oversized }: Recordable, rows: RowExpectation[]) =>
  isTracked(coin) && settled && !oversized ? rows : [];

type CapitalInput = Recordable & {
  id: string;
  hash: string;
  wallet: 0 | 1 | undefined;
};

const capitalExpectationOf = (input: CapitalInput, sign: 1 | -1): Expected => ({
  walk: 'capital',
  rows: rowsIf(input, [
    [holdingKeyOf(input.coin, input.wallet === 1 ? 'funding' : 'spot'), sign * input.units],
  ]),
  ...listingOf(input),
});

const depositOf = (input: CapitalInput) => ({
  served: {
    time: input.time,
    body: {
      id: input.id,
      amount: amountOf(input),
      coin: input.coin,
      [TRANSACTION_HASH_FIELD]: input.hash,
      insertTime: input.time,
      status: input.settled ? 1 : 0,
      ...foldMap(maybe(input.wallet), (walletType) => ({ walletType })),
    },
  },
  expected: capitalExpectationOf(input, 1),
});

const withdrawalOf = (input: CapitalInput) => ({
  served: {
    time: input.time,
    body: {
      id: input.id,
      amount: amountOf(input),
      transactionFee: '0',
      coin: input.coin,
      [TRANSACTION_HASH_FIELD]: input.hash,
      applyTime: new Date(input.time).toISOString().slice(0, 19).replace('T', ' '),
      status: input.settled ? 6 : 4,
      ...foldMap(maybe(input.wallet), (walletType) => ({ walletType })),
    },
  },
  expected: capitalExpectationOf(input, -1),
});

// Binance paid a receive into Funding until this day and into Spot from it, whatever wallet the
// payer's side names; a send lands on the wallet its cost names.
const RECEIPTS_TO_SPOT_FROM_MS = Date.UTC(2026, 8, 29);

const payWalletOf = (input: { send: boolean; time: number; walletType: 1 | 2 }) => {
  if (input.send) {
    return input.walletType === 1 ? 'funding' : 'spot';
  }

  return input.time < RECEIPTS_TO_SPOT_FROM_MS ? 'funding' : 'spot';
};

const payOrderOf = (
  input: Recordable & {
    orderType: string;
    transactionId: string;
    send: boolean;
    walletType: 1 | 2;
  },
) => {
  const amount = amountOf(input);
  const own = { name: 'Me', binanceId: String(OWN_UID) };
  const other = { name: 'Ann', binanceId: String(OTHER_UID) };

  return {
    served: {
      time: input.time,
      body: {
        orderType: input.orderType,
        transactionId: input.transactionId,
        transactionTime: input.time,
        amount: input.send ? `-${amount}` : amount,
        currency: input.coin,
        walletType: input.walletType,
        fundsDetail: [
          {
            currency: input.coin,
            amount,
            walletAssetCost: { [String(input.walletType)]: amount },
          },
        ],
        payerInfo: input.send ? own : other,
        receiverInfo: input.send ? other : own,
      },
    },
    expected: {
      walk: 'pay',
      rows: rowsIf(input, [
        [holdingKeyOf(input.coin, payWalletOf(input)), input.send ? -input.units : input.units],
      ]),
      ...listingOf(input),
    } satisfies Expected,
  };
};

type TransferType = 'MAIN_FUNDING' | 'FUNDING_MAIN' | 'MAIN_MARGIN';

const transferRowsOf = (type: TransferType, coin: string, units: number): RowExpectation[] => {
  const spot = holdingKeyOf(coin, 'spot');
  const funding = holdingKeyOf(coin, 'funding');

  if (type === 'MAIN_FUNDING') {
    return [
      [spot, -units],
      [funding, units],
    ];
  }

  if (type === 'FUNDING_MAIN') {
    return [
      [spot, units],
      [funding, -units],
    ];
  }

  return [[spot, -units]];
};

const transferOf = (input: Recordable & { type: TransferType; tranId: string; status: string }) => {
  const settled = { ...input, settled: input.status === 'CONFIRMED' };

  return {
    served: {
      time: input.time,
      type: input.type,
      body: {
        asset: input.coin,
        amount: amountOf(input),
        type: input.type,
        status: input.status,
        tranId: input.tranId,
        timestamp: input.time,
      },
    },
    expected: {
      walk: 'transfer',
      rows: rowsIf(settled, transferRowsOf(input.type, input.coin, input.units)),
      ...listingOf(settled),
    } satisfies Expected,
  };
};

const subscriptionOf = (
  input: Recordable & { product: Product; purchaseId: string; status: string },
) => {
  const amount = amountOf(input);
  const settled = { ...input, settled: input.status === 'SUCCESS' };

  return {
    served: {
      time: input.time,
      body: {
        amount,
        asset: input.coin,
        time: input.time,
        purchaseId: input.purchaseId,
        ...(input.product === 'locked' ? { positionId: 'position-1' } : { productId: 'product-1' }),
        type: 'NORMAL',
        amtFromSpot: amount,
        amtFromFunding: '0',
        status: input.status,
      },
    },
    expected: {
      walk: 'earn',
      rows: rowsIf(settled, [
        [holdingKeyOf(input.coin, 'spot'), -input.units],
        [holdingKeyOf(input.coin, 'earn'), input.units],
      ]),
      ...listingOf(settled),
    } satisfies Expected,
  };
};

const redemptionBodyOf = (
  input: Recordable & { product: Product; redeemId: string; status: string },
) => {
  const amount = amountOf(input);

  if (input.product === 'flexible') {
    return {
      amount,
      asset: input.coin,
      time: input.time,
      projectId: 'product-1',
      redeemId: input.redeemId,
      destAccount: 'SPOT',
      status: input.status,
    };
  }

  return {
    positionId: 'position-1',
    redeemId: input.redeemId,
    time: input.time,
    asset: input.coin,
    amount,
    originalAmount: amount,
    type: 'MATURE',
    status: input.status,
    isComplete: true,
  };
};

const redemptionOf = (
  input: Recordable & { product: Product; redeemId: string; status: string },
) => {
  const settled = { ...input, settled: input.status === 'PAID' };

  return {
    served: { time: input.time, body: redemptionBodyOf(input) },
    expected: {
      walk: 'earn',
      rows: rowsIf(settled, [
        [holdingKeyOf(input.coin, 'earn'), -input.units],
        [holdingKeyOf(input.coin, 'spot'), input.units],
      ]),
      ...listingOf(settled),
    } satisfies Expected,
  };
};

const rewardBodyOf = (input: Recordable & { product: Product; owner: string }) => {
  const amount = amountOf(input);

  if (input.product === 'flexible') {
    return {
      asset: input.coin,
      rewards: amount,
      projectId: input.owner,
      type: 'REALTIME',
      time: input.time,
    };
  }

  return {
    positionId: input.owner,
    time: input.time,
    asset: input.coin,
    amount,
    type: 'Booster',
  };
};

const rewardOf = (input: Recordable & { product: Product; owner: string }) => ({
  served: { time: input.time, body: rewardBodyOf(input) },
  expected: {
    walk: 'earn',
    rows: rowsIf(input, [
      [holdingKeyOf(input.coin, input.product === 'flexible' ? 'earn' : 'spot'), input.units],
    ]),
    ...listingOf(input),
  } satisfies Expected,
});

// A reward has no id, so its group is numbered together and trusted or not as one: a member too
// large to store holds back the others of its group.
const holdBackOversizedGroups = (groups: Expected[][]): void => {
  for (const group of groups) {
    if (group.some((item) => item.oversized !== undefined)) {
      for (const item of group) {
        item.rows = [];
      }
    }
  }
};

/**
 * A random account: each id comes from a small pool every coin shares, but no coin repeats an id
 * in one kind (a repeat would be the same record, which has one key).
 */
const randomWorld = (seed: number): World => {
  const random = seededRandom(seed);
  const world = emptyWorld();
  const used = new Set<string>();
  const rewardGroups = new Map<string, Expected[]>();
  let nextUnits = 1_000;

  const chance = (probability: number) => random() < probability;
  const pick = <Item>(items: readonly Item[]): Item => items[Math.floor(random() * items.length)];
  const coinOf = () => pick([...TRACKED_COINS, ...UNTRACKED_COINS]);
  const timeOf = () => floorToSecond(NOW - HOUR_MS - Math.floor(random() * HISTORY_DAYS * DAY_MS));
  const rewardTimeOf = () => NOW - (2 + Math.floor(random() * 3) * 7) * DAY_MS;

  /** Whether `id` is new for this coin in this kind; a repeat is left to the caller to skip. */
  const isFresh = (kind: string, coin: string, id: string): boolean => {
    const key = `${kind}:${coin}:${id}`;
    const fresh = !used.has(key);

    used.add(key);

    return fresh;
  };

  // The capital and Pay forward passes leave a span uncommitted on any stop, so a record too large
  // to store sits behind the forward start there, where it holds back no other row.
  const recordable = (coin: string, settled = chance(0.85), stopsForward = false): Recordable => {
    nextUnits += 1;

    const time = timeOf();
    const mayStop = !stopsForward || time < FORWARD_START_MS;

    return {
      coin,
      units: nextUnits,
      time,
      settled,
      oversized: mayStop && settled && isTracked(coin) && chance(0.1),
    };
  };

  const walletOf = () => pick<0 | 1 | undefined>([undefined, 0, 1]);

  const capitalInputOf = (kind: 'deposit' | 'withdraw', count: number): CapitalInput => {
    const coin = coinOf();
    const shared = pick(ID_POOL);
    const hashOnly = isTracked(coin) && chance(0.4) && isFresh(kind, coin, shared);

    return {
      ...recordable(coin, undefined, true),
      id: hashOnly ? '' : `${kind}-${count}`,
      hash: hashOnly ? shared : `hash-${kind}-${count}`,
      wallet: walletOf(),
    };
  };

  for (let count = 0; count < 9; count += 1) {
    const deposit = depositOf(capitalInputOf('deposit', count));
    const withdrawal = withdrawalOf(capitalInputOf('withdraw', count));

    world.deposits.push(deposit.served);
    world.withdrawals.push(withdrawal.served);
    world.expected.push(deposit.expected, withdrawal.expected);
  }

  for (let count = 0; count < 9; count += 1) {
    const coin = coinOf();
    const orderType = pick(['C2C', 'PAY']);
    const transactionId = pick(ID_POOL);

    if (isFresh(`pay:${orderType}`, coin, transactionId)) {
      const { served, expected } = payOrderOf({
        ...recordable(coin, true, true),
        orderType,
        transactionId,
        send: chance(0.5),
        walletType: pick<1 | 2>([1, 2]),
      });

      world.pay.push(served);
      world.expected.push(expected);
    }
  }

  for (let count = 0; count < 12; count += 1) {
    const coin = coinOf();
    const type = pick<TransferType>(['MAIN_FUNDING', 'FUNDING_MAIN', 'MAIN_MARGIN']);
    const tranId = pick(ID_POOL);

    if (isFresh(`transfer:${type}`, coin, tranId)) {
      const { served, expected } = transferOf({
        ...recordable(coin, true),
        type,
        tranId,
        status: pick(['CONFIRMED', 'CONFIRMED', 'CONFIRMED', 'PENDING', 'FAILED']),
      });

      world.transfers.push(served);
      world.expected.push(expected);
    }
  }

  const earnRecordOf = () => {
    const coin = coinOf();
    const product = pick<Product>(['flexible', 'locked']);
    const flow = pick(['subscription', 'redemption', 'reward', 'reward']);
    const id = pick(ID_POOL);

    if (flow === 'reward') {
      const owner = pick(REWARD_PROJECTS);
      const time = rewardTimeOf();
      const reward = rewardOf({ ...recordable(coin, true), time, product, owner });
      const group = `${product}:${owner}:${time}:${coin}`;

      rewardGroups.set(group, [...(rewardGroups.get(group) ?? []), reward.expected]);

      return { kind: `${product}Rewards` as const, ...reward };
    }

    if (!isFresh(`${flow}:${product}`, coin, id)) {
      return undefined;
    }

    if (flow === 'subscription') {
      return {
        kind: `${product}Subscription` as const,
        ...subscriptionOf({
          ...recordable(coin, true),
          product,
          purchaseId: id,
          status: pick(['SUCCESS', 'SUCCESS', 'SUCCESS', 'PENDING', 'FAILED']),
        }),
      };
    }

    return {
      kind: `${product}Redemption` as const,
      ...redemptionOf({
        ...recordable(coin, true),
        product,
        redeemId: id,
        status: pick(['PAID', 'PAID', 'PAID', 'PENDING', 'FAILED']),
      }),
    };
  };

  for (let count = 0; count < 24; count += 1) {
    const record = earnRecordOf();

    if (record !== undefined) {
      world.earn[record.kind].push(record.served);
      world.expected.push(record.expected);
    }
  }

  holdBackOversizedGroups([...rewardGroups.values()]);

  return world;
};

/** The records a read of the window returns, each end compared at `precision` milliseconds. */
const inWindow = (entries: Served[], query: URLSearchParams, precision: number): Served[] => {
  const floored = (time: number) => Math.floor(time / precision) * precision;
  const start = floored(Number(query.get('startTime')));
  const end = floored(Number(query.get('endTime')));

  return entries.filter((entry) => start <= entry.time && entry.time <= end);
};

/** What each endpoint answers to a read: the records whose time lies in the window asked for. */
const bodyOf = (world: World, url: URL): unknown => {
  const { searchParams: query, pathname } = url;
  const offset = Number(query.get('offset') ?? 0);
  const current = Number(query.get('current') ?? 1);
  const bodiesOf = (entries: Served[]) => entries.map((entry) => entry.body);
  const totalOf = (entries: Served[], precision: number) => {
    const held = inWindow(entries, query, precision);

    return {
      rows: bodiesOf(held.slice((current - 1) * PAGE, current * PAGE)),
      total: held.length,
    };
  };

  if (pathname === '/api/v3/account') {
    return { balances: [], uid: OWN_UID };
  }

  if (pathname.endsWith('/capital/deposit/hisrec')) {
    return bodiesOf(inWindow(world.deposits, query, 1).slice(offset, offset + CAPITAL_PAGE));
  }

  if (pathname.endsWith('/capital/withdraw/history')) {
    return bodiesOf(
      inWindow(world.withdrawals, query, SECOND_MS).slice(offset, offset + CAPITAL_PAGE),
    );
  }

  if (pathname.endsWith('/pay/transactions')) {
    return { code: '000000', data: bodiesOf(inWindow(world.pay, query, 1)) };
  }

  if (pathname.endsWith('/asset/transfer')) {
    return totalOf(
      world.transfers.filter((entry) => entry.type === query.get('type')),
      1,
    );
  }

  const kind = EARN_KINDS.find((candidate) => pathname.endsWith(EARN_PATHS[candidate]));

  if (kind === undefined) {
    throw new Error(`no endpoint is served at ${pathname}`);
  }

  return totalOf(world.earn[kind], SECOND_MS);
};

const servedFetch = (world: World): typeof fetch =>
  (async (input: string) => {
    const body = bodyOf(world, new URL(input));

    return { ok: true, status: 200, headers: new Headers(), json: async () => body };
  }) as unknown as typeof fetch;

type StoredRow = { holdingKey: string; units: number; walk: Walk; pairId: string | undefined };

type ByWalk = Record<Walk, Set<string>>;

type Outcome = {
  stored: Map<string, StoredRow>;
  /** The keys a row was written under twice with different content, or by two walks. */
  collisions: string[];
  untracked: ByWalk;
  oversized: ByWalk;
};

const noTickers = (): ByWalk => ({
  capital: new Set(),
  pay: new Set(),
  transfer: new Set(),
  earn: new Set(),
});

const holdingKeyOfId = (holdingId: string): string =>
  holdingId === 'h-spot' ? 'BTC' : holdingId.slice('h-'.length);

type WrittenRow = {
  externalId: string;
  holdingId: string;
  amountMinorUnits: number;
  exchangePairId?: string;
};

/** Runs the four walks `ROUNDS` times, a `gap` apart, against one served account and one store. */
const walkedOver = async (world: World, gap: number): Promise<Outcome> => {
  const state = walkStateFake({
    accountId: ACCOUNT_ID,
    marks: Object.fromEntries(WALKS.map((walk) => [walk, { cursor: NOW - 5 * DAY_MS }])),
  });
  const created: { id: string; metadata: { binanceAsset: string } }[] = [];
  const outcome: Outcome = {
    stored: new Map(),
    collisions: [],
    untracked: noTickers(),
    oversized: noTickers(),
  };

  const listed = async () => [...(await state.listHoldings()), ...created];

  const write = (walk: Walk) => async (rows: WrittenRow[]) => {
    for (const row of rows) {
      const next = {
        holdingKey: holdingKeyOfId(row.holdingId),
        units: row.amountMinorUnits,
        walk,
        pairId: row.exchangePairId,
      };
      const previous = outcome.stored.get(row.externalId);

      if (
        previous !== undefined &&
        (previous.holdingKey !== next.holdingKey ||
          previous.units !== next.units ||
          previous.walk !== next.walk)
      ) {
        outcome.collisions.push(row.externalId);
      }

      outcome.stored.set(row.externalId, next);
    }

    return rows.length;
  };

  const ensureHoldings = async (holdings: { metadataKey: string }[]) => {
    for (const { metadataKey } of holdings) {
      const known = (await listed()).some(
        (holding) =>
          (holding.metadata as { binanceAsset?: string } | undefined)?.binanceAsset === metadataKey,
      );

      if (!known) {
        created.push({ id: `h-${metadataKey}`, metadata: { binanceAsset: metadataKey } });
      }
    }
  };

  for (let round = 0; round < ROUNDS; round += 1) {
    const now = () => NOW + round * gap;
    const run = createBinanceHistoryRun({ now, sleep: async () => undefined });

    for (const walk of WALKS) {
      const stateDeps = state.freshDeps();
      const deps = {
        ...stateDeps,
        now,
        fetchImpl: servedFetch(world),
        readCredentials: async () => ({ apiKey: 'key', secret: 'secret' }),
        listHoldings: listed as never,
        ensureHoldings,
        addTransactions: write(walk),
        storedExternalIds: async (keys: string[]) =>
          new Set(keys.filter((key) => outcome.stored.has(key))),
        latestTransactionTime: async () => undefined,
      };
      const request = { targetAccountId: ACCOUNT_ID, run };

      await {
        capital: () => syncBinanceTransactions(request, deps),
        pay: () => syncBinancePayHistory(request, deps),
        transfer: () => syncBinanceTransferHistory(request, deps),
        earn: () => syncBinanceEarnHistory(request, deps),
      }[walk]();

      for (const patch of coinListPatchesOf(stateDeps)) {
        const lists = patch.coins === 'untrackedCoins' ? outcome.untracked : outcome.oversized;

        for (const ticker of patch.tickers) {
          lists[walk].add(ticker);
        }
      }
    }
  }

  return outcome;
};

const sorted = (values: Iterable<string>): string[] => [...values].sort();

const rowCodesOf = (rows: RowExpectation[]): string[] =>
  sorted(rows.map(([holdingKey, units]) => `${holdingKey}|${units}`));

const tickersOf = (expected: Expected[], field: 'untracked' | 'oversized'): string[] =>
  sorted(
    new Set(expected.flatMap((item) => foldMap(maybe(item[field]), (ticker) => [ticker]) ?? [])),
  );

/** The coins each stored pair id holds: deleting one leg deletes the pair, so it is one coin's. */
const coinsByPairId = (outcome: Outcome): Map<string, string[]> => {
  const coins = new Map<string, Set<string>>();

  for (const { pairId, holdingKey } of outcome.stored.values()) {
    if (pairId !== undefined) {
      coins.set(pairId, (coins.get(pairId) ?? new Set()).add(holdingKey.split(':')[0]));
    }
  }

  return new Map([...coins].map(([pairId, held]) => [pairId, sorted(held)]));
};

const expectMatches = (world: World, outcome: Outcome) => {
  expect(outcome.collisions).toEqual([]);

  for (const [pairId, coins] of coinsByPairId(outcome)) {
    expect({ pairId, coins: coins.length }).toEqual({ pairId, coins: 1 });
  }

  for (const walk of WALKS) {
    const expected = world.expected.filter((item) => item.walk === walk);
    const stored = [...outcome.stored.values()]
      .filter((row) => row.walk === walk)
      .map((row): RowExpectation => [row.holdingKey, row.units]);

    expect({ walk, rows: rowCodesOf(stored) }).toEqual({
      walk,
      rows: rowCodesOf(expected.flatMap((item) => item.rows)),
    });
    expect({ walk, untracked: sorted(outcome.untracked[walk]) }).toEqual({
      walk,
      untracked: tickersOf(expected, 'untracked'),
    });
    expect({ walk, oversized: sorted(outcome.oversized[walk]) }).toEqual({
      walk,
      oversized: tickersOf(expected, 'oversized'),
    });
  }
};

let warn: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

/** The groups of records that share one id and are of more than one coin. */
const sharedAcrossCoins = (entries: Served[], idOf: (body: Served['body']) => string) => {
  const coinsById = new Map<string, Set<unknown>>();

  for (const { body } of entries) {
    const coins = coinsById.get(idOf(body)) ?? new Set();

    coins.add(body.coin ?? body.asset ?? body.currency);
    coinsById.set(idOf(body), coins);
  }

  return [...coinsById.values()].filter((coins) => coins.size > 1);
};

describe('the generated accounts', () => {
  const worlds = SEEDS.map(randomWorld);
  const all = <Item>(pick: (world: World) => Item[]) => worlds.flatMap(pick);

  it('use tracked and untracked coins as their names say', () => {
    expect(TRACKED_COINS.every(isTracked)).toBe(true);
    expect(UNTRACKED_COINS.some(isTracked)).toBe(false);
  });

  it('put two coins on one hash, order id, transfer id and purchase id', () => {
    const hashless = all((world) => world.deposits).filter(({ body }) => body.id === '');

    expect(sharedAcrossCoins(hashless, (body) => String(body[TRANSACTION_HASH_FIELD]))).not.toEqual(
      [],
    );
    expect(
      sharedAcrossCoins(
        all((world) => world.pay),
        (body) => `${body.orderType}:${body.transactionId}`,
      ),
    ).not.toEqual([]);
    expect(
      sharedAcrossCoins(
        all((world) => world.transfers),
        (body) => `${body.type}:${body.tranId}`,
      ),
    ).not.toEqual([]);
    expect(
      sharedAcrossCoins(
        all((world) => world.earn.flexibleSubscription),
        (body) => String(body.purchaseId),
      ),
    ).not.toEqual([]);
  });

  it('hold records of every walk that list an untracked coin or an oversized one', () => {
    for (const walk of WALKS) {
      const expected = all((world) => world.expected).filter((item) => item.walk === walk);

      expect(expected.some((item) => item.untracked !== undefined)).toBe(true);
      expect(expected.some((item) => item.oversized !== undefined)).toBe(true);
    }
  });
});

describe.each(CLOCK_GAPS)('mixed-coin accounts walked %d ms apart', (gap) => {
  it.each(SEEDS)(
    'imports every settled tracked row once and lists every settled untracked ticker (seed %d)',
    async (seed) => {
      const world = randomWorld(seed);
      expectMatches(world, await walkedOver(world, gap));
    },
  );

  it('keeps the keys of two coins that share a hash, a transfer id or a purchase id apart', async () => {
    const world = emptyWorld();
    const coins = ['ETH', 'USDT', 'BTC'];

    coins.forEach((coin, position) => {
      const shared = {
        coin,
        units: 1_000 + position,
        time: floorToSecond(NOW - 2 * DAY_MS),
        settled: true,
        oversized: false,
      };
      const deposit = depositOf({ ...shared, id: '', hash: 'shared-hash', wallet: 0 });
      const transfer = transferOf({
        ...shared,
        units: shared.units + 10,
        type: 'MAIN_FUNDING',
        tranId: 'shared-transfer',
        status: 'CONFIRMED',
      });
      const subscription = subscriptionOf({
        ...shared,
        units: shared.units + 20,
        product: 'flexible',
        purchaseId: 'shared-purchase',
        status: 'SUCCESS',
      });

      world.deposits.push(deposit.served);
      world.transfers.push(transfer.served);
      world.earn.flexibleSubscription.push(subscription.served);
      world.expected.push(deposit.expected, transfer.expected, subscription.expected);
    });

    const outcome = await walkedOver(world, gap);

    expectMatches(world, outcome);
    expect(outcome.stored.size).toBe(coins.length * 5);
    expect(coinsByPairId(outcome).size).toBe(coins.length * 2);
  });
});
