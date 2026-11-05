import type { HoldingRow } from '@kiko/db';
import type { Currency } from '@kiko/currency/currency';
import { exchangeStatePatched } from '@kiko/crypto-sync/exchange/walk-state';

import type { ProviderRead, SyncTarget } from '../provider';

import { type BybitDeps, defaultBybitDeps } from './bybit.provider';
import type { BybitFundCoin, BybitUnifiedCoin } from './bybit.client';
import { API_KEY, NOW, SECRET, answerWith, envelopeOf } from './bybit.client-test-fixtures';

export const KEY_INFO_PATH = '/v5/user/query-api';
export const UNIFIED_PATH = '/v5/account/wallet-balance';
export const FUND_PATH = '/v5/asset/transfer/query-account-coins-balance';

let accountCount = 0;

/**
 * A target of an account no other test has used: the cooldown of a rate refusal lives in the
 * module, so two tests that share an account id would share a cooling account.
 */
export const freshTarget = (holdings: HoldingRow[] = []): SyncTarget => {
  accountCount += 1;

  return { accountId: `bybit-account-${accountCount}`, holdings };
};

/** A synced Bybit holding at a match key; only the fields the provider reads matter. */
export const heldHolding = (
  bybitAsset: string,
  balanceMinorUnits = 1,
  currency: Currency = 'BTC',
): HoldingRow => ({
  id: `held-${bybitAsset}`,
  accountId: 'held-account',
  name: bybitAsset,
  type: 'crypto_asset',
  currency,
  icon: null,
  color: null,
  balanceMinorUnits,
  syncedBalanceMinorUnits: null,
  balanceSetAt: null,
  balanceSetRowId: null,
  metadata: { bybitAsset, syncedAt: 0 },
  sortOrder: 0,
  closedAt: null,
  createdAt: 0,
});

type ProviderMocks = BybitDeps & {
  readCredentials: jest.Mock;
  readExpiredAtMs: jest.Mock;
  fetchKeyInfo: jest.Mock;
  fetchUnifiedBalance: jest.Mock;
  fetchFundBalance: jest.Mock;
};

/** Deps whose three reads answer at once with the given coin rows and make no request. */
export const makeDeps = (
  unified: BybitUnifiedCoin[] = [],
  fund: BybitFundCoin[] = [],
): ProviderMocks => ({
  fetchImpl: (async () => {
    throw new TypeError('Network request failed');
  }) as unknown as typeof fetch,
  now: () => NOW,
  readCredentials: jest.fn(async () => ({ apiKey: API_KEY, secret: SECRET })),
  readExpiredAtMs: jest.fn(async () => undefined),
  fetchKeyInfo: jest.fn(async () => ({
    expiredAtMs: undefined,
    deadlineDay: undefined,
    readOnly: 1,
    isMaster: true,
  })),
  fetchUnifiedBalance: jest.fn(async () => unified),
  fetchFundBalance: jest.fn(async () => fund),
});

type Answer = Parameters<typeof answerWith>[0];

/** The answer of a code-0 envelope around `result`. */
export const okAnswer = (result: unknown): Answer => ({ body: envelopeOf(0, result) });

/** The answer of a refusal Bybit sends with HTTP 200 and a non-zero code. */
export const refusalAnswer = (retCode: number): Answer => ({ body: envelopeOf(retCode) });

type RequestInitLike = { method: string; headers: Record<string, string> };

/**
 * The real client over a `fetch` that answers each path as given, and records the paths it was
 * asked. A path with no answer fails the read like a lost network, so a test names every route
 * the sync may call.
 */
export const routedDeps = (
  answers: Partial<Record<string, Answer>>,
): { deps: BybitDeps; requested: string[] } => {
  const requested: string[] = [];
  const fetchImpl = (async (url: string, init: RequestInitLike) => {
    const path = new URL(url).pathname;
    const answer = answers[path];

    requested.push(path);

    if (answer === undefined) {
      throw new TypeError('Network request failed');
    }

    return answerWith(answer).fetchImpl(url, init as RequestInit);
  }) as unknown as typeof fetch;

  return {
    deps: {
      ...defaultBybitDeps,
      fetchImpl,
      now: () => NOW,
      readCredentials: async () => ({ apiKey: API_KEY, secret: SECRET }),
      readExpiredAtMs: async () => undefined,
    },
    requested,
  };
};

/** The stored column after the patches a read returned, applied to the state `seed` names. */
export const stateAfter = (
  read: ProviderRead,
  seed: Record<string, unknown> = {},
): Record<string, unknown> => {
  const stored = JSON.stringify({ version: 1, walks: {}, ...seed });

  return JSON.parse(exchangeStatePatched(stored, read.exchangeState ?? []) ?? 'null');
};

export const keysOf = (read: ProviderRead): string[] =>
  read.balances.map(({ metadataKey }) => metadataKey);
