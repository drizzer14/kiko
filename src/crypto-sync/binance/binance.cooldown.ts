/**
 * Per-account Binance rate-limit cooldown, shared between the balance sync
 * (`binance.provider.ts`) and the history walk (`binance.transactions.ts`) —
 * a 429/418 from EITHER path means the same UID is over its weight budget, so
 * both must honour the one cooldown rather than each tripping its own. Module-
 * level (not a `Deps` seam), because it must survive across SEPARATE sync
 * invocations within this app process. No exported reset (no test code in
 * `src/`): a test uses a distinct account id per case.
 */
const cooldownUntilByAccount = new Map<string, number>();

export const setBinanceCooldownUntil = (accountId: string, until: number): void => {
  cooldownUntilByAccount.set(accountId, until);
};

/** Whether `accountId` is still inside its cooldown window at `now`. */
export const isBinanceCoolingDown = (accountId: string, now: number): boolean => {
  const until = cooldownUntilByAccount.get(accountId);

  return until !== undefined && now < until;
};
