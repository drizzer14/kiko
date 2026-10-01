import { settingsRepo } from '@kiko/settings';
import { logFailure } from '@kiko/diagnostics';
import either, { bifold, isLeft } from 'fnts/either';

import { readEodhdKey } from '../eodhd-key';
import { fetchUserLimits, type UserLimits } from '../eodhd';
import { withUserLimits, type QuoteQuota } from '../quote-quota';

export type DailyLimitDeps = {
  now?: () => number;
  readKey?: () => Promise<string | undefined>;
  loadQuota?: () => Promise<QuoteQuota | null>;
  updateQuota?: (build: (stored: QuoteQuota | null) => QuoteQuota | null) => Promise<void>;
  fetchUserLimits?: (key: string) => Promise<UserLimits>;
};

const withDefaults = (deps: DailyLimitDeps): Required<DailyLimitDeps> => ({
  now: Date.now,
  readKey: readEodhdKey,
  loadQuota: async () => (await settingsRepo.quoteQuotaQuery()).at(0)?.quoteQuota ?? null,
  updateQuota: settingsRepo.updateQuoteQuota,
  fetchUserLimits: (key) => fetchUserLimits(key),
  ...deps,
});

/**
 * Reads the key's own daily limit from EODHD when the key was saved without
 * it, so a refresh and a search stop planning under a guessed limit. `/user`
 * costs no call. A failure leaves the limit unconfirmed for the next try.
 */
export const confirmDailyLimit = async (deps: DailyLimitDeps = {}): Promise<void> => {
  const { now, readKey, loadQuota, updateQuota, ...network } = withDefaults(deps);

  if ((await loadQuota())?.isLimitUnconfirmed !== true) {
    return;
  }

  const key = await readKey();

  if (key === undefined) {
    return;
  }

  const answer = await either(async () => network.fetchUserLimits(key));

  if (isLeft(answer)) {
    // Only the error's name: the request URL carries the key.
    logFailure('[daily-limit] EODHD limit check failed', bifold(answer));

    return;
  }

  const limits: UserLimits = bifold(answer);

  await updateQuota((stored) => withUserLimits(stored, limits, now()));
};
