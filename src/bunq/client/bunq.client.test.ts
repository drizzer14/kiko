import type { BunqCrypto } from '../bunq.types';

import {
  BUNQ_SANDBOX_TEST_SIGNATURE,
  BunqRateLimitError,
  BunqTimeoutError,
  fetchMonetaryAccounts,
  fetchPayments,
  installClient,
  openSession,
  registerDevice,
} from './bunq.client';

const mockCrypto: BunqCrypto = {
  generateKeyPair: jest.fn(async () => ({
    privateKeyPem: 'private-key-fixture',
    publicKeyPem: 'public-key-fixture',
  })),
  sign: jest.fn(async () => 'signature-fixture'),
};

beforeEach(() => {
  jest.clearAllMocks();
});

const installationEnvelope = {
  Response: [
    { Id: { id: 1 } },
    { Token: { id: 2, token: 'installation-token-fixture' } },
    { ServerPublicKey: { server_public_key: 'server-public-key-fixture' } },
  ],
};

const deviceEnvelope = { Response: [{ Id: { id: 42 } }] };

const sessionEnvelope = {
  Response: [
    { Id: { id: 3 } },
    { Token: { id: 4, token: 'session-token-fixture' } },
    { UserPerson: { id: 99, session_timeout: 900 } },
  ],
};

const makeFetch = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body, status: ok ? 200 : 500 })) as unknown as typeof fetch;

type SpyFetchInit = { headers?: Record<string, string>; body?: string };

describe('installClient', () => {
  it('generates a keypair, posts it with no auth header, and returns the installation token + keypair', async () => {
    let sentUrl = '';
    let sentInit: SpyFetchInit = {};
    const spyFetch = (async (url: string, init: SpyFetchInit) => {
      sentUrl = url;
      sentInit = init;
      return { ok: true, status: 200, json: async () => installationEnvelope };
    }) as unknown as typeof fetch;

    const result = await installClient(mockCrypto, spyFetch);

    expect(mockCrypto.generateKeyPair).toHaveBeenCalledTimes(1);
    expect(sentUrl).toContain('/installation');
    expect(JSON.parse(sentInit.body ?? '{}')).toEqual({ client_public_key: 'public-key-fixture' });
    expect(sentInit.headers).not.toHaveProperty('X-Bunq-Client-Authentication');
    expect(result).toEqual({
      installationToken: 'installation-token-fixture',
      privateKeyPem: 'private-key-fixture',
      publicKeyPem: 'public-key-fixture',
    });
  });

  it('throws when the response carries no Token entry', async () => {
    await expect(
      installClient(mockCrypto, makeFetch({ Response: [{ Id: { id: 1 } }] })),
    ).rejects.toThrow(/API key/i);
  });

  it('throws on a non-ok, non-429 response', async () => {
    await expect(installClient(mockCrypto, makeFetch({}, false))).rejects.toThrow('500');
  });
});

describe('registerDevice', () => {
  it('sends the installation token as the client-authentication header and the API key as the secret', async () => {
    let sentUrl = '';
    let sentInit: SpyFetchInit = {};
    const spyFetch = (async (url: string, init: SpyFetchInit) => {
      sentUrl = url;
      sentInit = init;
      return { ok: true, status: 200, json: async () => deviceEnvelope };
    }) as unknown as typeof fetch;

    const deviceId = await registerDevice(
      'installation-token-fixture',
      'api-key-fixture',
      spyFetch,
    );

    expect(sentUrl).toContain('/device-server');
    expect(sentInit.headers?.['X-Bunq-Client-Authentication']).toBe('installation-token-fixture');
    expect(JSON.parse(sentInit.body ?? '{}').secret).toBe('api-key-fixture');
    expect(deviceId).toBe('42');
  });

  it('throws when the response carries no Id entry', async () => {
    await expect(registerDevice('token', 'key', makeFetch({ Response: [] }))).rejects.toThrow(
      /API key/i,
    );
  });
});

describe('openSession', () => {
  it('signs the request body with the injected crypto and sends the signature header', async () => {
    let sentInit: SpyFetchInit = {};
    const spyFetch = (async (_url: string, init: SpyFetchInit) => {
      sentInit = init;
      return { ok: true, status: 200, json: async () => sessionEnvelope };
    }) as unknown as typeof fetch;

    const result = await openSession(
      {
        installationToken: 'installation-token-fixture',
        apiKey: 'api-key-fixture',
        privateKeyPem: 'private-key-fixture',
        crypto: mockCrypto,
      },
      spyFetch,
    );

    expect(mockCrypto.sign).toHaveBeenCalledWith(
      'private-key-fixture',
      JSON.stringify({ secret: 'api-key-fixture' }),
    );
    expect(sentInit.headers?.['X-Bunq-Client-Signature']).toBe('signature-fixture');
    expect(sentInit.headers?.['X-Bunq-Client-Authentication']).toBe('installation-token-fixture');
    expect(result).toEqual({
      sessionToken: 'session-token-fixture',
      userId: '99',
      sessionTtlSeconds: 900,
    });
  });

  it('bypasses the real signature and sends the sandbox test-signature header when requested', async () => {
    let sentInit: SpyFetchInit = {};
    const spyFetch = (async (_url: string, init: SpyFetchInit) => {
      sentInit = init;
      return { ok: true, status: 200, json: async () => sessionEnvelope };
    }) as unknown as typeof fetch;

    await openSession(
      {
        installationToken: 'installation-token-fixture',
        apiKey: 'api-key-fixture',
        privateKeyPem: 'private-key-fixture',
        crypto: mockCrypto,
        sandboxTestSignature: true,
      },
      spyFetch,
    );

    expect(mockCrypto.sign).not.toHaveBeenCalled();
    expect(sentInit.headers?.['X-Bunq-Client-Signature']).toBe(BUNQ_SANDBOX_TEST_SIGNATURE);
  });

  it('falls back to the default session TTL when the user entry carries no session_timeout', async () => {
    const envelope = {
      Response: [{ Token: { id: 4, token: 'session-token-fixture' } }, { UserPerson: { id: 99 } }],
    };

    const result = await openSession(
      {
        installationToken: 'token',
        apiKey: 'key',
        privateKeyPem: 'pem',
        crypto: mockCrypto,
      },
      makeFetch(envelope),
    );

    expect(result.sessionTtlSeconds).toBeGreaterThan(0);
  });

  it('resolves a UserCompany entry the same way as a UserPerson one', async () => {
    const envelope = {
      Response: [
        { Token: { id: 4, token: 'session-token-fixture' } },
        { UserCompany: { id: 77, session_timeout: 600 } },
      ],
    };

    const result = await openSession(
      { installationToken: 'token', apiKey: 'key', privateKeyPem: 'pem', crypto: mockCrypto },
      makeFetch(envelope),
    );

    expect(result.userId).toBe('77');
  });

  it('throws when the response carries no Token or no user entry', async () => {
    await expect(
      openSession(
        { installationToken: 'token', apiKey: 'key', privateKeyPem: 'pem', crypto: mockCrypto },
        makeFetch({ Response: [] }),
      ),
    ).rejects.toThrow(/API key/i);
  });
});

describe('fetchMonetaryAccounts', () => {
  it('reads the session token as the auth header and returns only MonetaryAccountBank entries', async () => {
    let sentUrl = '';
    let sentHeaders: Record<string, string> = {};
    const envelope = {
      Response: [
        {
          MonetaryAccountBank: {
            id: 5,
            currency: 'EUR',
            balance: { currency: 'EUR', value: '1234.56' },
            description: 'Personal',
            alias: [{ type: 'IBAN', value: 'NL00BUNQ0000000000' }],
          },
        },
        {
          MonetaryAccountSavings: {
            id: 6,
            currency: 'EUR',
            balance: { currency: 'EUR', value: '0.00' },
          },
        },
      ],
    };
    const spyFetch = (async (url: string, init: SpyFetchInit) => {
      sentUrl = url;
      sentHeaders = init.headers ?? {};
      return { ok: true, status: 200, json: async () => envelope };
    }) as unknown as typeof fetch;

    const accounts = await fetchMonetaryAccounts({ sessionToken: 'sess', userId: '99' }, spyFetch);

    expect(sentUrl).toContain('/user/99/monetary-account');
    expect(sentHeaders['X-Bunq-Client-Authentication']).toBe('sess');
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe(5);
  });
});

describe('fetchPayments', () => {
  it('sends the count param, an optional older_id cursor, and returns the next cursor from Pagination', async () => {
    let sentUrl = '';
    const envelope = {
      Response: [
        {
          Payment: {
            id: 10,
            created: '2026-01-01 10:00:00.000000',
            amount: { currency: 'EUR', value: '-1.50' },
            counterparty_alias: { iban: 'NL00BUNQ0000000001' },
          },
        },
      ],
      Pagination: { older_id: 9 },
    };
    const spyFetch = (async (url: string) => {
      sentUrl = url;
      return { ok: true, status: 200, json: async () => envelope };
    }) as unknown as typeof fetch;

    const page = await fetchPayments({ sessionToken: 'sess', userId: '99' }, '5', spyFetch, '20');

    expect(sentUrl).toContain('/user/99/monetary-account/5/payment');
    expect(sentUrl).toContain('count=200');
    expect(sentUrl).toContain('older_id=20');
    expect(page.payments).toHaveLength(1);
    expect(page.nextOlderId).toBe('9');
  });

  it('omits the next cursor when the response carries no Pagination.older_id', async () => {
    const page = await fetchPayments(
      { sessionToken: 'sess', userId: '99' },
      '5',
      makeFetch({ Response: [] }),
    );

    expect(page.nextOlderId).toBeUndefined();
  });
});

// A 429 header carrying seconds; a hit-then-clear counter drives a single retry.
const rateLimited = (retryAfter: string | null) =>
  ({
    ok: false,
    status: 429,
    headers: { get: (name: string) => (name === 'Retry-After' ? retryAfter : null) },
    json: async () => ({}),
  }) as unknown as Response;

describe('429 / Retry-After handling', () => {
  it('backs off for the Retry-After interval, retries, and returns the body on success', async () => {
    const sleep = jest.fn(async () => undefined);
    let call = 0;
    const fetchImpl = jest.fn(async () => {
      call += 1;
      return call === 1
        ? rateLimited('2')
        : ({ ok: true, status: 200, json: async () => deviceEnvelope } as unknown as Response);
    }) as unknown as typeof fetch;

    const deviceId = await registerDevice('token', 'key', fetchImpl, { sleep });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(deviceId).toBe('42');
  });

  it('gives up after the bounded retry count and surfaces a distinct rate-limited error', async () => {
    const sleep = jest.fn(async () => undefined);
    const fetchImpl = jest.fn(async () => rateLimited('1')) as unknown as typeof fetch;

    await expect(
      registerDevice('token', 'key', fetchImpl, { sleep, maxRetries: 2 }),
    ).rejects.toBeInstanceOf(BunqRateLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('request timeout', () => {
  it('aborts a hung request after the timeout and surfaces a timeout error', async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = ((_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
          });
        })) as unknown as typeof fetch;

      const pending = registerDevice('token', 'key', fetchImpl, { timeoutMs: 30_000 });
      const assertion = expect(pending).rejects.toBeInstanceOf(BunqTimeoutError);

      await jest.advanceTimersByTimeAsync(30_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});
