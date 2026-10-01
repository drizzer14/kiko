import { match, P } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import { settingsRepo } from '@kiko/settings';
import { logFailure } from '@kiko/diagnostics';
import either, { bifold, isLeft } from 'fnts/either';

import {
  EodhdAuthError,
  fetchUserLimits,
  EodhdQuotaError,
  type UserLimits,
  EodhdRateLimitError,
} from '../eodhd';
import {
  markUsedUp,
  currentQuota,
  withUserLimits,
  type QuoteQuota,
  keyGenerationOf,
  withUnconfirmedLimit,
} from '../quote-quota';
import { readEodhdKey } from '../eodhd-key';

export type DailyLimitDeps = {
  now?: () => number;
  readKey?: () => Promise<string | undefined>;
  loadQuota?: () => Promise<QuoteQuota | null>;
  updateQuota?: (build: (stored: QuoteQuota | null) => QuoteQuota | null) => Promise<void>;
  fetchUserLimits?: (key: string) => Promise<UserLimits>;
};

/** Whether EODHD accepts the saved key; `error` is its answer when it does not. */
export type KeyCheck = { isAccepted: true } | { isAccepted: false; error: unknown };

type QuotaBuild = (quota: QuoteQuota) => QuoteQuota;

const withDefaults = (deps: DailyLimitDeps): Required<DailyLimitDeps> => ({
  now: Date.now,
  readKey: readEodhdKey,
  loadQuota: async () => (await settingsRepo.quoteQuotaQuery()).at(0)?.quoteQuota ?? null,
  updateQuota: settingsRepo.updateQuoteQuota,
  fetchUserLimits: (key) => fetchUserLimits(key),
  ...deps,
});

/**
 * A daily or per-minute limit is not a rejection of the key, so the key holds,
 * with a daily limit EODHD has yet to confirm; a daily limit also marks the day
 * used up. Any other error leaves the key unaccepted.
 */
export const limitErrorQuota = (error: unknown): QuotaBuild | undefined =>
  match(error)
    .with(
      P.instanceOf(EodhdQuotaError),
      (): QuotaBuild => (quota) => markUsedUp(withUnconfirmedLimit(quota)),
    )
    .with(P.instanceOf(EodhdRateLimitError), (): QuotaBuild => withUnconfirmedLimit)
    .otherwise(() => undefined);

// An answer about one key lands only while it is still the saved key: a key
// saved while the request was out took a new generation.
const forKey =
  (generation: number, build: QuotaBuild) =>
  (stored: QuoteQuota | null): QuoteQuota | null =>
    foldMap(maybe(stored), (quota) =>
      keyGenerationOf(quota) === generation ? build(quota) : quota,
    ) ?? null;

const withoutRejection = ({ isKeyRejected: _wasRejected, ...quota }: QuoteQuota): QuoteQuota =>
  quota;

/**
 * Reads the key's own daily limit from EODHD when the key was saved without
 * it, so a refresh and a search stop planning under a guessed limit. `/user`
 * costs no call. A failure leaves the limit unconfirmed for the next try; a
 * 401 marks the key rejected.
 */
export const confirmDailyLimit = async (deps: DailyLimitDeps = {}): Promise<void> => {
  const { now, readKey, loadQuota, updateQuota, ...network } = withDefaults(deps);
  const loaded = await loadQuota();

  if (loaded?.isLimitUnconfirmed !== true) {
    return;
  }

  const generation = keyGenerationOf(loaded);
  const key = await readKey();

  if (key === undefined) {
    return;
  }

  const answer = await either(async () => network.fetchUserLimits(key));

  if (isLeft(answer)) {
    const error: unknown = bifold(answer);

    // Only the error's name: the request URL carries the key.
    logFailure('[daily-limit] EODHD limit check failed', error);

    if (error instanceof EodhdAuthError) {
      await updateQuota(forKey(generation, (quota) => ({ ...quota, isKeyRejected: true })));
    }

    return;
  }

  const limits: UserLimits = bifold(answer);

  // A key saved while this check was out stored its own confirmed limit,
  // which this older answer must not overwrite.
  await updateQuota(
    forKey(generation, (quota) =>
      quota.isLimitUnconfirmed === true ? withUserLimits(quota, limits, now()) : quota,
    ),
  );
};

/**
 * Asks EODHD again about a key it rejected, through `/user`, which costs no
 * call. An accepted key is cleared to refresh and search again, with the limit
 * and count EODHD reports; any other answer leaves it rejected.
 */
export const recheckRejectedKey = async (deps: DailyLimitDeps = {}): Promise<KeyCheck> => {
  const { now, readKey, loadQuota, updateQuota, ...network } = withDefaults(deps);
  const loaded = await loadQuota();

  if (loaded?.isKeyRejected !== true) {
    return { isAccepted: true };
  }

  const generation = keyGenerationOf(loaded);
  const key = await readKey();

  if (key === undefined) {
    return { isAccepted: true };
  }

  const answer = await either(async () => network.fetchUserLimits(key));

  if (isLeft(answer)) {
    const error: unknown = bifold(answer);
    const accepted = limitErrorQuota(error);

    logFailure('[daily-limit] EODHD key check failed', error);

    if (accepted === undefined) {
      return { isAccepted: false, error };
    }

    await updateQuota(
      forKey(generation, (quota) => accepted(withoutRejection(currentQuota(quota, now())))),
    );

    return { isAccepted: true };
  }

  const limits: UserLimits = bifold(answer);

  await updateQuota(
    forKey(generation, (quota) => withUserLimits(withoutRejection(quota), limits, now())),
  );

  return { isAccepted: true };
};
