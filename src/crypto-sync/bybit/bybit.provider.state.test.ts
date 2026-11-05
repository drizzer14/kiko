import {
  FUND_PATH,
  KEY_INFO_PATH,
  UNIFIED_PATH,
  freshTarget,
  heldHolding,
  keysOf,
  makeDeps,
  okAnswer,
  refusalAnswer,
  routedDeps,
  stateAfter,
} from './bybit.provider-test-fixtures';
import { bybitProvider } from './bybit.provider';
import { NOW } from './bybit.client-test-fixtures';
import { BybitRateLimitError, BybitRefusalError } from './bybit.client';
import { fundCoin, fundResult, unifiedCoin, unifiedResult } from './bybit.balance-test-fixtures';

// The credentials module imports react-native-keychain, whose native binding is absent under Jest;
// `readCredentials` is injected, so the stub only needs the ACCESSIBLE enum its module-scope
// hardened-options constant reads at load.
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

const SENTINEL = 'SENTINEL-PERSONAL-FIELD';

let warn: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('the state a Bybit balance read returns', () => {
  describe('an empty read', () => {
    it.each([
      ['an empty result list', unifiedResult([]), fundResult([])],
      ['a wallet entry that lists no coin', { list: [{ coin: [] }] }, { balance: [] }],
    ])('writes no holding and stamps the sync time, so Last sync shows (%s)', async (_t, u, f) => {
      const { deps } = routedDeps({
        [KEY_INFO_PATH]: okAnswer({}),
        [UNIFIED_PATH]: okAnswer(u),
        [FUND_PATH]: okAnswer(f),
      });

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(read.balances).toEqual([]);
      expect(stateAfter(read).balanceSyncedAt).toBe(NOW);
    });

    it('stamps the sync time of a read that wrote holdings too', async () => {
      const read = await bybitProvider.fetchBalances(
        makeDeps([unifiedCoin('BTC', '1')]),
        freshTarget(),
      );

      expect(stateAfter(read).balanceSyncedAt).toBe(NOW);
    });
  });

  describe('a key check that answers with personal fields', () => {
    it('lets no identity field of the key reach the state or the holdings', async () => {
      const { deps, requested } = routedDeps({
        [KEY_INFO_PATH]: okAnswer({
          userID: SENTINEL,
          parentUid: SENTINEL,
          note: SENTINEL,
          kycRegion: SENTINEL,
          ips: [SENTINEL],
          permissions: { Wallet: [SENTINEL] },
          readOnly: 1,
          isMaster: true,
          expiredAt: '2099-01-02T03:04:05Z',
          deadlineDay: 30,
        }),
        [UNIFIED_PATH]: okAnswer(unifiedResult([unifiedCoin('BTC', '1')])),
        [FUND_PATH]: okAnswer(fundResult([fundCoin('BTC', '2')])),
      });

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(requested).toContain(KEY_INFO_PATH);
      expect(JSON.stringify(read)).not.toContain(SENTINEL);
      expect(JSON.stringify(stateAfter(read))).not.toContain(SENTINEL);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(SENTINEL);
    });
  });

  describe('a refused wallet', () => {
    it('keeps its last balance and records its name for the visible line', async () => {
      const { deps } = routedDeps({
        [KEY_INFO_PATH]: okAnswer({}),
        [UNIFIED_PATH]: okAnswer(unifiedResult([unifiedCoin('BTC', '1')])),
        [FUND_PATH]: refusalAnswer(10005),
      });
      const target = freshTarget([heldHolding('BTC:fund', 7)]);

      const read = await bybitProvider.fetchBalances(deps, target);

      expect(keysOf(read)).toEqual(['BTC:unified']);
      expect(stateAfter(read).balanceNotes).toEqual({ unified: {}, fund: { refused: true } });
    });

    it('is marked on a later sync and keeps the notes it had', async () => {
      const deps = makeDeps([unifiedCoin('BTC', '1')]);
      deps.fetchFundBalance.mockRejectedValue(new BybitRefusalError('permission', 10005));

      const read = await bybitProvider.fetchBalances(deps, freshTarget());
      const seed = { balanceNotes: { fund: { borrowed: ['LTC'] }, earn: { earnLeftOut: 2 } } };

      expect(stateAfter(read, seed).balanceNotes).toEqual({
        unified: {},
        fund: { borrowed: ['LTC'], refused: true },
        earn: { earnLeftOut: 2 },
      });
    });

    it('loses its mark when a later read of that wallet succeeds', async () => {
      const read = await bybitProvider.fetchBalances(makeDeps(), freshTarget());
      const seed = { balanceNotes: { fund: { refused: true } } };

      expect(stateAfter(read, seed).balanceNotes).toEqual({ unified: {}, fund: {} });
    });

    it.each([
      ['a rate refusal', new BybitRateLimitError(10006, 60_000)],
      ['a malformed answer', new BybitRefusalError('malformed')],
      ['an unknown refusal', new BybitRefusalError('unknown', 99999)],
      ['a lost network', new TypeError('Network request failed')],
    ])('is not marked for %s, which says nothing of the key', async (_title, failure) => {
      const deps = makeDeps();
      deps.fetchFundBalance.mockRejectedValue(failure);

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(stateAfter(read).balanceNotes).toEqual({ unified: {} });
    });

    it('fails the sync with no state when UNIFIED is the wallet refused', async () => {
      const { deps } = routedDeps({
        [KEY_INFO_PATH]: okAnswer({}),
        [UNIFIED_PATH]: refusalAnswer(10005),
        [FUND_PATH]: okAnswer(fundResult([])),
      });

      await expect(bybitProvider.fetchBalances(deps, freshTarget())).rejects.toThrow(
        BybitRefusalError,
      );
    });
  });

  describe('a coin with a borrow on a first connect', () => {
    it('creates no holding and lists itself', async () => {
      const deps = makeDeps([
        unifiedCoin('BTC', '1', { spotBorrow: '0.25' }),
        unifiedCoin('ETH', '3', { borrowAmount: '1' }),
      ]);

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(read.balances).toEqual([]);
      expect(stateAfter(read).balanceNotes).toEqual({
        unified: { borrowed: ['BTC', 'ETH'] },
        fund: {},
      });
    });

    it('is not listed as a refused coin or as a coin the app does not track', async () => {
      const deps = makeDeps([unifiedCoin('BTC', '1', { spotBorrow: '0.25' })]);

      const state = stateAfter(await bybitProvider.fetchBalances(deps, freshTarget()));

      expect(state.oversizedCoins).toEqual({
        balance: [],
        balanceByWallet: { unified: [], fund: [] },
      });
      expect(state.untrackedCoins).toEqual({ balance: [] });
    });
  });

  describe('the notes of the wallets', () => {
    const seed = {
      balanceNotes: {
        unified: { borrowed: ['ETH'] },
        fund: { borrowed: ['LTC'], refused: true },
        earn: { earnLeftOut: 2 },
      },
    };

    it('are replaced for a wallet that read and kept for a wallet that failed', async () => {
      const deps = makeDeps([unifiedCoin('BTC', '1', { spotBorrow: '1' })]);
      deps.fetchFundBalance.mockRejectedValue(new BybitRateLimitError(10006, 60_000));

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(stateAfter(read, seed).balanceNotes).toEqual({
        unified: { borrowed: ['BTC'] },
        fund: { borrowed: ['LTC'], refused: true },
        earn: { earnLeftOut: 2 },
      });
    });

    it('are replaced for both wallets by a read of both, the Earn notes left as stored', async () => {
      const read = await bybitProvider.fetchBalances(makeDeps(), freshTarget());

      expect(stateAfter(read, seed).balanceNotes).toEqual({
        unified: {},
        fund: {},
        earn: { earnLeftOut: 2 },
      });
    });
  });

  describe('the coin lists', () => {
    const storedFund = { oversizedCoins: { balance: ['SOL'], balanceByWallet: { fund: ['SOL'] } } };

    it('lists a coin whose amount was refused under the wallet that read it', async () => {
      const deps = makeDeps([unifiedCoin('BTC', 'lots'), unifiedCoin('ETH', '2')]);

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(keysOf(read)).toEqual(['ETH:unified']);
      expect(stateAfter(read, storedFund).oversizedCoins).toEqual({
        balance: ['BTC'],
        balanceByWallet: { unified: ['BTC'], fund: [] },
      });
    });

    it('keeps the refused coins of a wallet that failed', async () => {
      const deps = makeDeps([unifiedCoin('BTC', 'lots')]);
      deps.fetchFundBalance.mockRejectedValue(new TypeError('Network request failed'));

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(stateAfter(read, storedFund).oversizedCoins).toEqual({
        balance: ['BTC', 'SOL'],
        balanceByWallet: { unified: ['BTC'], fund: ['SOL'] },
      });
    });

    it('lists the coins the app does not track once, on a read of both wallets', async () => {
      const deps = makeDeps(
        [unifiedCoin('PEPE', '5'), unifiedCoin('UAH', '1')],
        [fundCoin('PEPE', '2'), fundCoin('SCR', '3')],
      );
      const seed = { untrackedCoins: { balance: ['OLD'], history: ['KEEP'] } };

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(stateAfter(read, seed).untrackedCoins).toEqual({
        balance: ['PEPE', 'SCR', 'UAH'],
        history: ['KEEP'],
      });
    });

    it('keeps the list of coins not tracked when FUND failed', async () => {
      const deps = makeDeps([unifiedCoin('PEPE', '5')]);
      deps.fetchFundBalance.mockRejectedValue(new BybitRefusalError('malformed'));

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(stateAfter(read, { untrackedCoins: { balance: ['OLD'] } }).untrackedCoins).toEqual({
        balance: ['OLD'],
      });
    });
  });

  describe('what the read writes to the state', () => {
    it('names only the lists, the notes, the end of the key and the stamp', async () => {
      const read = await bybitProvider.fetchBalances(
        makeDeps([unifiedCoin('BTC', '1')], [fundCoin('ETH', '2')]),
        freshTarget(),
      );

      expect(Object.keys(stateAfter(read)).sort()).toEqual([
        'balanceNotes',
        'balanceSyncedAt',
        'keyExpiry',
        'oversizedCoins',
        'untrackedCoins',
        'version',
        'walks',
      ]);
    });

    it('returns no Binance Spot balance texts', async () => {
      const read = await bybitProvider.fetchBalances(makeDeps(), freshTarget());

      expect(read).not.toHaveProperty('spotBalanceTexts');
    });
  });
});
