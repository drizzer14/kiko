/**
 * Per-account Bybit rate-limit cooldown, set by the client when a read is refused for its rate
 * (`bybit.client.ts`) and read by the balance sync and each history walk, so a refusal on any
 * path stops the same account everywhere. Module-level (not a `Deps` seam), because it must
 * survive across SEPARATE sync invocations within this app process. No exported reset (no test
 * code in `src/`): a test uses a distinct account id per case.
 */
const cooldownUntilByAccount = new Map<string, number>();

export const setBybitCooldownUntil = (accountId: string, until: number): void => {
  cooldownUntilByAccount.set(accountId, until);
};

/** Whether `accountId` is still inside its cooldown window at `now`. */
export const isBybitCoolingDown = (accountId: string, now: number): boolean => {
  const until = cooldownUntilByAccount.get(accountId);

  return until !== undefined && now < until;
};
