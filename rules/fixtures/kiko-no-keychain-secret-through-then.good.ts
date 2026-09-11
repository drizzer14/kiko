// Semgrep fixture (NEGATIVE): the `.then` callback stores only a derived
// boolean existence probe, never the secret itself.
// `kiko-no-keychain-secret-through-then` MUST report nothing here — `hasToken`
// is not in the reader list, and it resolves a boolean, not a secret.
import { useState } from 'react';

import { hasToken } from '../../src/monobank/token';

export const FixtureGoodExistenceProbe = () => {
  const [isTokenSaved, setIsTokenSaved] = useState(false);

  hasToken('acc-1').then((exists) => {
    setIsTokenSaved(exists);
  });

  return isTokenSaved;
};
