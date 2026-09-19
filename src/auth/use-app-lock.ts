import { settingsRepo } from '@kiko/settings/settings.repo';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { APP_LOCK_ENABLED } from '../db/db-config';
import { useLiveQuery } from '../db/use-live-query';

import { type AuthResult, authenticate } from './biometrics';

type AppLock = {
  // False until the settings row has loaded; the gate renders neither the prompt
  // nor the children before then, so no real data can flash. Always true when the
  // lock is compiled off (`APP_LOCK_ENABLED`), since there is nothing to wait for.
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
 *
 * SAFETY: `APP_LOCK_ENABLED` is ON in every shipping build; the whole hook is
 * inert only if it is compiled off, which is a build-time safety mechanism,
 * not a default — see `db-config.ts`. `lockEnabled` folds the flag in, so
 * `isLocked` is always false; `unlock()` short-circuits and returns success
 * BEFORE calling `authenticate()`. Importing `./biometrics` is safe because
 * that wrapper only `require`s the native biometrics module lazily, from
 * inside `authenticate()` — which the off path never calls — so the native
 * `TurboModuleRegistry.getEnforcing` never runs on a build without the pod.
 */
export const useAppLock = (): AppLock => {
  const { t } = useTranslation();
  const { data, isLoading } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const settingsRow = data.at(0);
  const lockEnabled = APP_LOCK_ENABLED && (settingsRow?.lockEnabled ?? false);
  // `undefined` = cold launch, not yet decided (settings still loading).
  const [locked, setLocked] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (isLoading || locked !== undefined) {
      return;
    }

    setLocked(lockEnabled);
  }, [isLoading, lockEnabled, locked]);

  const unlock = useCallback(async (): Promise<AuthResult> => {
    if (!APP_LOCK_ENABLED) {
      return { kind: 'success' };
    }

    // `authenticate` lazily `require`s the native biometrics module on its first
    // call (see `./biometrics`), so this early-returned path — the only one
    // reached while the flag is off — never loads it. Reaching here means the
    // flag is on, so pulling in the native module now is intended.
    const result = await authenticate(t('auth.unlockPrompt'));

    if (result.kind === 'success') {
      setLocked(false);
    }

    return result;
  }, [t]);

  return {
    isReady: !APP_LOCK_ENABLED || locked !== undefined,
    isLocked: lockEnabled && locked === true,
    unlock,
  };
};
