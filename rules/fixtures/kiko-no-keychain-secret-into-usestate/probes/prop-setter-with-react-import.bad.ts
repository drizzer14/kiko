// Semgrep fixture (POSITIVE, probe): the sink is a `set...` PROP callback, not a local useState
// setter, in a file that DOES import react. A rule scoped to "the file imports react" must keep
// finding it.
import { useState } from 'react';

import { readToken } from '../../../../src/monobank/token';

export const FixtureBadPropSetter = ({ setToken }: { setToken: (value: unknown) => void }) => {
  const [isLoaded, setIsLoaded] = useState(false);

  const load = async (): Promise<void> => {
    const stored = await readToken('acc-1');
    // EXPECT-FINDING
    setToken(stored);
    setIsLoaded(true);
  };

  return { isLoaded, load };
};
