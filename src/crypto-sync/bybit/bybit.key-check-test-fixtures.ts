import { answerWith, envelopeOf } from './bybit.client-test-fixtures';

/** The ten calls of a connect, in the order the check makes them. */
export const KEY_CHECK_PATHS = [
  '/v5/user/query-api',
  '/v5/account/wallet-balance',
  '/v5/asset/transfer/query-account-coins-balance',
  '/v5/asset/deposit/query-record',
  '/v5/asset/deposit/query-internal-record',
  '/v5/asset/withdraw/query-record',
  '/v5/asset/transfer/query-inter-transfer-list',
  '/v5/account/transaction-log',
  '/v5/asset/exchange/query-convert-history',
  '/v5/asset/fundinghistory',
] as const;

type Answer = Parameters<typeof answerWith>[0];

type RequestInitLike = { method: string; headers: Record<string, string> };

/** A key of the main account that can only read: what a good connect reads first. */
export const KEY_INFO_RESULT = {
  readOnly: 1,
  isMaster: true,
  expiredAt: '2099-01-02T03:04:05Z',
  deadlineDay: 90,
};

const ROUTE_RESULTS: Record<(typeof KEY_CHECK_PATHS)[number], unknown> = {
  '/v5/user/query-api': KEY_INFO_RESULT,
  '/v5/account/wallet-balance': { list: [{ coin: [] }] },
  '/v5/asset/transfer/query-account-coins-balance': { balance: [] },
  '/v5/asset/deposit/query-record': { rows: [] },
  '/v5/asset/deposit/query-internal-record': { rows: [] },
  '/v5/asset/withdraw/query-record': { rows: [] },
  '/v5/asset/transfer/query-inter-transfer-list': { list: [] },
  '/v5/account/transaction-log': { list: [] },
  '/v5/asset/exchange/query-convert-history': { list: [] },
  '/v5/asset/fundinghistory': { list: [] },
};

/**
 * A `fetch` over a key every route reads, where `answers` replaces the answer of a path. It
 * records each URL it was asked, in order, so a test reads the count and the query of each call.
 */
export const keyCheckFetch = (
  answers: Partial<Record<string, Answer>> = {},
): { fetchImpl: typeof fetch; asked: URL[] } => {
  const asked: URL[] = [];
  const fetchImpl = (async (url: string, init: RequestInitLike) => {
    const parsed = new URL(url);
    const path = parsed.pathname as (typeof KEY_CHECK_PATHS)[number];

    asked.push(parsed);

    return answerWith(answers[path] ?? { body: envelopeOf(0, ROUTE_RESULTS[path]) }).fetchImpl(
      url,
      init as RequestInit,
    );
  }) as unknown as typeof fetch;

  return { fetchImpl, asked };
};
