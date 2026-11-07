import { useEffect } from 'react';
import { useLiveQuery } from '@kiko/db';
import { Appearance } from 'react-native';
import maybe, { foldMap } from 'fnts/maybe';
import { settingsRepo } from '@kiko/settings';

import { writeAppearanceMirror } from '../appearance-mirror';
import { parseAppearanceMode, windowOverrideOf } from '../appearance-mode';

/**
 * Keeps the window's scheme and the first-frame mirror in step with the settings row, which is
 * the only source of truth. While the row is unloaded there is no mode, so nothing is written
 * and a saved Light is never reset to System. The mirror is written first, so a kill between the
 * two leaves the next launch on the new mode. Mounted once from AppRoot, beside
 * `useSyncLanguageWithSettings`.
 */
export const useSyncAppearanceWithSettings = (): void => {
  const { data } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const mode = foldMap(maybe(data.at(0)), (row) => parseAppearanceMode(row.appearance));

  useEffect(() => {
    if (mode === undefined) {
      return;
    }

    writeAppearanceMirror(mode);
    Appearance.setColorScheme(windowOverrideOf(mode));
  }, [mode]);
};
