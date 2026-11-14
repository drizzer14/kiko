import { createHmac } from 'node:crypto';

export const NOW = 1_704_326_400_000;
export const API_KEY = 'api-key-fixture';
export const SECRET = 'secret-fixture';

// HMAC-SHA256 by Node's own implementation, so the expectation does not share code with the client.
export const signatureOf = (text: string): string =>
  createHmac('sha256', SECRET).update(text).digest('hex');

// The text field of a Bybit answer. Kiko never reads it, so a test fills it and looks for the text
// in what the client gives back.
export const SERVER_TEXT = 'server text that must never be read';

type SentRequest = {
  url: string;
  init: { method: string; headers: Record<string, string> };
};

type Answer = {
  body?: unknown;
  status?: number;
  headers?: Record<string, string>;
  // A gateway page: the body is not JSON.
  notJson?: boolean;
};

/**
 * A `fetch` that answers every call the same way and records what it was sent, so a test reads
 * the URL, the method and the headers of the request the client built.
 */
export const answerWith = (answer: Answer): { fetchImpl: typeof fetch; sent: SentRequest[] } => {
  const sent: SentRequest[] = [];
  const status = answer.status ?? 200;
  const fetchImpl = (async (url: string, init: SentRequest['init']) => {
    sent.push({ url, init });

    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(answer.headers),
      json: async () => {
        if (answer.notJson === true) {
          throw new SyntaxError('Unexpected token < in JSON');
        }

        return answer.body;
      },
    };
  }) as unknown as typeof fetch;

  return { fetchImpl, sent };
};

/** The envelope of a Bybit answer: a code, a text this client never reads, and a result. */
export const envelopeOf = (retCode: number, result?: unknown) => ({
  retCode,
  retMsg: SERVER_TEXT,
  result,
  retExtInfo: {},
  time: NOW,
});
