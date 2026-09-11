import { settingsRepo } from '@kiko/settings/settings.repo';
import { useEffect } from 'react';

import { useLiveQuery } from '../db/use-live-query';

import { i18n } from './index';

/**
 * Keeps the active i18next language in sync with the persisted choice. Reads the
 * settings row the same way settings.screen.tsx does. A non-null language that
 * differs from the current one triggers i18n.changeLanguage; a null value leaves
 * the device-detected default (set at init in src/i18n/index.ts) untouched.
 * Mounted once from AppRoot, after MigrationsGate (the settings table exists).
 */
export const useSyncLanguageWithSettings = (): void => {
  const { data } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const language = data.at(0)?.language;

  useEffect(() => {
    if (language != null && language !== i18n.language) {
      i18n.changeLanguage(language);
    }
  }, [language]);
};
