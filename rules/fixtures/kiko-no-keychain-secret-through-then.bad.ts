// Semgrep fixture (POSITIVE): a Keychain reader's result is routed through a
// `.then` callback and lands in React state — the S5 prefill anti-pattern.
// `kiko-no-keychain-secret-through-then` MUST report a finding on the pinned
// line below (the taint rule, kiko-no-keychain-secret-into-usestate, does NOT
// fire on this shape — see the comment above it in rules/semgrep-mobile.yml).
// Never "fix" this file.
import { useState } from 'react';

import { readToken } from '../../src/monobank/token';

export const FixtureBadThenForm = () => {
  const [token, setToken] = useState('');

  // EXPECT-FINDING
  readToken().then((existing) => {
    if (existing !== undefined) {
      setToken(existing);
    }
  });

  return token;
};
