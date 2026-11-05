import { i18n } from '@kiko/i18n/init';

import {
  BybitRateLimitError,
  BybitRefusalError,
  fetchFundBalance,
  fetchKeyInfo,
  fetchUnifiedBalance,
} from './bybit.client';
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
} from './bybit.provider-test-fixtures';
import { readBybitCredentials } from './bybit.credentials';
import { bybitProvider, defaultBybitDeps } from './bybit.provider';
import { API_KEY, NOW, SECRET } from './bybit.client-test-fixtures';
import { isBybitCoolingDown, setBybitCooldownUntil } from './bybit.cooldown';
import { fundCoin, fundResult, unifiedCoin, unifiedResult } from './bybit.balance-test-fixtures';

// The credentials module imports react-native-keychain, whose native binding is absent under Jest;
// `readCredentials` is injected, so the stub only needs the ACCESSIBLE enum its module-scope
// hardened-options constant reads at load.
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

// Each failure with the text a strict read shows for it; a lost network is no Bybit refusal and
// shows as it is.
const FAILURES: [string, () => Error, () => string][] = [
  [
    'a rate refusal',
    () => new BybitRateLimitError(10006, 60_000),
    () => i18n.t('accountDetail.bybitRequestFailed', { code: 10006 }),
  ],
  [
    'a malformed answer',
    () => new BybitRefusalError('malformed'),
    () => i18n.t('accountDetail.bybitMissingBalances'),
  ],
  [
    'an unknown refusal',
    () => new BybitRefusalError('unknown', 99999),
    () => i18n.t('accountDetail.bybitRequestFailed', { code: 99999 }),
  ],
  [
    'a permission refusal',
    () => new BybitRefusalError('permission', 10005),
    () => i18n.t('accountDetail.bybitKeyMissingPermission'),
  ],
  [
    'an expired key',
    () => new BybitRefusalError('expired', 33004),
    () => i18n.t('accountDetail.bybitKeyRefusedExpired'),
  ],
  [
    'a forbidden answer',
    () => new BybitRateLimitError(403, 600_000),
    () => i18n.t('accountDetail.bybitForbidden'),
  ],
  ['a lost network', () => new TypeError('Network request failed'), () => 'Network request failed'],
];

const pairsOf = (balances: { metadataKey: string; balanceMinorUnits: number }[]) =>
  balances.map(({ metadataKey, balanceMinorUnits }) => [metadataKey, balanceMinorUnits]);

let warn: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('bybitProvider', () => {
  it('is the bybit exchange provider keyed on bybitAsset', () => {
    expect(bybitProvider.id).toBe('bybit');
    expect(bybitProvider.metadataField).toBe('bybitAsset');
  });

  it('wires the real client, credentials reader, clock and fetch as its default deps', () => {
    expect(defaultBybitDeps.fetchKeyInfo).toBe(fetchKeyInfo);
    expect(defaultBybitDeps.fetchUnifiedBalance).toBe(fetchUnifiedBalance);
    expect(defaultBybitDeps.fetchFundBalance).toBe(fetchFundBalance);
    expect(defaultBybitDeps.readCredentials).toBe(readBybitCredentials);
    expect(defaultBybitDeps.fetchImpl).toBe(fetch);
    expect(typeof defaultBybitDeps.now()).toBe('number');
  });

  it('throws the text that asks to connect Bybit, before any request, when no pair is stored', async () => {
    const deps = makeDeps();
    deps.readCredentials.mockResolvedValue(undefined);

    await expect(bybitProvider.fetchBalances(deps, freshTarget())).rejects.toThrow(
      i18n.t('accountDetail.noBybitCredentials'),
    );
    expect(deps.fetchKeyInfo).not.toHaveBeenCalled();
    expect(deps.fetchUnifiedBalance).not.toHaveBeenCalled();
  });

  it('reads the credentials of the target account, then the key check, UNIFIED and FUND', async () => {
    const deps = makeDeps();
    const target = freshTarget();

    await bybitProvider.fetchBalances(deps, target);

    expect(deps.readCredentials).toHaveBeenCalledTimes(1);
    expect(deps.readCredentials).toHaveBeenCalledWith(target.accountId);

    const [keyInfo, unified, fund] = [
      deps.fetchKeyInfo,
      deps.fetchUnifiedBalance,
      deps.fetchFundBalance,
    ].map((read) => read.mock.invocationCallOrder);

    expect(keyInfo).toHaveLength(1);
    expect(unified).toHaveLength(1);
    expect(fund).toHaveLength(1);
    expect(keyInfo?.[0]).toBeLessThan(unified?.[0] ?? 0);
    expect(unified?.[0]).toBeLessThan(fund?.[0] ?? 0);
  });

  describe('the account of every read', () => {
    // The client takes the account as an option, so a read without it still works and only the
    // cooldown of a rate refusal is lost: each read is checked for the account on its own.
    it.each(['fetchKeyInfo', 'fetchUnifiedBalance', 'fetchFundBalance'] as const)(
      'passes the target account, the injected fetch and the clock to %s',
      async (read) => {
        const deps = makeDeps();
        const target = freshTarget();

        await bybitProvider.fetchBalances(deps, target);

        expect(deps[read]).toHaveBeenCalledWith(API_KEY, SECRET, {
          fetchImpl: deps.fetchImpl,
          now: deps.now,
          accountId: target.accountId,
        });
      },
    );

    it.each([
      ['the key check', KEY_INFO_PATH],
      ['the UNIFIED read', UNIFIED_PATH],
      ['the FUND read', FUND_PATH],
    ])('cools down the target account when a rate refusal answers %s', async (_title, path) => {
      const { deps } = routedDeps({
        [KEY_INFO_PATH]: okAnswer({}),
        [UNIFIED_PATH]: okAnswer(unifiedResult([])),
        [FUND_PATH]: okAnswer(fundResult([])),
        [path]: refusalAnswer(10006),
      });
      const target = freshTarget();
      const other = freshTarget();

      await bybitProvider.fetchBalances(deps, target).catch(() => undefined);

      expect(isBybitCoolingDown(target.accountId, NOW)).toBe(true);
      expect(isBybitCoolingDown(other.accountId, NOW)).toBe(false);
    });
  });

  describe('a cooling account', () => {
    it('makes no call and returns no balances', async () => {
      const deps = makeDeps([unifiedCoin('BTC', '1')]);
      const target = freshTarget([heldHolding('BTC:unified', 5)]);
      setBybitCooldownUntil(target.accountId, NOW + 1_000);

      const read = await bybitProvider.fetchBalances(deps, target);

      expect(read).toEqual({ balances: [] });
      expect(deps.readCredentials).not.toHaveBeenCalled();
      expect(deps.fetchKeyInfo).not.toHaveBeenCalled();
      expect(deps.fetchUnifiedBalance).not.toHaveBeenCalled();
      expect(deps.fetchFundBalance).not.toHaveBeenCalled();
    });

    it('reads again once the cooldown has passed', async () => {
      const deps = makeDeps([unifiedCoin('BTC', '1')]);
      const target = freshTarget();
      setBybitCooldownUntil(target.accountId, NOW);

      expect(keysOf(await bybitProvider.fetchBalances(deps, target))).toEqual(['BTC:unified']);
    });
  });

  describe('the key check', () => {
    it('fails the sync at once, with the text of an ended key, when the key is refused as expired', async () => {
      const deps = makeDeps([unifiedCoin('BTC', '1')]);
      deps.fetchKeyInfo.mockRejectedValue(new BybitRefusalError('expired', 33004));

      await expect(bybitProvider.fetchBalances(deps, freshTarget())).rejects.toThrow(
        i18n.t('accountDetail.bybitKeyRefusedExpired'),
      );
      expect(deps.fetchUnifiedBalance).not.toHaveBeenCalled();
      expect(deps.fetchFundBalance).not.toHaveBeenCalled();
    });

    it.each(FAILURES.filter(([title]) => title !== 'an expired key'))(
      'tolerates %s and reads the balances',
      async (_title, failure) => {
        const deps = makeDeps([unifiedCoin('BTC', '1')]);
        deps.fetchKeyInfo.mockRejectedValue(failure());

        const read = await bybitProvider.fetchBalances(deps, freshTarget());

        expect(keysOf(read)).toEqual(['BTC:unified']);
      },
    );

    it('stops after a rate refusal of the check, which has cooled the account', async () => {
      const { deps, requested } = routedDeps({
        [KEY_INFO_PATH]: refusalAnswer(10006),
        [UNIFIED_PATH]: okAnswer(unifiedResult([unifiedCoin('BTC', '1')])),
        [FUND_PATH]: okAnswer(fundResult([])),
      });
      const target = freshTarget([heldHolding('BTC:unified', 5)]);

      const read = await bybitProvider.fetchBalances(deps, target);

      expect(read).toEqual({ balances: [] });
      expect(requested).toEqual([KEY_INFO_PATH]);
    });
  });

  describe('a failed UNIFIED read', () => {
    it.each(FAILURES)(
      'fails the sync with its text and writes no holding for %s',
      async (_title, failure, text) => {
        const deps = makeDeps([unifiedCoin('BTC', '1')], [fundCoin('ETH', '2')]);
        deps.fetchUnifiedBalance.mockRejectedValue(failure());

        await expect(
          bybitProvider.fetchBalances(deps, freshTarget([heldHolding('BTC:unified', 5)])),
        ).rejects.toThrow(text());
        expect(deps.fetchFundBalance).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['no result list', okAnswer({ accountType: 'UNIFIED' })],
      ['an entry with no coin list', okAnswer({ list: [{ accountType: 'UNIFIED' }] })],
      ['a coin row with no name', okAnswer({ list: [{ coin: [{ walletBalance: '1' }] }] })],
      ['a coin row that is no object', okAnswer({ list: [{ coin: ['BTC'] }] })],
      ['an answer with no result', okAnswer(undefined)],
    ])('reads %s as a failure, never as an empty wallet', async (_title, answer) => {
      const { deps } = routedDeps({ [KEY_INFO_PATH]: okAnswer({}), [UNIFIED_PATH]: answer });
      const target = freshTarget([heldHolding('BTC:unified', 5)]);

      await expect(bybitProvider.fetchBalances(deps, target)).rejects.toThrow(
        i18n.t('accountDetail.bybitMissingBalances'),
      );
    });
  });

  describe('a failed FUND read', () => {
    it.each(FAILURES)(
      'leaves each FUND holding at its last balance for %s',
      async (_title, failure) => {
        const deps = makeDeps([unifiedCoin('BTC', '1')], [fundCoin('BTC', '9')]);
        deps.fetchFundBalance.mockRejectedValue(failure());
        const target = freshTarget([
          heldHolding('BTC:unified', 5),
          heldHolding('BTC:fund', 7),
          heldHolding('USDT:fund', 7, 'USDT'),
        ]);

        const read = await bybitProvider.fetchBalances(deps, target);

        expect(read.balances).toEqual([
          {
            currency: 'BTC',
            balanceMinorUnits: 100000000,
            metadataKey: 'BTC:unified',
            name: 'Bybit Unified · BTC',
          },
        ]);
      },
    );

    it.each([
      ['no balance list', okAnswer({ accountType: 'FUND' })],
      ['a coin row with no name', okAnswer({ balance: [{ walletBalance: '1' }] })],
      ['a coin row that is no object', okAnswer({ balance: [null] })],
      ['an answer with no result', okAnswer(undefined)],
    ])('reads %s as a failure, never as an empty wallet', async (_title, answer) => {
      const { deps } = routedDeps({
        [KEY_INFO_PATH]: okAnswer({}),
        [UNIFIED_PATH]: okAnswer(unifiedResult([unifiedCoin('BTC', '1')])),
        [FUND_PATH]: answer,
      });
      const target = freshTarget([heldHolding('BTC:fund', 7), heldHolding('BTC:unified', 5)]);

      expect(keysOf(await bybitProvider.fetchBalances(deps, target))).toEqual(['BTC:unified']);
    });

    it('leaves the UNIFIED rows right when only FUND was refused', async () => {
      const { deps } = routedDeps({
        [KEY_INFO_PATH]: okAnswer({}),
        [UNIFIED_PATH]: okAnswer(unifiedResult([unifiedCoin('BTC', '1'), unifiedCoin('ETH', '2')])),
        [FUND_PATH]: refusalAnswer(10005),
      });
      const target = freshTarget([
        heldHolding('BTC:fund', 7),
        heldHolding('ETH:unified', 9, 'ETH'),
      ]);

      const read = await bybitProvider.fetchBalances(deps, target);

      expect(pairsOf(read.balances)).toEqual([
        ['BTC:unified', 100000000],
        ['ETH:unified', 200000000],
      ]);
    });
  });

  describe('a good read', () => {
    it('that omits a held coin writes that holding at zero', async () => {
      const deps = makeDeps([unifiedCoin('BTC', '1')], []);
      const target = freshTarget([
        heldHolding('ETH:unified', 9, 'ETH'),
        heldHolding('BTC:fund', 7),
        heldHolding('USDT:unified', 3, 'USDT'),
      ]);

      const read = await bybitProvider.fetchBalances(deps, target);

      expect(pairsOf(read.balances)).toEqual([
        ['BTC:unified', 100000000],
        ['ETH:unified', 0],
        ['USDT:unified', 0],
        ['BTC:fund', 0],
      ]);
    });

    it.each([
      ['an empty result list', unifiedResult([]), fundResult([])],
      ['a wallet entry that lists no coin', { list: [{ coin: [] }] }, { balance: [] }],
      ['no wallet entry at all', { list: [] }, { balance: [] }],
    ])('clears a held coin when the answers are %s', async (_title, unified, fund) => {
      const { deps } = routedDeps({
        [KEY_INFO_PATH]: okAnswer({}),
        [UNIFIED_PATH]: okAnswer(unified),
        [FUND_PATH]: okAnswer(fund),
      });
      const target = freshTarget([heldHolding('BTC:unified', 5), heldHolding('BTC:fund', 7)]);

      const read = await bybitProvider.fetchBalances(deps, target);

      expect(pairsOf(read.balances)).toEqual([
        ['BTC:unified', 0],
        ['BTC:fund', 0],
      ]);
    });

    it('names each holding by its wallet and carries no rename', async () => {
      const deps = makeDeps([unifiedCoin('USDT', '5')], [fundCoin('USDT', '6')]);

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(read.balances).toEqual([
        {
          currency: 'USDT',
          balanceMinorUnits: 500000000,
          metadataKey: 'USDT:unified',
          name: 'Bybit Unified · USDT',
        },
        {
          currency: 'USDT',
          balanceMinorUnits: 600000000,
          metadataKey: 'USDT:fund',
          name: 'Bybit Funding · USDT',
        },
      ]);
    });

    it('keeps the two wallets of one coin apart', async () => {
      const deps = makeDeps([unifiedCoin('BTC', '1')], [fundCoin('BTC', '2')]);

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(pairsOf(read.balances)).toEqual([
        ['BTC:unified', 100000000],
        ['BTC:fund', 200000000],
      ]);
    });
  });

  describe('a coin with a borrow', () => {
    it('keeps its last balance and lists itself', async () => {
      const deps = makeDeps([
        unifiedCoin('BTC', '1', { spotBorrow: '0.5' }),
        unifiedCoin('ETH', '2', { borrowAmount: '0.1' }),
        unifiedCoin('USDT', '3'),
      ]);
      const target = freshTarget([
        heldHolding('BTC:unified', 5),
        heldHolding('ETH:unified', 6, 'ETH'),
      ]);

      const read = await bybitProvider.fetchBalances(deps, target);

      expect(keysOf(read)).toEqual(['USDT:unified']);
      expect(read.exchangeState).toContainEqual({
        kind: 'balanceNotes',
        wallets: { unified: { borrowed: ['BTC', 'ETH'], openOrder: [] }, fund: { borrowed: [] } },
        refused: [],
      });
    });
  });

  describe('a coin with an open order', () => {
    it('keeps its last balance and lists itself', async () => {
      const deps = makeDeps([
        unifiedCoin('BTC', '1', { locked: '0.5' }),
        unifiedCoin('ETH', '0', { locked: '2' }),
        unifiedCoin('SOL', '4', { locked: 'unknown' }),
        unifiedCoin('USDT', '3'),
      ]);
      const target = freshTarget([
        heldHolding('BTC:unified', 5),
        heldHolding('ETH:unified', 6, 'ETH'),
        heldHolding('SOL:unified', 7, 'SOL'),
      ]);

      const read = await bybitProvider.fetchBalances(deps, target);

      expect(keysOf(read)).toEqual(['USDT:unified']);
      expect(read.exchangeState).toContainEqual({
        kind: 'balanceNotes',
        wallets: {
          unified: { borrowed: [], openOrder: ['BTC', 'ETH', 'SOL'] },
          fund: { borrowed: [] },
        },
        refused: [],
      });
    });

    it('on a first sync creates no holding and lists itself', async () => {
      const deps = makeDeps([
        unifiedCoin('BTC', '1', { locked: '0.5' }),
        unifiedCoin('USD', '5', { locked: '1' }),
      ]);

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(read.balances).toEqual([]);
      expect(read.exchangeState).toContainEqual({
        kind: 'balanceNotes',
        wallets: { unified: { borrowed: [], openOrder: ['BTC', 'USD'] }, fund: { borrowed: [] } },
        refused: [],
      });
    });

    it('writes the other coins of the wallet and the same coin of FUND as usual', async () => {
      const deps = makeDeps(
        [unifiedCoin('BTC', '1', { locked: '0.5' }), unifiedCoin('ETH', '2')],
        [fundCoin('BTC', '3')],
      );

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(pairsOf(read.balances)).toEqual([
        ['ETH:unified', 200000000],
        ['BTC:fund', 300000000],
      ]);
    });
  });

  describe('a coin below its dust threshold', () => {
    it('creates no holding', async () => {
      const deps = makeDeps([unifiedCoin('BTC', '0.00000999')], [fundCoin('BTC', '0.00000999')]);

      expect(keysOf(await bybitProvider.fetchBalances(deps, freshTarget()))).toEqual([]);
    });
  });

  describe('the dust threshold', () => {
    it('creates a holding for a coin exactly at its dust threshold', async () => {
      const deps = makeDeps([unifiedCoin('BTC', '0.00001')], [fundCoin('ETH', '0.0004')]);

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(keysOf(read)).toEqual(['BTC:unified', 'ETH:fund']);
    });

    it('writes a held coin below its dust threshold, zero included', async () => {
      const deps = makeDeps([unifiedCoin('BTC', '0.00000999')], [fundCoin('ETH', '0')]);
      const target = freshTarget([
        heldHolding('BTC:unified', 5),
        heldHolding('ETH:fund', 6, 'ETH'),
      ]);

      const read = await bybitProvider.fetchBalances(deps, target);

      expect(pairsOf(read.balances)).toEqual([
        ['BTC:unified', 999],
        ['ETH:fund', 0],
      ]);
    });

    it('creates a fiat holding for any balance above zero', async () => {
      const deps = makeDeps([unifiedCoin('USD', '0.01'), unifiedCoin('EUR', '0')]);

      expect(keysOf(await bybitProvider.fetchBalances(deps, freshTarget()))).toEqual([
        'USD:unified',
      ]);
    });
  });

  describe('what a log may carry', () => {
    it('names no coin, no amount and no key of a skipped wallet or a refused coin', async () => {
      const deps = makeDeps([unifiedCoin('BTC', 'lots'), unifiedCoin('ETH', '2')]);
      deps.fetchFundBalance.mockRejectedValue(new BybitRefusalError('permission', 10005));
      deps.fetchKeyInfo.mockRejectedValue(new TypeError('Network request failed'));

      await bybitProvider.fetchBalances(deps, freshTarget());

      const logged = JSON.stringify(warn.mock.calls);

      expect(warn).toHaveBeenCalled();
      expect(logged).toContain('unified');
      expect(logged).not.toMatch(/BTC|ETH|lots|api-key|secret/i);
    });
  });
});
