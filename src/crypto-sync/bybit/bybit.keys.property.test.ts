import { DAY_MS } from '@kiko/dates';
import { CURATED_COIN_CODES } from '@kiko/currency/coins';
import { sweep } from '@kiko/test-support/property-sweep';
import { walkStateFake } from '@kiko/test-support/walk-marks';
import { type Random, seededRandom } from '@kiko/test-support/seeded-random';

import { NOW } from './bybit.client-test-fixtures';
import { BYBIT_FIAT_CODES } from './bybit.tracked-coin';
import { depositRow } from './bybit.history-test-fixtures';
import { transferAt, transferWalkOf } from './bybit.transfer-test-fixtures';
import { ACCOUNT_ID, capitalWalkOf, served } from './bybit.capital-test-fixtures';
import { holdingKeyOf, partsOfHoldingKey, type BybitWallet } from './bybit.holding-keys';

// Every key carries its coin, BTC too, and two coins that share the id of a move share no row and
// no pair. The pair of a trade or a convert names its two coins, and its test joins this file in
// the set that adds those walks.
const SEEDS = sweep(Array.from({ length: 20 }, (_unused, position) => 17 + position * 11));

// Small consecutive seeds of the Lehmer generator draw the same first value, so each seed is
// spread before it is used.
const SEED_SPREAD = 1_000_003;

const COINS = [...CURATED_COIN_CODES, ...BYBIT_FIAT_CODES];
const WALLETS: readonly BybitWallet[] = ['unified', 'fund'];
const KEYS_PER_SEED = 60;

const CURSOR = NOW - 3 * DAY_MS;
const AT = NOW - 2 * DAY_MS;
const SECOND_MS = 1_000;
// Four ids for 12 moves, so two coins share an id in every world.
const MOVE_IDS = ['alpha', 'beta', 'gamma', 'delta'];
const MOVES_PER_SEED = 12;
const MOVE_COINS = ['BTC', 'ETH', 'USDT', 'EUR'];

const pick = <Entry>(random: Random, entries: readonly Entry[]): Entry =>
  entries[Math.floor(random() * entries.length)] as Entry;

const worldOf = (seed: number) => {
  const random = seededRandom(seed * SEED_SPREAD);

  return Array.from({ length: KEYS_PER_SEED }, () => ({
    code: pick(random, COINS),
    wallet: pick(random, WALLETS),
  }));
};

type Move = { id: string; coin: string; fromFund: boolean };

/** One move for each id and coin, since a page holds one row for each of them. */
const movesOf = (seed: number): Move[] => {
  const random = seededRandom(seed * SEED_SPREAD);
  const drawn = Array.from({ length: MOVES_PER_SEED }, () => ({
    id: pick(random, MOVE_IDS),
    coin: pick(random, MOVE_COINS),
    fromFund: random() < 0.5,
  }));

  return [...new Map(drawn.map((move) => [`${move.id}:${move.coin}`, move])).values()];
};

const idsSharedByCoins = (moves: Move[]): string[] =>
  MOVE_IDS.filter((id) => moves.filter((move) => move.id === id).length > 1);

const transferWalkOfMoves = async (moves: Move[]) => {
  const walk = transferWalkOf({
    state: walkStateFake({ accountId: ACCOUNT_ID, marks: { transfer: { cursor: CURSOR } } }),
  });

  walk.world.transfer = moves.map((move, index) =>
    transferAt(AT + index * SECOND_MS, {
      transferId: move.id,
      coin: move.coin,
      amount: '1',
      fromAccountType: move.fromFund ? 'FUND' : 'UNIFIED',
      toAccountType: move.fromFund ? 'UNIFIED' : 'FUND',
    }),
  );

  await walk.run();

  return walk;
};

const depositWalkOfMoves = async (moves: Move[]) => {
  const walk = capitalWalkOf({
    state: walkStateFake({ accountId: ACCOUNT_ID, marks: { capital: { cursor: CURSOR } } }),
  });

  walk.world.deposit = moves.map((move, index) =>
    served(
      AT + index * SECOND_MS,
      depositRow({
        id: move.id,
        coin: move.coin,
        amount: '1',
        successAt: String(AT + index * SECOND_MS),
      }),
    ),
  );

  await walk.run();

  return walk;
};

describe('Bybit holding keys, over random coins and wallets', () => {
  it.each(SEEDS)(
    'every key carries its coin, and a key without it names nothing: seed %i',
    (seed) => {
      for (const { code, wallet } of worldOf(seed)) {
        const key = holdingKeyOf(code, wallet);

        expect(key.split(':')[0]).toBe(code);
        expect(partsOfHoldingKey(key)).toEqual({ code, wallet });
        expect(partsOfHoldingKey(key.slice(code.length))).toBeUndefined();
        expect(partsOfHoldingKey(wallet)).toBeUndefined();
      }
    },
  );

  it('draws worlds that differ from seed to seed and reach every wallet and every coin', () => {
    const worlds = SEEDS.map((seed) => worldOf(seed));
    const drawn = worlds.flat();

    expect(new Set(worlds.map((world) => JSON.stringify(world))).size).toBe(SEEDS.length);
    expect(new Set(drawn.map(({ wallet }) => wallet))).toEqual(new Set(WALLETS));
    expect(new Set(drawn.map(({ code }) => code))).toEqual(new Set(COINS));
  });

  it('keeps BTC, the coin of the Binance legacy keys, in every wallet key', () => {
    for (const wallet of WALLETS) {
      expect(holdingKeyOf('BTC', wallet)).toBe(`BTC:${wallet}`);
      expect(partsOfHoldingKey(`BTC:${wallet}`)).toEqual({ code: 'BTC', wallet });
    }
    expect(partsOfHoldingKey('BTC')).toBeUndefined();
  });
});

describe('Bybit rows, over random moves that share an id between coins', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('draws moves that differ from seed to seed, with an id shared by two coins in every world', () => {
    const worlds = SEEDS.map((seed) => movesOf(seed));

    expect(new Set(worlds.map((moves) => JSON.stringify(moves))).size).toBe(SEEDS.length);
    expect(worlds.map((moves) => idsSharedByCoins(moves).length > 0)).toEqual(
      SEEDS.map(() => true),
    );
    expect(new Set(worlds.flat().map(({ coin }) => coin))).toEqual(new Set(MOVE_COINS));
  });

  it.each(SEEDS)('no transfer pair id ever holds two coins: seed %i', async (seed) => {
    const moves = movesOf(seed);
    const walk = await transferWalkOfMoves(moves);
    const currencyOf = (holdingId: string) =>
      walk.holdings.find((holding) => holding.id === holdingId)?.currency;
    const pairIds = new Set(walk.rows().map((row) => row.exchangePairId));

    expect(pairIds.size).toBe(moves.length);

    for (const pairId of pairIds) {
      const legs = walk.rows().filter((row) => row.exchangePairId === pairId);
      const coins = new Set(legs.map((leg) => currencyOf(leg.holdingId)));

      expect(legs).toHaveLength(2);
      expect(coins.size).toBe(1);
      expect(String(pairId).split(':').at(-1)).toBe([...coins][0]);
    }
  });

  it.each(SEEDS)('every external id carries its coin, BTC too: seed %i', async (seed) => {
    const moves = movesOf(seed);
    const transfers = await transferWalkOfMoves(moves);
    const deposits = await depositWalkOfMoves(moves);

    expect(transfers.rows()).toHaveLength(moves.length * 2);
    expect(deposits.rows()).toHaveLength(moves.length);

    for (const row of transfers.rows()) {
      const coin = transfers.holdings.find((holding) => holding.id === row.holdingId)?.currency;

      // `<account>:xfer:<id>:<COIN>:<COIN>:<wallet>`
      expect(row.externalId.split(':').slice(3, 5)).toEqual([coin, coin]);
    }

    for (const row of deposits.rows()) {
      const coin = deposits.holdings.find((holding) => holding.id === row.holdingId)?.currency;

      // `<account>:deposit:<id>:<COIN>`
      expect(row.externalId.split(':')[3]).toBe(coin);
    }
  });
});
