import { Appearance } from 'react-native';

import { readAppearanceMirror } from '../appearance-mirror';

// Runs before `StyleSheet.configure`: Unistyles reads the window's scheme synchronously on its
// first read, so a pinned mode must already be on the window. System leaves the OS in charge,
// and the sync hook applies the row once the database is open.
export const applyLaunchAppearance = (): void => {
  const mode = readAppearanceMirror();

  if (mode === 'system') {
    return;
  }

  Appearance.setColorScheme(mode);
};
