import { useEffect } from 'react';

import { useLiveQuery } from '../db/use-live-query';
import { settingsRepo } from '../repositories/settings.repo';

import { applyAppearance } from './appearance';

/**
 * Drives Unistyles from the persisted appearance choice. Reads the settings row
 * the same way settings.screen.tsx does. Mounted once from AppRoot, after
 * MigrationsGate (the settings table exists). The mapping itself lives in
 * `applyAppearance` (`./appearance`), shared with `MigrationsGate`'s
 * cold-launch `applyPersistedAppearance`.
 */
export const useSyncAppearanceWithSettings = (): void => {
  const { data } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const appearance = data.at(0)?.appearance;

  useEffect(() => {
    if (appearance == null) {
      return;
    }

    applyAppearance(appearance);
  }, [appearance]);
};
