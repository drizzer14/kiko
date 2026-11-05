import { i18n } from '@kiko/i18n/init';

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
      const seed = { balanceNotes: { fund: { borrowed: ['LTC'] }, margin: { borrowed: ['SOL'] } } };

      expect(stateAfter(read, seed).balanceNotes).toEqual({
        unified: {},
        fund: { borrowed: ['LTC'], refused: true },
        margin: { borrowed: ['SOL'] },
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
      ['a compliance refusal', new BybitRefusalError('compliance', 10024)],
      ['a lost network', new TypeError('Network request failed')],
    ])('is marked as not read, not as refused, for %s', async (_title, failure) => {
      const deps = makeDeps();
      deps.fetchFundBalance.mockRejectedValue(failure);

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(stateAfter(read).balanceNotes).toEqual({ unified: {}, fund: { notRead: true } });
    });

    it('marks a FUND wallet that answers 10024 as not read, and logs it by code', async () => {
      const { deps } = routedDeps({
        [KEY_INFO_PATH]: okAnswer({}),
        [UNIFIED_PATH]: okAnswer(unifiedResult([unifiedCoin('BTC', '1')])),
        [FUND_PATH]: refusalAnswer(10024),
      });

      const read = await bybitProvider.fetchBalances(
        deps,
        freshTarget([heldHolding('BTC:fund', 7)]),
      );

      expect(keysOf(read)).toEqual(['BTC:unified']);
      expect(stateAfter(read).balanceNotes).toEqual({ unified: {}, fund: { notRead: true } });
      expect(warn).toHaveBeenCalledWith('[bybit sync] skipped the fund wallet', {
        name: 'BybitRefusalError',
        code: 10024,
      });
    });

    it('marks the wallet on a first sync, with no earlier balance to keep', async () => {
      const { deps } = routedDeps({
        [KEY_INFO_PATH]: okAnswer({}),
        [UNIFIED_PATH]: okAnswer(unifiedResult([])),
        [FUND_PATH]: okAnswer({ unexpected: true }),
      });

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(read.balances).toEqual([]);
      expect(stateAfter(read).balanceNotes).toEqual({ unified: {}, fund: { notRead: true } });
    });

    it('keeps the notes it had when it was not read again', async () => {
      const deps = makeDeps([unifiedCoin('BTC', '1')]);
      deps.fetchFundBalance.mockRejectedValue(new TypeError('Network request failed'));
      const seed = { balanceNotes: { fund: { borrowed: ['LTC'], refusedCoins: ['SOL'] } } };

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(stateAfter(read, seed).balanceNotes).toEqual({
        unified: {},
        fund: { borrowed: ['LTC'], refusedCoins: ['SOL'], notRead: true },
      });
    });

    it('shows one cause: a refusal that follows a not-read wallet replaces its mark', async () => {
      const deps = makeDeps([unifiedCoin('BTC', '1')]);
      deps.fetchFundBalance.mockRejectedValue(new BybitRefusalError('permission', 10005));

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(stateAfter(read, { balanceNotes: { fund: { notRead: true } } }).balanceNotes).toEqual({
        unified: {},
        fund: { refused: true },
      });
    });

    it('loses its not-read mark when a later read of that wallet succeeds', async () => {
      const read = await bybitProvider.fetchBalances(makeDeps(), freshTarget());
      const seed = { balanceNotes: { fund: { notRead: true } } };

      expect(stateAfter(read, seed).balanceNotes).toEqual({ unified: {}, fund: {} });
    });

    it('fails the sync with the compliance text when UNIFIED answers 10024', async () => {
      const { deps } = routedDeps({
        [KEY_INFO_PATH]: okAnswer({}),
        [UNIFIED_PATH]: refusalAnswer(10024),
        [FUND_PATH]: okAnswer(fundResult([])),
      });

      await expect(bybitProvider.fetchBalances(deps, freshTarget())).rejects.toThrow(
        i18n.t('accountDetail.bybitComplianceRefused'),
      );
    });

    it('fails the sync with no state when UNIFIED is the wallet refused', async () => {
      const { deps } = routedDeps({
        [KEY_INFO_PATH]: okAnswer({}),
        [UNIFIED_PATH]: refusalAnswer(10005),
        [FUND_PATH]: okAnswer(fundResult([])),
      });

      await expect(bybitProvider.fetchBalances(deps, freshTarget())).rejects.toThrow(
        i18n.t('accountDetail.bybitKeyMissingPermission'),
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

      expect(state.balanceNotes).toEqual({ unified: { borrowed: ['BTC'] }, fund: {} });
      expect(state).not.toHaveProperty('oversizedCoins');
      expect(state.untrackedCoins).toEqual({ balance: [] });
    });
  });

  describe('a coin with an open order', () => {
    it('lists itself under its wallet, sorted, and is no refused or untracked coin', async () => {
      const deps = makeDeps([
        unifiedCoin('ETH', '3', { locked: '1' }),
        unifiedCoin('BTC', '1', { locked: '' }),
      ]);

      const state = stateAfter(await bybitProvider.fetchBalances(deps, freshTarget()));

      expect(state.balanceNotes).toEqual({ unified: { openOrder: ['BTC', 'ETH'] }, fund: {} });
      expect(state).not.toHaveProperty('oversizedCoins');
      expect(state.untrackedCoins).toEqual({ balance: [] });
    });

    it('with a loan too is listed as borrowed alone', async () => {
      const deps = makeDeps([unifiedCoin('BTC', '1', { spotBorrow: '0.25', locked: '1' })]);

      const state = stateAfter(await bybitProvider.fetchBalances(deps, freshTarget()));

      expect(state.balanceNotes).toEqual({ unified: { borrowed: ['BTC'] }, fund: {} });
    });

    it('the first good read after the order closes writes the balance and clears the mark', async () => {
      const seed = { balanceNotes: { unified: { openOrder: ['BTC'] } } };
      const deps = makeDeps([unifiedCoin('BTC', '1')]);

      const read = await bybitProvider.fetchBalances(
        deps,
        freshTarget([heldHolding('BTC:unified', 5)]),
      );

      expect(keysOf(read)).toEqual(['BTC:unified']);
      expect(read.balances[0]?.balanceMinorUnits).toBe(100000000);
      expect(stateAfter(read, seed).balanceNotes).toEqual({ unified: {}, fund: {} });
    });

    it('a coin no longer listed after the order closes is written at zero and clears the mark', async () => {
      const seed = { balanceNotes: { unified: { openOrder: ['BTC'] } } };
      const deps = makeDeps([]);

      const read = await bybitProvider.fetchBalances(
        deps,
        freshTarget([heldHolding('BTC:unified', 5)]),
      );

      expect(read.balances[0]?.balanceMinorUnits).toBe(0);
      expect(stateAfter(read, seed).balanceNotes).toEqual({ unified: {}, fund: {} });
    });

    it('is still listed after a second read that finds the order open', async () => {
      const seed = { balanceNotes: { unified: { openOrder: ['BTC'] } } };
      const deps = makeDeps([unifiedCoin('BTC', '1', { locked: '0.1' })]);

      const read = await bybitProvider.fetchBalances(
        deps,
        freshTarget([heldHolding('BTC:unified', 5)]),
      );

      expect(keysOf(read)).toEqual([]);
      expect(stateAfter(read, seed).balanceNotes).toEqual({
        unified: { openOrder: ['BTC'] },
        fund: {},
      });
    });

    it('is kept, with the refused mark added, when FUND is refused and UNIFIED reads', async () => {
      const seed = { balanceNotes: { unified: { openOrder: ['BTC'] } } };
      const deps = makeDeps([unifiedCoin('BTC', '1', { locked: '0.1' })]);
      deps.fetchFundBalance.mockRejectedValue(new BybitRefusalError('permission', 10005));

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(stateAfter(read, seed).balanceNotes).toEqual({
        unified: { openOrder: ['BTC'] },
        fund: { refused: true },
      });
    });
  });

  describe('the notes of the wallets', () => {
    const seed = {
      balanceNotes: {
        unified: { borrowed: ['ETH'] },
        fund: { borrowed: ['LTC'], refused: true },
        margin: { borrowed: ['SOL'] },
      },
    };

    it('are replaced for a wallet that read and kept for a wallet that failed, its cause now shown', async () => {
      const deps = makeDeps([unifiedCoin('BTC', '1', { spotBorrow: '1' })]);
      deps.fetchFundBalance.mockRejectedValue(new BybitRateLimitError(10006, 60_000));

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(stateAfter(read, seed).balanceNotes).toEqual({
        unified: { borrowed: ['BTC'] },
        fund: { borrowed: ['LTC'], notRead: true },
        margin: { borrowed: ['SOL'] },
      });
    });

    it('are replaced for both wallets by a read of both, the notes of another wallet left as stored', async () => {
      const read = await bybitProvider.fetchBalances(makeDeps(), freshTarget());

      expect(stateAfter(read, seed).balanceNotes).toEqual({
        unified: {},
        fund: {},
        margin: { borrowed: ['SOL'] },
      });
    });
  });

  // A refused coin is a note of its wallet, never an entry of the oversized list, so the same
  // wallet-by-wallet replace and keep that `complete` gave the list holds here.
  describe('a coin that is refused', () => {
    const stored = { oversizedCoins: { balance: ['SOL'], balanceByWallet: { fund: ['SOL'] } } };

    it('goes to the notes and writes no oversized list', async () => {
      const deps = makeDeps([
        unifiedCoin('BTC', 'lots'),
        unifiedCoin('ETH', '2', { spotBorrow: '' }),
        unifiedCoin('USDT', '3'),
      ]);

      const read = await bybitProvider.fetchBalances(deps, freshTarget());
      const state = stateAfter(read);

      expect(keysOf(read)).toEqual(['USDT:unified']);
      expect(state.balanceNotes).toEqual({ unified: { refusedCoins: ['BTC', 'ETH'] }, fund: {} });
      expect(state).not.toHaveProperty('oversizedCoins');
    });

    it('lists itself under the wallet that read it, FUND too', async () => {
      const deps = makeDeps(
        [unifiedCoin('BTC', 'lots')],
        [fundCoin('ETH', '1'), fundCoin('ETH', '1')],
      );

      const state = stateAfter(await bybitProvider.fetchBalances(deps, freshTarget()));

      expect(state.balanceNotes).toEqual({
        unified: { refusedCoins: ['BTC'] },
        fund: { refusedCoins: ['ETH'] },
      });
    });

    it('leaves a stored oversized list as stored, since no Bybit balance read writes one', async () => {
      const deps = makeDeps([unifiedCoin('BTC', 'lots')]);

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(stateAfter(read, stored).oversizedCoins).toEqual(stored.oversizedCoins);
    });

    it('is cleared by the first good read of its wallet', async () => {
      const seed = {
        balanceNotes: { unified: { refusedCoins: ['BTC'] }, fund: { refusedCoins: ['ETH'] } },
      };
      const deps = makeDeps([unifiedCoin('BTC', '1')], [fundCoin('ETH', '2')]);

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(keysOf(read)).toEqual(['BTC:unified', 'ETH:fund']);
      expect(stateAfter(read, seed).balanceNotes).toEqual({ unified: {}, fund: {} });
    });

    it('is replaced for a wallet that read and kept for a wallet that failed', async () => {
      const seed = {
        balanceNotes: { unified: { refusedCoins: ['BTC'] }, fund: { refusedCoins: ['SOL'] } },
      };
      const deps = makeDeps([unifiedCoin('ETH', 'lots')]);
      deps.fetchFundBalance.mockRejectedValue(new TypeError('Network request failed'));

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(stateAfter(read, seed).balanceNotes).toEqual({
        unified: { refusedCoins: ['ETH'] },
        fund: { refusedCoins: ['SOL'], notRead: true },
      });
    });

    it('is kept, with the refused mark added, when FUND is refused the key', async () => {
      const seed = { balanceNotes: { fund: { refusedCoins: ['SOL'] } } };
      const deps = makeDeps();
      deps.fetchFundBalance.mockRejectedValue(new BybitRefusalError('permission', 10005));

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(stateAfter(read, seed).balanceNotes).toEqual({
        unified: {},
        fund: { refusedCoins: ['SOL'], refused: true },
      });
    });

    it('lists each coin the read refuses, one a later read finds good dropped, none lost', async () => {
      const seed = { balanceNotes: { unified: { refusedCoins: ['BTC', 'ETH'] } } };
      const deps = makeDeps([
        unifiedCoin('BTC', 'lots'),
        unifiedCoin('ETH', '1'),
        unifiedCoin('SOL', 'x'),
      ]);

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(stateAfter(read, seed).balanceNotes).toEqual({
        unified: { refusedCoins: ['BTC', 'SOL'] },
        fund: {},
      });
    });
  });

  describe('the coin lists', () => {
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
