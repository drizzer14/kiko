import { CURATED_COIN_CODES } from '@kiko/currency/coins';
import { sweep } from '@kiko/test-support/property-sweep';
import { type Random, seededRandom } from '@kiko/test-support/seeded-random';

import { BYBIT_FIAT_CODES } from './bybit.tracked-coin';
import { holdingKeyOf, partsOfHoldingKey, type BybitWallet } from './bybit.holding-keys';

// Q2, the holding-key half: every key carries its coin, BTC too. The external ids join it in the
// steps that add them.
const SEEDS = sweep(Array.from({ length: 20 }, (_unused, position) => 17 + position * 11));

// Small consecutive seeds of the Lehmer generator draw the same first value, so each seed is
// spread before it is used.
const SEED_SPREAD = 1_000_003;

const COINS = [...CURATED_COIN_CODES, ...BYBIT_FIAT_CODES];
const WALLETS: readonly BybitWallet[] = ['unified', 'fund', 'earn'];
const KEYS_PER_SEED = 60;

const pick = <Entry>(random: Random, entries: readonly Entry[]): Entry =>
  entries[Math.floor(random() * entries.length)] as Entry;

const worldOf = (seed: number) => {
  const random = seededRandom(seed * SEED_SPREAD);

  return Array.from({ length: KEYS_PER_SEED }, () => ({
    code: pick(random, COINS),
    wallet: pick(random, WALLETS),
  }));
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
