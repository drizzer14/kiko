import { i18n } from '@kiko/i18n/init';
import { act } from '@testing-library/react-native';

import { BybitRateLimitError, BybitRefusalError } from './bybit.client';
import { bybitConnectFailureText, bybitFailureOf } from './bybit.failure-text';

const textOf = (error: unknown): string => (error instanceof Error ? error.message : '');

describe('bybitConnectFailureText', () => {
  it('names a wrong key, and Bybit EU as not supported, for a rejected key', () => {
    expect(bybitConnectFailureText(new BybitRefusalError('rejected', 10003))).toBe(
      i18n.t('accountDetail.bybitKeyRejected'),
    );
  });

  it.each([
    new BybitRefusalError('expired', 33004),
    new BybitRefusalError('permission', 10005),
    new BybitRefusalError('compliance', 10024),
    new BybitRateLimitError(403, 600_000),
    new BybitRateLimitError(10006, 60_000),
  ])('gives the text a sync shows for every other refusal (%#)', (refusal) => {
    expect(bybitConnectFailureText(refusal)).toBe(textOf(bybitFailureOf(refusal)));
  });

  it('gives the failed-request text, with no code, for an error that is no Bybit refusal', () => {
    expect(bybitConnectFailureText(new TypeError('Network request failed'))).toBe(
      i18n.t('accountDetail.bybitRequestFailedNoCode'),
    );
  });
});

describe('bybitFailureOf', () => {
  it.each([
    ['expired', 33004, 'accountDetail.bybitKeyRefusedExpired', {}],
    ['rejected', 10003, 'accountDetail.bybitKeyRefused', {}],
    ['clock', 10002, 'accountDetail.bybitClockOff', {}],
    ['permission', 10005, 'accountDetail.bybitKeyMissingPermission', {}],
    ['malformed', undefined, 'accountDetail.bybitMissingBalances', {}],
    ['sign', 10004, 'accountDetail.bybitRequestFailed', { code: 10004 }],
    ['window', 131203, 'accountDetail.bybitRequestFailed', { code: 131203 }],
    ['ip', 10010, 'accountDetail.bybitRequestFailed', { code: 10010 }],
    ['compliance', 10024, 'accountDetail.bybitComplianceRefused', {}],
    ['notUnified', 10028, 'accountDetail.bybitRequestFailed', { code: 10028 }],
    ['unknown', 99999, 'accountDetail.bybitRequestFailed', { code: 99999 }],
  ] as const)('gives the %s class its own text', (refusal, code, key, values) => {
    expect(textOf(bybitFailureOf(new BybitRefusalError(refusal, code)))).toBe(i18n.t(key, values));
  });

  it('shows a refusal past the stored date, a rejection, and a forbidden answer as three texts', () => {
    const texts = [
      bybitFailureOf(new BybitRefusalError('expired', 33004)),
      bybitFailureOf(new BybitRefusalError('rejected', 10003)),
      bybitFailureOf(new BybitRateLimitError(403, 600_000)),
    ].map(textOf);

    expect(new Set(texts).size).toBe(3);
  });

  it('shows the text that fits both reasons for an HTTP 403, and its longest wait', () => {
    const text = textOf(bybitFailureOf(new BybitRateLimitError(403, 600_000)));

    expect(text).toBe(i18n.t('accountDetail.bybitForbidden'));
    expect(text).toContain('too many requests');
    expect(text).toContain('does not serve your current network location');
    expect(text).toContain('Kiko waits before trying again, up to 10 minutes.');
  });

  it.each([
    [10006, 60_000],
    [10018, 60_000],
    [429, 60_000],
  ])(
    'shows the wait-a-few-minutes text, not a bare code, for the rate refusal %i',
    (code, wait) => {
      const text = textOf(bybitFailureOf(new BybitRateLimitError(code, wait)));

      expect(text).toBe(i18n.t('accountDetail.bybitRateLimited'));
      expect(text).not.toContain(String(code));
      expect(text).not.toContain('Kiko waits');
    },
  );

  it.each([
    [10006, 60_000],
    [10018, 60_000],
    [429, 60_000],
  ])(
    'shows that text at connect for the rate refusal %i, which sets no cooldown there',
    (code, wait) => {
      expect(bybitConnectFailureText(new BybitRateLimitError(code, wait))).toBe(
        i18n.t('accountDetail.bybitRateLimited'),
      );
    },
  );

  it('shows the forbidden text at connect for an HTTP 403', () => {
    expect(bybitConnectFailureText(new BybitRateLimitError(403, 600_000))).toBe(
      i18n.t('accountDetail.bybitForbidden'),
    );
  });

  it.each(['sign', 'window', 'ip', 'notUnified', 'unknown'] as const)(
    'shows a generic text with no dangling code for the %s class with no code',
    (refusal) => {
      expect(textOf(bybitFailureOf(new BybitRefusalError(refusal, undefined)))).toBe(
        'Bybit request failed.',
      );
    },
  );

  it('leaves an error that is no Bybit refusal as it is', () => {
    const lost = new TypeError('Network request failed');

    expect(bybitFailureOf(lost)).toBe(lost);
  });

  it('puts no server text into the message', () => {
    const refusal = new BybitRefusalError('unknown', 99999);

    expect(textOf(bybitFailureOf(refusal))).not.toContain('Bybit refusal');
  });

  describe('in Ukrainian', () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('gives the text of the Ukrainian catalogue', () => {
      expect(textOf(bybitFailureOf(new BybitRefusalError('expired', 33004)))).toBe(
        i18n.t('accountDetail.bybitKeyRefusedExpired'),
      );
      expect(textOf(bybitFailureOf(new BybitRefusalError('clock', 10002)))).toContain(
        'годинник цього пристрою неточний',
      );
      expect(textOf(bybitFailureOf(new BybitRefusalError('compliance', 10024)))).toBe(
        i18n.t('accountDetail.bybitComplianceRefused'),
      );
    });

    it('gives a rate refusal the Ukrainian wait-a-few-minutes text', () => {
      expect(textOf(bybitFailureOf(new BybitRateLimitError(10006, 60_000)))).toBe(
        i18n.t('accountDetail.bybitRateLimited'),
      );
      expect(i18n.t('accountDetail.bybitRateLimited')).toContain('Зачекайте кілька хвилин');
    });

    it('gives a generic text with no dangling code when the refusal has no code', () => {
      expect(textOf(bybitFailureOf(new BybitRefusalError('unknown', undefined)))).toBe(
        'Запит до Bybit не вдався.',
      );
    });
  });
});
