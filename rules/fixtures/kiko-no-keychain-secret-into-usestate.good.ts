// Semgrep fixture (NEGATIVE): the secret never reaches state — only a boolean
// existence probe and two literals do, and the reader's value is used and
// discarded inside an async handler. `kiko-no-keychain-secret-into-usestate`
// MUST report nothing here.
//
// Note for whoever edits this file: Semgrep's taint engine DOES propagate
// through an intervening call's return value, so
// `const info = await fetchClientInfo(token); setName(info.name);` WOULD be
// flagged (verified — the first draft of this fixture was). That is arguably
// correct: a value derived from a secret can leak the secret, and the rule is
// Class B / override-eligible precisely for those judgment calls. Keep the
// state updates here on literals.
import { useState } from 'react';

import { fetchClientInfo } from '../../src/monobank/monobank.client';
import { hasToken, readToken } from '../../src/monobank/token';

export const FixtureGoodExistenceProbe = () => {
  const [isTokenSaved, setIsTokenSaved] = useState(false);

  hasToken().then((exists) => {
    setIsTokenSaved(exists);
  });

  return isTokenSaved;
};

export const FixtureGoodTransientUse = () => {
  const [isConnected, setIsConnected] = useState(false);

  const refresh = async (): Promise<void> => {
    const token = await readToken();

    if (token === undefined) {
      setIsConnected(false);

      return;
    }

    await fetchClientInfo(token);
    setIsConnected(true);
  };

  return { isConnected, refresh };
};
