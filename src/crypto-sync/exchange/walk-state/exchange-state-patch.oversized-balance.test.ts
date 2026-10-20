import { type ExchangeStatePatch, exchangeStatePatched } from './exchange-state-patch';

type Wallets = Record<string, string[]>;

const oversizedBalance = (wallets: Wallets, complete = false): ExchangeStatePatch => ({
  kind: 'oversizedBalance',
  wallets,
  complete,
});

const stateWith = (oversizedCoins?: unknown): string =>
  JSON.stringify({ version: 1, walks: {}, oversizedCoins });

const oversizedOf = (text: string | undefined): unknown =>
  JSON.parse(text ?? 'null').oversizedCoins;

const patched = (seed: unknown, ...patches: ExchangeStatePatch[]) =>
  oversizedOf(exchangeStatePatched(stateWith(seed), patches));

describe('the oversized balance patch', () => {
  it('adds the refused coins of a wallet that read, to its array and to the balance list', () => {
    expect(patched(undefined, oversizedBalance({ spot: ['ETH'] }))).toEqual({
      balance: ['ETH'],
      balanceByWallet: { spot: ['ETH'] },
    });
  });

  it('removes the coins of a wallet that read fine, whichever wallets failed', () => {
    const seed = { balance: ['ETH'], balanceByWallet: { spot: ['ETH'] }, history: ['BTC'] };

    expect(patched(seed, oversizedBalance({ spot: [] }))).toEqual({
      balance: [],
      balanceByWallet: { spot: [] },
      history: ['BTC'],
    });
  });

  it('keeps the stored array of a wallet the read did not reach', () => {
    const seed = {
      balance: ['ETH', 'SOL'],
      balanceByWallet: { spot: ['ETH'], funding: ['SOL'] },
    };

    expect(patched(seed, oversizedBalance({ spot: [], earn: [] }))).toEqual({
      balance: ['SOL'],
      balanceByWallet: { spot: [], funding: ['SOL'], earn: [] },
    });
  });

  describe('a stored wallet array under a key this build never writes', () => {
    const seed = {
      balance: ['ETH', 'LTC'],
      balanceByWallet: { spot: ['ETH'], margin: ['LTC'] },
    };

    it('stays through a partial read, like the array of any wallet that did not read', () => {
      expect(patched(seed, oversizedBalance({ spot: [] }))).toEqual({
        balance: ['LTC'],
        balanceByWallet: { spot: [], margin: ['LTC'] },
      });
    });

    it('is dropped by a full read, which replaces every wallet array', () => {
      const written = patched(seed, oversizedBalance({ spot: [], funding: [], earn: [] }, true));

      expect(written).toEqual({
        balance: [],
        balanceByWallet: { spot: [], funding: [], earn: [] },
      });
    });
  });

  describe('a ticker stored before any wallet was named (legacy)', () => {
    const oldShape = { balance: ['OLD'], history: ['BTC'] };
    const attributed = { balance: ['ETH', 'OLD'], balanceByWallet: { spot: ['ETH'] } };

    it.each([
      ['an old-shape list', oldShape, { spot: ['USDT'] }, ['OLD', 'USDT']],
      [
        'a list that names wallets for other tickers',
        attributed,
        { spot: ['ETH', 'USDT'] },
        ['ETH', 'OLD', 'USDT'],
      ],
    ])('is kept by a partial read: %s', (_title, seed, wallets, balance) => {
      expect(patched(seed, oversizedBalance(wallets))).toMatchObject({ balance });
    });

    it.each([
      ['an old-shape list', oldShape],
      ['a list that names wallets for other tickers', attributed],
    ])('is dropped by a full read: %s', (_title, seed) => {
      const written = patched(
        seed,
        oversizedBalance({ spot: ['USDT'], funding: [], earn: [] }, true),
      );

      expect(written).toMatchObject({
        balance: ['USDT'],
        balanceByWallet: { spot: ['USDT'], funding: [], earn: [] },
      });
    });

    it('leaves the history list as stored', () => {
      const written = patched(oldShape, oversizedBalance({ spot: [] }, true));

      expect(written).toMatchObject({ history: ['BTC'] });
    });
  });

  describe('a malformed balanceByWallet', () => {
    it('keeps the stored balance as legacy and is repaired by the write', () => {
      const seed = { balance: ['ETH'], balanceByWallet: 'junk' };

      expect(patched(seed, oversizedBalance({ spot: ['USDT'] }))).toEqual({
        balance: ['ETH', 'USDT'],
        balanceByWallet: { spot: ['USDT'] },
      });
    });

    it('drops a malformed wallet entry: its tickers become legacy, the others stay named', () => {
      const seed = {
        balance: ['ETH', 'SOL'],
        balanceByWallet: { spot: 5, funding: ['SOL'] },
      };

      expect(patched(seed, oversizedBalance({ earn: [] }))).toEqual({
        balance: ['ETH', 'SOL'],
        balanceByWallet: { funding: ['SOL'], earn: [] },
      });
    });
  });

  describe('the balance list is always the wallet arrays and the kept legacy tickers', () => {
    type Step = { patch: ExchangeStatePatch; wallets: Wallets; complete: boolean };

    const step = (wallets: Wallets, complete = false): Step => ({
      patch: oversizedBalance(wallets, complete),
      wallets,
      complete,
    });

    const SEQUENCES: [title: string, seed: unknown, legacy: string[], steps: Step[]][] = [
      [
        'full reads from nothing',
        undefined,
        [],
        [
          step({ spot: ['ETH'], funding: [], earn: ['SOL'] }, true),
          step({ spot: [], funding: ['ETH'], earn: [] }, true),
        ],
      ],
      [
        'a full read, then partial reads, then a full read',
        undefined,
        [],
        [
          step({ spot: ['ETH'], funding: ['SOL'], earn: [] }, true),
          step({ spot: ['USDT'] }),
          step({ spot: [], earn: ['ETH'] }),
          step({ spot: [], funding: [], earn: [] }, true),
        ],
      ],
      [
        'an old-shape list: partial reads keep it, the full read drops it',
        { balance: ['OLD'], history: ['BTC'] },
        ['OLD'],
        [
          step({ spot: ['ETH'] }),
          step({ spot: [], funding: ['SOL'] }),
          step({ spot: [], funding: [], earn: [] }, true),
        ],
      ],
      [
        'a malformed start: its balance is legacy until a full read',
        { balance: ['OLD'], balanceByWallet: 'junk' },
        ['OLD'],
        [
          step({ earn: ['ETH'] }),
          step({ spot: ['USDT'] }),
          step({ spot: [], funding: [], earn: [] }, true),
        ],
      ],
    ];

    it.each(SEQUENCES)('%s', (_title, seed, initialLegacy, steps) => {
      let text: string | undefined = stateWith(seed);
      let legacy = initialLegacy;
      let byWallet: Wallets = {};

      for (const { patch, wallets, complete } of steps) {
        text = exchangeStatePatched(text ?? '', [patch]);
        legacy = complete ? [] : legacy;
        byWallet = { ...byWallet, ...wallets };

        expect(oversizedOf(text)).toMatchObject({
          balance: [...new Set([...Object.values(byWallet).flat(), ...legacy])].sort(),
          balanceByWallet: byWallet,
        });
      }
    });
  });
});
