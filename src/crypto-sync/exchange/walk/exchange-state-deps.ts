import { match } from 'ts-pattern';
import { syncStateRepo } from '@kiko/sync-state';
import type { BalanceProviderId } from '@kiko/crypto-sync/provider';

import {
  type ExchangeStatePatch,
  type ParsedWalkMarks,
  parseExchangeState,
  type WalkId,
  type WalkMarkPatch,
} from '../walk-state';

import { BinanceWalkStop } from './walk';

/** The code of the one log line a run on a state this build cannot read writes. */
export const EXCHANGE_STATE_MALFORMED = 'exchange-state-malformed';

/**
 * What every exchange history walk reads its marks from and writes them through: the stored text
 * of the account's `sync_state.exchange_state`, and the gated writer of its fields.
 */
export type ExchangeStateDeps = {
  /** The stored text, `null` when the account has no state row or never wrote the column. */
  readExchangeState: (accountId: string) => Promise<string | null>;
  /** One write of every patch, while the account is still connected to the exchange. */
  patchExchangeState: (accountId: string, patches: readonly ExchangeStatePatch[]) => Promise<void>;
};

export const exchangeStateDepsOf = (exchangeId: BalanceProviderId): ExchangeStateDeps => ({
  readExchangeState: async (accountId) =>
    (await syncStateRepo.getQuery(accountId)).at(0)?.exchangeState ?? null,
  patchExchangeState: (accountId, patches) =>
    syncStateRepo.patchExchangeState(accountId, exchangeId, patches),
});

/**
 * The marks of one walk as the account's state holds them. It rejects when the state is no state
 * this build reads: `runCryptoSync` reads the state first and starts no walk on such a state, so
 * a walk that gets here anyway stops, since nothing it wrote would stick and it would start from
 * its floor again on every run.
 */
export const readWalkMarks = async (
  deps: Pick<ExchangeStateDeps, 'readExchangeState'>,
  accountId: string,
  walkId: WalkId,
): Promise<ParsedWalkMarks> =>
  match(parseExchangeState(await deps.readExchangeState(accountId)))
    .returnType<ParsedWalkMarks>()
    .with({ kind: 'parsed' }, ({ walks }) => walks[walkId])
    .with({ kind: 'malformed' }, () => {
      throw new BinanceWalkStop(EXCHANGE_STATE_MALFORMED);
    })
    .exhaustive();

/** The writes of one walk's marks: every call is one write of the account's state. */
export type WalkMarkWriter = (patches: readonly WalkMarkPatch[]) => Promise<void>;

export const walkMarkWriterOf =
  (
    deps: Pick<ExchangeStateDeps, 'patchExchangeState'>,
    accountId: string,
    walkId: WalkId,
  ): WalkMarkWriter =>
  (patches) =>
    deps.patchExchangeState(
      accountId,
      patches.map((patch) => ({ kind: 'walk', walkId, ...patch })),
    );
