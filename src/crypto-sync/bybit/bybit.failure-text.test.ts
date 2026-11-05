import { i18n } from '@kiko/i18n/init';
import { act } from '@testing-library/react-native';

import { bybitFailureOf } from './bybit.failure-text';
import { BybitRateLimitError, BybitRefusalError } from './bybit.client';

const textOf = (error: unknown): string => (error instanceof Error ? error.message : '');

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

  it('shows the text that fits both reasons for an HTTP 403, and its ten minute wait', () => {
    const text = textOf(bybitFailureOf(new BybitRateLimitError(403, 600_000)));

    expect(text).toBe(i18n.t('accountDetail.bybitForbidden'));
    expect(text).toContain('too many requests');
    expect(text).toContain('does not serve your current network location');
    expect(text).toContain('10 minutes');
  });

  it.each([
    [10006, 60_000],
    [10018, 60_000],
    [429, 60_000],
  ])('shows the generic text with the code for the rate refusal %i', (code, wait) => {
    expect(textOf(bybitFailureOf(new BybitRateLimitError(code, wait)))).toBe(
      i18n.t('accountDetail.bybitRequestFailed', { code }),
    );
  });

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
  });
});
