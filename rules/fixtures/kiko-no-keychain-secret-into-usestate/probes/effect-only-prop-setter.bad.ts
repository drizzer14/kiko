// Semgrep fixture (POSITIVE, probe): a real React file that imports only `useEffect` from react
// and calls a `set...` PROP callback. It binds no useState itself, yet it is still a React file,
// so the rule must find the secret reaching the setter.
import { useEffect } from 'react';

import { readToken } from '../../../../src/monobank/token';

export const FixtureBadEffectOnlyPropSetter = ({
  setToken,
}: {
  setToken: (value: unknown) => void;
}) => {
  useEffect(() => {
    const load = async (): Promise<void> => {
      const stored = await readToken('acc-1');
      // EXPECT-FINDING
      setToken(stored);
    };

    load();
  }, [setToken]);

  return null;
};
