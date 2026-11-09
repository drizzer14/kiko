import { Appearance } from 'react-native';
import { renderHook, waitFor } from '@testing-library/react-native';
import { openSqliteWorld } from '@kiko/test-support/sqlite-live-query';

import { writeAppearanceMirror } from '../appearance-mirror';

import { useSyncAppearanceWithSettings } from './use-sync-appearance-with-settings';

jest.mock('@kiko/db/client', () => require('@kiko/test-support/sqlite-live-query').clientModule());
jest.mock('@kiko/appearance/appearance-mirror/appearance-mirror', () => ({
  writeAppearanceMirror: jest.fn(),
  readAppearanceMirror: jest.fn(),
}));

// The row a build that still had the old light/dark toggle left behind: it is read, not reset.
describe('useSyncAppearanceWithSettings over a stored settings row', () => {
  it('a stored light row applies at first launch', async () => {
    const setColorScheme = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});

    openSqliteWorld().prepare("INSERT INTO settings (id, appearance) VALUES (1, 'light')").run();

    await renderHook(() => useSyncAppearanceWithSettings());

    await waitFor(() => expect(setColorScheme).toHaveBeenCalledWith('light'));
    expect(writeAppearanceMirror).toHaveBeenCalledWith('light');
    expect(setColorScheme).toHaveBeenCalledTimes(1);
  });
});
