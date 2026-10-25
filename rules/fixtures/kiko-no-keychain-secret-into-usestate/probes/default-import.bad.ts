// Semgrep fixture (POSITIVE, probe): `React.useState` through a DEFAULT import. The rule must
// find the secret reaching the setter.
import React from 'react';

import { readToken } from '../../../../src/monobank/token';

export const FixtureBadDefaultImport = () => {
  const [token, setToken] = React.useState<string | undefined>(undefined);

  const load = async (): Promise<void> => {
    const stored = await readToken('acc-1');
    // EXPECT-FINDING
    setToken(stored);
  };

  return { token, load };
};
