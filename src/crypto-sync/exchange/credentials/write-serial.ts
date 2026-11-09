/**
 * Names one save of a key pair. Two saves of the same keys get two tokens, so a caller that clears
 * "what I saved" can tell its own write from a later one that stored an equal pair.
 */
export type WriteToken = symbol;

type WriteSerial = {
  /** Runs `write` once every write queued before it for `accountId` has ended. */
  serialized: <Result>(accountId: string, write: () => Promise<Result>) => Promise<Result>;
  /** Names the save that has just stored the pair of `accountId`; call it after the write ends. */
  issueToken: (accountId: string) => WriteToken;
  /** Whether `token` names the save that stored the pair of `accountId` now. */
  holdsToken: (accountId: string, token: WriteToken) => boolean;
  /** Drops the token of `accountId`; call it once the pair is gone. */
  dropToken: (accountId: string) => void;
};

/**
 * One exchange's per-account Keychain write queue and write tokens. A write that checks which
 * save stored the pair before it deletes it is only sound if no other write for the same account
 * lands between its check and its change, and the form saves a new pair outside the database write
 * queue, so every write for an account waits here for the ones queued before it. The tail never
 * rejects, so a failed write does not block the next one. The tokens are memory only: a restart
 * loses every token, then no token matches and nothing is cleared, which keeps a pair rather than
 * deleting one by mistake. One instance per exchange, so two exchanges never share a queue.
 */
export const createWriteSerial = (): WriteSerial => {
  const writeTails = new Map<string, Promise<void>>();
  const storedTokens = new Map<string, WriteToken>();

  return {
    serialized: (accountId, write) => {
      const run = (writeTails.get(accountId) ?? Promise.resolve()).then(write);

      writeTails.set(
        accountId,
        run.then(
          () => undefined,
          () => undefined,
        ),
      );

      return run;
    },
    issueToken: (accountId) => {
      const token = Symbol('exchange-write');

      storedTokens.set(accountId, token);

      return token;
    },
    holdsToken: (accountId, token) => storedTokens.get(accountId) === token,
    dropToken: (accountId) => {
      storedTokens.delete(accountId);
    },
  };
};
