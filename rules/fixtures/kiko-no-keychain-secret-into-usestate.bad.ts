// Semgrep fixture (POSITIVE): the `await` form pushes a Keychain secret into
// React state, so `kiko-no-keychain-secret-into-usestate` MUST report a
// finding here. Never "fix" this file.
//
// The `.then` shape lives in its own fixture pair,
// kiko-no-keychain-secret-through-then.{bad,good}.ts — the taint rule below
// does not fire on it (Semgrep 1.175's taint engine does not propagate
// through a `.then` callback parameter), so proving that shape needs the
// companion rule's own fixture, not this one.
import { useState } from 'react';

import { readCredentials } from '../../src/crypto-sync/binance/binance.credentials';

export const FixtureBadAwaitForm = () => {
  const [credentials, setCredentials] = useState<unknown>(undefined);

  const load = async (): Promise<void> => {
    const stored = await readCredentials();
    setCredentials(stored);
  };

  return { credentials, load };
};
