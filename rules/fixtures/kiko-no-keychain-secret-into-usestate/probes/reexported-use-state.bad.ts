// Semgrep fixture (POSITIVE, probe): useState arrives through a RE-EXPORT module, so this file has
// no react import at all. A rule scoped to "the file imports react" would miss it; the rule must
// keep finding it.
import { readToken } from '../../../../src/monobank/token';

import { useState } from './state-hooks-reexport.good';

export const FixtureBadReexportedUseState = () => {
  const [token, setToken] = useState<string | undefined>(undefined);

  const load = async (): Promise<void> => {
    const stored = await readToken('acc-1');
    // EXPECT-FINDING
    setToken(stored);
  };

  return { token, load };
};
