import { DAY_MS } from '@kiko/dates';
import { i18n } from '@kiko/i18n/init';

import { bybitKeyRefusalOf } from './bybit.key-check';
import { API_KEY, NOW, SECRET } from './bybit.client-test-fixtures';
import { okAnswer, refusalAnswer } from './bybit.provider-test-fixtures';
import { KEY_CHECK_PATHS, KEY_INFO_RESULT, keyCheckFetch } from './bybit.key-check-test-fixtures';

const refusalWith = (answers: Parameters<typeof keyCheckFetch>[0]) => {
  const { fetchImpl, asked } = keyCheckFetch(answers);

  return {
    asked,
    refusal: bybitKeyRefusalOf(API_KEY, SECRET, { fetchImpl, now: () => NOW }),
  };
};

describe('bybitKeyRefusalOf', () => {
  it('reads the key and one route of each shipped kind, which makes 10 calls, and refuses nothing', async () => {
    const { asked, refusal } = refusalWith({});

    await expect(refusal).resolves.toBeUndefined();
    expect(asked.map((url) => url.pathname)).toEqual([...KEY_CHECK_PATHS]);
  });

  it('asks each history route for one row of the last day, and the convert route for its first row', async () => {
    const { asked, refusal } = refusalWith({});

    await refusal;

    const queryOf = (path: string) =>
      Object.fromEntries(asked.find((url) => url.pathname === path)?.searchParams ?? []);
    const day = { startTime: String(NOW - DAY_MS), endTime: String(NOW), limit: '1' };

    expect(queryOf('/v5/asset/deposit/query-record')).toEqual(day);
    expect(queryOf('/v5/asset/deposit/query-internal-record')).toEqual(day);
    expect(queryOf('/v5/asset/withdraw/query-record')).toEqual({ ...day, withdrawType: '2' });
    expect(queryOf('/v5/asset/transfer/query-inter-transfer-list')).toEqual(day);
    expect(queryOf('/v5/account/transaction-log')).toEqual({ ...day, accountType: 'UNIFIED' });
    expect(queryOf('/v5/asset/exchange/query-convert-history')).toEqual({
      index: '1',
      limit: '1',
    });
    expect(queryOf('/v5/asset/fundinghistory')).toEqual({
      createTimeFrom: String(Math.floor((NOW - DAY_MS) / 1000)),
      createTimeTo: String(Math.ceil(NOW / 1000)),
      limit: '1',
    });
  });

  describe('a key that is not read-only or not a main key', () => {
    it.each([
      ['a read-write key', { ...KEY_INFO_RESULT, readOnly: 0 }],
      ['a key that does not say', { ...KEY_INFO_RESULT, readOnly: undefined }],
    ])('refuses %s with the text that asks for a read-only key, after 1 call', async (_t, info) => {
      const { asked, refusal } = refusalWith({ '/v5/user/query-api': okAnswer(info) });

      await expect(refusal).resolves.toBe(i18n.t('accountDetail.bybitKeyNotReadOnly'));
      expect(asked).toHaveLength(1);
    });

    it.each([
      ['a key that is not a main key', { ...KEY_INFO_RESULT, isMaster: false }],
      ['a key that does not say', { ...KEY_INFO_RESULT, isMaster: undefined }],
    ])('refuses %s with the text that asks for a main key, after 1 call', async (_t, info) => {
      const { asked, refusal } = refusalWith({ '/v5/user/query-api': okAnswer(info) });

      await expect(refusal).resolves.toBe(i18n.t('accountDetail.bybitKeyNotMain'));
      expect(asked).toHaveLength(1);
    });

    it('names the read permission first when a key breaks both rules', async () => {
      const { refusal } = refusalWith({
        '/v5/user/query-api': okAnswer({ ...KEY_INFO_RESULT, readOnly: 0, isMaster: false }),
      });

      await expect(refusal).resolves.toBe(i18n.t('accountDetail.bybitKeyNotReadOnly'));
    });
  });

  describe('a refusal of a route', () => {
    it.each(KEY_CHECK_PATHS.slice(1).map((path, index) => [path, index + 2] as const))(
      'refuses a key that route %s answers with 10005, with one remedy, after %i calls',
      async (path, calls) => {
        const { asked, refusal } = refusalWith({ [path]: refusalAnswer(10005) });

        await expect(refusal).resolves.toBe(i18n.t('accountDetail.bybitKeyMissingPermission'));
        expect(asked).toHaveLength(calls);
      },
    );

    it('shows the text that names a wrong key, with Bybit EU as not supported, for a rejected key', async () => {
      const { refusal } = refusalWith({ '/v5/user/query-api': refusalAnswer(10003) });
      const text = await refusal;

      expect(text).toBe(i18n.t('accountDetail.bybitKeyRejected'));
      expect(text).toContain('does not support Bybit EU accounts');
      expect(text).toContain('a key from another regional site may not be accepted here');
    });

    it.each([
      [
        'a compliance refusal',
        refusalAnswer(10024),
        () => i18n.t('accountDetail.bybitComplianceRefused'),
      ],
      ['an HTTP 403', { status: 403 }, () => i18n.t('accountDetail.bybitForbidden')],
      ['a rate code', refusalAnswer(10006), () => i18n.t('accountDetail.bybitRateLimited')],
      ['an HTTP 429', { status: 429 }, () => i18n.t('accountDetail.bybitRateLimited')],
      [
        'an unknown code',
        refusalAnswer(99999),
        () => i18n.t('accountDetail.bybitRequestFailed', { code: 99999 }),
      ],
    ])('shows the text of the refusal table for %s on a route', async (_t, answer, text) => {
      const { refusal } = refusalWith({ '/v5/asset/withdraw/query-record': answer });

      await expect(refusal).resolves.toBe(text());
    });

    it('shows the failed-request text for a lost network, which names no code', async () => {
      const lost = (async () => {
        throw new TypeError('Network request failed');
      }) as unknown as typeof fetch;

      await expect(
        bybitKeyRefusalOf(API_KEY, SECRET, { fetchImpl: lost, now: () => NOW }),
      ).resolves.toBe(i18n.t('accountDetail.bybitRequestFailedNoCode'));
    });

    it('does not refuse a key for a route that answers in a shape this client cannot read', async () => {
      const { refusal } = refusalWith({
        '/v5/asset/deposit/query-record': okAnswer({ unexpected: true }),
        '/v5/asset/fundinghistory': okAnswer(undefined),
      });

      await expect(refusal).resolves.toBeUndefined();
    });
  });
});
