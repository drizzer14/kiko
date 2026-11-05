import { createHmac } from 'node:crypto';

import {
  BybitRateLimitError,
  BybitRefusalError,
  type BybitReadOptions,
  type BybitRefusalClass,
  fetchKeyInfo,
  signedBybitGet,
} from './bybit.client';
import {
  API_KEY,
  NOW,
  SECRET,
  SERVER_TEXT,
  answerWith,
  envelopeOf,
} from './bybit.client-test-fixtures';
import { isBybitCoolingDown } from './bybit.cooldown';

const RESET_HEADER = 'X-Bapi-Limit-Reset-Timestamp';
const TEN_MINUTES_MS = 600_000;
const ONE_MINUTE_MS = 60_000;

// HMAC-SHA256 by Node's own implementation, so the expectation does not share code with the client.
const signatureOf = (text: string): string =>
  createHmac('sha256', SECRET).update(text).digest('hex');

const readWith = (answer: Parameters<typeof answerWith>[0], options: BybitReadOptions = {}) => {
  const { fetchImpl, sent } = answerWith(answer);

  return {
    sent,
    result: signedBybitGet(
      API_KEY,
      SECRET,
      '/v5/account/wallet-balance',
      { accountType: 'UNIFIED' },
      { fetchImpl, now: () => NOW, ...options },
    ),
  };
};

describe('signedBybitGet', () => {
  it('sends a GET with the key, the timestamp, the recv window and the signature, and no-store', async () => {
    const { sent, result } = readWith({ body: envelopeOf(0, { list: [] }) });

    await result;

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://api.bybit.com/v5/account/wallet-balance?accountType=UNIFIED');
    expect(sent[0].init).toEqual({
      method: 'GET',
      headers: {
        'X-BAPI-API-KEY': API_KEY,
        'X-BAPI-TIMESTAMP': String(NOW),
        'X-BAPI-RECV-WINDOW': '5000',
        'X-BAPI-SIGN': signatureOf(`${NOW}${API_KEY}5000accountType=UNIFIED`),
        'Cache-Control': 'no-store',
      },
    });
  });

  it('signs the timestamp, the key, the recv window and the query, in that order', async () => {
    const { sent, result } = readWith({ body: envelopeOf(0, {}) });

    await result;

    expect(sent[0].init.headers['X-BAPI-SIGN']).toBe(
      '190dd16d16710efcb04d6764167bd7105f27fd4bbf37a63ac03db2965fa3b0a1',
    );
  });

  it('sends a request without a query as the bare path and signs the empty query', async () => {
    const { fetchImpl, sent } = answerWith({ body: envelopeOf(0, {}) });

    await signedBybitGet(API_KEY, SECRET, '/v5/user/query-api', {}, { fetchImpl, now: () => NOW });

    expect(sent[0].url).toBe('https://api.bybit.com/v5/user/query-api');
    expect(sent[0].init.headers['X-BAPI-SIGN']).toBe(signatureOf(`${NOW}${API_KEY}5000`));
  });

  it('keeps the secret, the key and the signature out of the URL', async () => {
    const { sent, result } = readWith({ body: envelopeOf(0, {}) });

    await result;

    expect(sent[0].url).not.toContain(SECRET);
    expect(sent[0].url).not.toContain(API_KEY);
    expect(sent[0].url).not.toContain(sent[0].init.headers['X-BAPI-SIGN']);
  });

  it('returns the result of a body with code 0', async () => {
    const { result } = readWith({ body: envelopeOf(0, { list: ['row'] }) });

    await expect(result).resolves.toEqual({ list: ['row'] });
  });

  it('reads the code before the HTTP status', async () => {
    await expect(readWith({ body: envelopeOf(10003), status: 200 }).result).rejects.toMatchObject({
      refusal: 'rejected',
    });
    await expect(readWith({ body: envelopeOf(10002), status: 401 }).result).rejects.toMatchObject({
      refusal: 'clock',
    });
    await expect(readWith({ body: envelopeOf(10005), status: 403 }).result).rejects.toMatchObject({
      refusal: 'permission',
    });
  });

  it('never carries the server text into what it throws', async () => {
    const failure: unknown = await readWith({ body: envelopeOf(10005) }).result.catch(
      (error) => error,
    );

    expect(failure).toBeInstanceOf(BybitRefusalError);
    expect(`${String(failure)}${JSON.stringify(failure)}`).not.toContain(SERVER_TEXT);
  });
});

describe('the refusal classes', () => {
  it.each<[number, BybitRefusalClass]>([
    [33004, 'expired'],
    [-2015, 'expired'],
    [10003, 'rejected'],
    [81007, 'rejected'],
    [10002, 'clock'],
    [10004, 'sign'],
    [10005, 'permission'],
    [131203, 'window'],
    [10010, 'ip'],
    [10028, 'notUnified'],
    [99999, 'unknown'],
  ])('reads code %i at HTTP 200 as the %s class and keeps the code', async (code, refusal) => {
    const { result } = readWith({ body: envelopeOf(code) });

    await expect(result).rejects.toBeInstanceOf(BybitRefusalError);
    await expect(result).rejects.toMatchObject({ refusal, code });
  });

  it.each<[string, number, BybitRefusalClass]>([
    ['401', 401, 'rejected'],
    ['404', 404, 'unknown'],
    ['502', 502, 'unknown'],
  ])(
    'reads HTTP %s with a page that is not JSON by its status alone',
    async (_title, status, refusal) => {
      const { result } = readWith({ notJson: true, status });

      await expect(result).rejects.toMatchObject({ refusal, code: status });
    },
  );

  it('reads HTTP 404 with a body that has no code as unknown', async () => {
    await expect(
      readWith({ body: { error: 'not found' }, status: 404 }).result,
    ).rejects.toMatchObject({ refusal: 'unknown', code: 404 });
  });

  it('reads an answer that went through with no code as a malformed body, never a result', async () => {
    await expect(readWith({ body: { result: { list: [] } } }).result).rejects.toMatchObject({
      refusal: 'malformed',
    });
    await expect(readWith({ body: 'text' }).result).rejects.toMatchObject({
      refusal: 'malformed',
    });
    await expect(readWith({ notJson: true }).result).rejects.toMatchObject({
      refusal: 'malformed',
    });
  });

  it('does not read a code that is not a number', async () => {
    await expect(readWith({ body: { retCode: '0', result: {} } }).result).rejects.toMatchObject({
      refusal: 'malformed',
    });
  });

  it('is a named error with a fixed message', async () => {
    const failure: unknown = await readWith({ body: envelopeOf(10004) }).result.catch(
      (error) => error,
    );

    expect(failure).toMatchObject({ name: 'BybitRefusalError', message: 'Bybit refusal' });
    expect(new BybitRefusalError('expired', 33004).refusal).toBe('expired');
  });

  it('a window refusal at HTTP 200 reads as the window class, a code fault', async () => {
    await expect(readWith({ body: envelopeOf(131203), status: 200 }).result).rejects.toMatchObject({
      refusal: 'window',
      code: 131203,
    });
  });
});

describe('a refusal past the stored date', () => {
  const PAST = NOW - 1_000;
  const FUTURE = NOW + 1_000;

  it.each<[string, Parameters<typeof answerWith>[0]]>([
    ['33004', { body: envelopeOf(33004) }],
    ['-2015', { body: envelopeOf(-2015) }],
    ['10003', { body: envelopeOf(10003) }],
    ['81007', { body: envelopeOf(81007) }],
    ['HTTP 401', { notJson: true, status: 401 }],
    ['an unknown code', { body: envelopeOf(99999) }],
    ['an unknown status', { notJson: true, status: 502 }],
  ])('every refusal past the stored date is the expired class: %s', async (_title, answer) => {
    await expect(readWith(answer, { expiredAtMs: PAST }).result).rejects.toMatchObject({
      refusal: 'expired',
    });
  });

  it.each<[string, Parameters<typeof answerWith>[0], BybitRefusalClass]>([
    ['10003', { body: envelopeOf(10003) }, 'rejected'],
    ['81007', { body: envelopeOf(81007) }, 'rejected'],
    ['HTTP 401', { notJson: true, status: 401 }, 'rejected'],
    ['an unknown code', { body: envelopeOf(99999) }, 'unknown'],
  ])('keeps %s as it is before the stored date', async (_title, answer, refusal) => {
    await expect(readWith(answer, { expiredAtMs: FUTURE }).result).rejects.toMatchObject({
      refusal,
    });
  });

  it.each<[number, BybitRefusalClass]>([
    [10002, 'clock'],
    [10004, 'sign'],
    [10005, 'permission'],
    [131203, 'window'],
    [10010, 'ip'],
    [10028, 'notUnified'],
  ])('keeps code %i as the %s class after the stored date', async (code, refusal) => {
    await expect(
      readWith({ body: envelopeOf(code) }, { expiredAtMs: PAST }).result,
    ).rejects.toMatchObject({ refusal });
  });

  it('keeps a code that always means expired, with or without a stored date', async () => {
    await expect(readWith({ body: envelopeOf(33004) }).result).rejects.toMatchObject({
      refusal: 'expired',
    });
    await expect(
      readWith({ body: envelopeOf(33004) }, { expiredAtMs: FUTURE }).result,
    ).rejects.toMatchObject({ refusal: 'expired' });
  });

  it('reads the instant of the stored date as the end of the key', async () => {
    const { result } = readWith({ body: envelopeOf(10003) }, { expiredAtMs: NOW });

    await expect(result).rejects.toMatchObject({ refusal: 'expired' });
  });

  it.each<[string, number]>([
    ['not a number', Number.NaN],
    ['the epoch', 0],
    ['before the epoch', -1],
  ])('reads a stored date that is %s as no date', async (_title, expiredAtMs) => {
    await expect(
      readWith({ body: envelopeOf(10003) }, { expiredAtMs }).result,
    ).rejects.toMatchObject({ refusal: 'rejected' });
  });

  it('does not turn a body that is malformed into an expiry', async () => {
    await expect(
      readWith({ body: { result: {} } }, { expiredAtMs: PAST }).result,
    ).rejects.toMatchObject({ refusal: 'malformed' });
  });

  it('applies the stored date on the key info read of a connected key', async () => {
    const { fetchImpl } = answerWith({ body: envelopeOf(10003) });

    await expect(
      fetchKeyInfo(API_KEY, SECRET, { fetchImpl, now: () => NOW, expiredAtMs: PAST }),
    ).rejects.toMatchObject({ refusal: 'expired' });
  });
});

describe('the rate refusals', () => {
  it.each([10006, 10018])(
    'a rate refusal in the body sets the cooldown from the reset header: code %i',
    async (code) => {
      const accountId = `acc-rate-${code}`;
      const { result } = readWith(
        { body: envelopeOf(code), headers: { [RESET_HEADER]: String(NOW + 4_000) } },
        { accountId },
      );

      await expect(result).rejects.toBeInstanceOf(BybitRateLimitError);
      await expect(result).rejects.toMatchObject({ code, retryAfterMs: 4_000 });
      expect(isBybitCoolingDown(accountId, NOW + 3_999)).toBe(true);
      expect(isBybitCoolingDown(accountId, NOW + 4_000)).toBe(false);
    },
  );

  it.each<[string, Record<string, string>]>([
    ['absent', {}],
    ['not a number', { [RESET_HEADER]: 'soon' }],
    ['not after now', { [RESET_HEADER]: String(NOW) }],
    ['already past', { [RESET_HEADER]: String(NOW - 5_000) }],
    ['further off than the longest cooldown', { [RESET_HEADER]: String(NOW + TEN_MINUTES_MS + 1) }],
  ])('falls back to one minute when the reset header is %s', async (title, headers) => {
    const accountId = `acc-fallback-${title}`;
    const { result } = readWith({ body: envelopeOf(10006), headers }, { accountId });

    await expect(result).rejects.toMatchObject({ code: 10006, retryAfterMs: ONE_MINUTE_MS });
    expect(isBybitCoolingDown(accountId, NOW + ONE_MINUTE_MS - 1)).toBe(true);
    expect(isBybitCoolingDown(accountId, NOW + ONE_MINUTE_MS)).toBe(false);
  });

  it('accepts a reset header exactly as far off as the longest cooldown', async () => {
    const { result } = readWith({
      body: envelopeOf(10018),
      headers: { [RESET_HEADER]: String(NOW + TEN_MINUTES_MS) },
    });

    await expect(result).rejects.toMatchObject({ retryAfterMs: TEN_MINUTES_MS });
  });

  it('a 403 sets a ten minute cooldown, from a page that is not JSON', async () => {
    const accountId = 'acc-forbidden';
    const { result } = readWith({ notJson: true, status: 403 }, { accountId });

    await expect(result).rejects.toBeInstanceOf(BybitRateLimitError);
    await expect(result).rejects.toMatchObject({ code: 403, retryAfterMs: TEN_MINUTES_MS });
    expect(isBybitCoolingDown(accountId, NOW + TEN_MINUTES_MS - 1)).toBe(true);
    expect(isBybitCoolingDown(accountId, NOW + TEN_MINUTES_MS)).toBe(false);
  });

  it('a 403 ignores the reset header', async () => {
    const { result } = readWith({
      notJson: true,
      status: 403,
      headers: { [RESET_HEADER]: String(NOW + 4_000) },
    });

    await expect(result).rejects.toMatchObject({ retryAfterMs: TEN_MINUTES_MS });
  });

  it('throws the rate error without a cooldown when it is given no account', async () => {
    const { result } = readWith({ body: envelopeOf(10006) });

    await expect(result).rejects.toMatchObject({ code: 10006 });
    expect(isBybitCoolingDown('acc-never-given', NOW)).toBe(false);
  });

  it('sets no cooldown for a refusal that is not a rate refusal', async () => {
    const accountId = 'acc-other-refusal';

    await expect(
      readWith({ body: envelopeOf(10005) }, { accountId }).result,
    ).rejects.toBeInstanceOf(BybitRefusalError);
    expect(isBybitCoolingDown(accountId, NOW)).toBe(false);
  });

  it('is a named error with a fixed message and its code', () => {
    const failure = new BybitRateLimitError(10006, 4_000);

    expect(failure.name).toBe('BybitRateLimitError');
    expect(failure.message).toBe('Bybit rate limit');
    expect(failure).toMatchObject({ code: 10006, retryAfterMs: 4_000 });
    expect(failure).toBeInstanceOf(Error);
  });
});
