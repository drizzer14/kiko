import { settingsRepo } from '@kiko/settings';
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useState } from 'react';

import { useLiveQuery } from '../db/use-live-query';

import { type AuthResult, authenticate } from './biometrics';

type AppLock = {
  // False until the settings row has loaded; the gate renders neither the prompt
  // nor the children before then, so no real data can flash.
  isReady: boolean;
  isLocked: boolean;
  unlock: () => Promise<AuthResult>;
};

/**
 * App-wide lock state. The lock is decided exactly once, at cold launch: the
 * process starts locked whenever `settings.lockEnabled` is on, and `unlock()`
 * runs the system biometric/passcode sheet. Once unlocked, the app never
 * re-locks for the life of the process — there is no background/foreground
 * re-lock, however long the app sits backgrounded. Face ID is asked for only on
 * a fresh app open.
 */
export const useAppLock = (): AppLock => {
  const { t } = useTranslation();
  const { data, isLoading } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const settingsRow = data.at(0);
  const lockEnabled = settingsRow?.lockEnabled ?? false;
  // `undefined` = cold launch, not yet decided (settings still loading).
  const [locked, setLocked] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (isLoading || locked !== undefined) {
      return;
    }

    setLocked(lockEnabled);
  }, [isLoading, lockEnabled, locked]);

  const unlock = useCallback(async (): Promise<AuthResult> => {
    const result = await authenticate(t('auth.unlockPrompt'));

    if (result.kind === 'success') {
      setLocked(false);
    }

    return result;
  }, [t]);

  return {
    isReady: locked !== undefined,
    isLocked: lockEnabled && locked === true,
    unlock,
  };
};
