// Semgrep fixture (POSITIVE, probe): `React.useState` through a NAMESPACE import. The rule must
// find the secret reaching the setter.
import * as React from 'react';

import { readCredentials } from '../../../../src/crypto-sync/binance/binance.credentials';

export const FixtureBadNamespaceImport = () => {
  const [credentials, setCredentials] = React.useState<unknown>(undefined);

  const load = async (): Promise<void> => {
    const stored = await readCredentials('acc-1');
    // EXPECT-FINDING
    setCredentials(stored);
  };

  return { credentials, load };
};
