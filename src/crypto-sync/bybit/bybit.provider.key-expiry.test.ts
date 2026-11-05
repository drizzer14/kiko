import { i18n } from '@kiko/i18n/init';
import * as Keychain from 'react-native-keychain';

import {
  KEY_INFO_PATH,
  UNIFIED_PATH,
  freshTarget,
  makeDeps,
  okAnswer,
  refusalAnswer,
  routedDeps,
  stateAfter,
} from './bybit.provider-test-fixtures';
import { bybitProvider } from './bybit.provider';
import { NOW } from './bybit.client-test-fixtures';
import { BybitRateLimitError, BybitRefusalError } from './bybit.client';
import { unifiedCoin, unifiedResult } from './bybit.balance-test-fixtures';

// The credentials module imports react-native-keychain, whose native binding is absent under Jest;
// the two writers are doubles so a test can show that a sync calls neither.
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

const END = Date.UTC(2027, 1, 4, 16, 54, 0);
const RENEWED_END = Date.UTC(2027, 4, 5, 16, 54, 0);

const keyInfoOf = (expiredAtMs: number | undefined, deadlineDay: number | undefined) => ({
  expiredAtMs,
  deadlineDay,
  readOnly: 1,
  isMaster: true,
});

let warn: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('the key expiry a Bybit balance read returns', () => {
  it('stores the end, the days left and the time of the read', async () => {
    const deps = makeDeps();
    deps.fetchKeyInfo.mockResolvedValue(keyInfoOf(END, 91));

    const read = await bybitProvider.fetchBalances(deps, freshTarget());

    expect(stateAfter(read).keyExpiry).toEqual({
      expiredAtMs: END,
      deadlineDay: 91,
      readAtMs: NOW,
    });
  });

  it('stores the time of the read alone when the key gave no date', async () => {
    const deps = makeDeps();
    deps.fetchKeyInfo.mockResolvedValue(keyInfoOf(undefined, undefined));

    const read = await bybitProvider.fetchBalances(deps, freshTarget());

    expect(stateAfter(read).keyExpiry).toEqual({ readAtMs: NOW });
  });

  it('a renewed key moves the stored date and writes no Keychain item', async () => {
    const deps = makeDeps([unifiedCoin('BTC', '1')]);
    const target = freshTarget();
    deps.fetchKeyInfo.mockResolvedValueOnce(keyInfoOf(END, 5));
    deps.fetchKeyInfo.mockResolvedValueOnce(keyInfoOf(RENEWED_END, 90));

    const before = stateAfter(await bybitProvider.fetchBalances(deps, target));
    const after = stateAfter(await bybitProvider.fetchBalances(deps, target), before);

    expect(before.keyExpiry).toEqual({ expiredAtMs: END, deadlineDay: 5, readAtMs: NOW });
    expect(after.keyExpiry).toEqual({ expiredAtMs: RENEWED_END, deadlineDay: 90, readAtMs: NOW });
    expect(deps.readCredentials).toHaveBeenCalledTimes(2);
    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
    expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
  });

  it('returns no state, so the stored entry stays, when the key check was refused for its rate', async () => {
    const deps = makeDeps([unifiedCoin('BTC', '1')]);
    deps.fetchKeyInfo.mockRejectedValue(new BybitRateLimitError(10006, 60_000));

    await expect(bybitProvider.fetchBalances(deps, freshTarget())).rejects.toThrow(
      i18n.t('accountDetail.bybitRequestFailed', { code: 10006 }),
    );
  });

  it.each([
    ['a malformed answer', new BybitRefusalError('malformed')],
    ['an unknown refusal', new BybitRefusalError('unknown', 99999)],
    ['a compliance refusal', new BybitRefusalError('compliance', 10024)],
    ['a lost network', new TypeError('Network request failed')],
  ])(
    'writes no entry when the key check failed with %s, so the stored one stays',
    async (_t, failure) => {
      const deps = makeDeps([unifiedCoin('BTC', '1')]);
      deps.fetchKeyInfo.mockRejectedValue(failure);
      const stored = { expiredAtMs: END, deadlineDay: 5, readAtMs: 1_000 };

      const read = await bybitProvider.fetchBalances(deps, freshTarget());

      expect(read.exchangeState?.map(({ kind }) => kind)).not.toContain('keyExpiry');
      expect(stateAfter(read, { keyExpiry: stored }).keyExpiry).toEqual(stored);
    },
  );

  it('reads the date of a real key-info answer, whatever else the answer holds', async () => {
    const { deps } = routedDeps({
      [KEY_INFO_PATH]: okAnswer({
        expiredAt: '2027-02-04T16:54:00Z',
        deadlineDay: 91,
        userID: 'S',
      }),
      [UNIFIED_PATH]: okAnswer(unifiedResult([])),
      '/v5/asset/transfer/query-account-coins-balance': okAnswer({ balance: [] }),
    });

    const read = await bybitProvider.fetchBalances(deps, freshTarget());

    expect(stateAfter(read).keyExpiry).toEqual({
      expiredAtMs: END,
      deadlineDay: 91,
      readAtMs: NOW,
    });
  });
});

describe('the stored end of the key on every read', () => {
  it.each(['fetchKeyInfo', 'fetchUnifiedBalance', 'fetchFundBalance'] as const)(
    'reaches %s as the date a refusal is read against',
    async (read) => {
      const deps = makeDeps();
      const target = freshTarget();
      deps.readExpiredAtMs.mockResolvedValue(END);

      await bybitProvider.fetchBalances(deps, target);

      expect(deps.readExpiredAtMs).toHaveBeenCalledWith(target.accountId);
      expect(deps[read]).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
        fetchImpl: deps.fetchImpl,
        now: deps.now,
        accountId: target.accountId,
        expiredAtMs: END,
      });
    },
  );

  it.each([
    ['past the stored date', NOW - 1, 'accountDetail.bybitKeyRefusedExpired'],
    ['before the stored date', NOW + 1, 'accountDetail.bybitKeyRefused'],
    ['with no stored date', undefined, 'accountDetail.bybitKeyRefused'],
  ] as const)(
    'shows a key refused with code 10003 %s as the text of its class',
    async (_t, end, key) => {
      const { deps } = routedDeps({
        [KEY_INFO_PATH]: refusalAnswer(10003),
        [UNIFIED_PATH]: refusalAnswer(10003),
      });

      await expect(
        bybitProvider.fetchBalances({ ...deps, readExpiredAtMs: async () => end }, freshTarget()),
      ).rejects.toThrow(i18n.t(key));
    },
  );

  it('sends no date option when none is stored', async () => {
    const deps = makeDeps();

    await bybitProvider.fetchBalances(deps, freshTarget());

    expect(deps.fetchKeyInfo.mock.calls[0]?.[2]).not.toHaveProperty('expiredAtMs');
  });
});
