import clientInfo from './__fixtures__/client-info.json';
import statement from './__fixtures__/statement.json';
import { fetchClientInfo, fetchStatement } from './monobank.client';

const makeFetch = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body, status: ok ? 200 : 429 })) as unknown as typeof fetch;

type SpyFetchInit = { headers: Record<string, string> };

describe('fetchClientInfo', () => {
  it('sends the X-Token header and returns parsed accounts and jars', async () => {
    let sentUrl = '';
    let sentHeaders: Record<string, string> = {};
    const spyFetch = (async (url: string, init: SpyFetchInit) => {
      sentUrl = url;
      sentHeaders = init.headers;
      return { ok: true, json: async () => clientInfo, status: 200 };
    }) as unknown as typeof fetch;

    const result = await fetchClientInfo('secret', spyFetch);

    expect(sentUrl).toBe('https://api.monobank.ua/personal/client-info');
    expect(sentHeaders['X-Token']).toBe('secret');
    expect(result.accounts.length).toBeGreaterThan(0);
    expect(result.accounts[0].currencyCode).toBe(980);
    expect(result.accounts[0].maskedPan[0]).toContain('*');
    expect(result.jars[0].goal).toBe(20000000);
    expect(result.clientId).toBe('3MSaMMtczs');
  });

  it('throws on a rate-limit response', async () => {
    await expect(fetchClientInfo('secret', makeFetch({}, false))).rejects.toThrow('429');
  });
});

describe('fetchStatement', () => {
  it('sends the X-Token header, builds the windowed path, and returns typed items', async () => {
    let sentUrl = '';
    let sentHeaders: Record<string, string> = {};
    const spyFetch = (async (url: string, init: SpyFetchInit) => {
      sentUrl = url;
      sentHeaders = init.headers;
      return { ok: true, json: async () => statement, status: 200 };
    }) as unknown as typeof fetch;

    const result = await fetchStatement('secret', 'acc-1', 1704067200, 1704240000, spyFetch);

    expect(sentUrl).toBe('https://api.monobank.ua/personal/statement/acc-1/1704067200/1704240000');
    expect(sentHeaders['X-Token']).toBe('secret');
    expect(result.length).toBe(3);
    expect(result.some((item) => item.amount < 0)).toBe(true);
    expect(result.some((item) => item.amount > 0)).toBe(true);
    expect(result[0].id).toBe('ZuHWzqkKGVo=');
  });

  it('throws on a rate-limit response', async () => {
    await expect(
      fetchStatement('secret', 'acc-1', 1704067200, 1704240000, makeFetch({}, false)),
    ).rejects.toThrow('429');
  });
});
